import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, Interface as ReadlineInterface } from 'node:readline';
import {
  AgyInitEvent,
  AgyResultEvent,
  AgySessionOptions,
  AgyStepUpdateEvent,
  AgyStreamEvent,
  AgyUserInputMessage,
} from './types.js';

export interface PromptResult {
  status: 'SUCCESS' | 'ERROR';
  response: string;
  error?: string;
  conversationId: string;
  durationSeconds?: number;
  numTurns?: number;
}

export class AgySession extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdoutRl: ReadlineInterface | null = null;
  private stderrRl: ReadlineInterface | null = null;
  private initEvent: AgyInitEvent | null = null;
  private conversationId: string | null = null;
  private isClosing: boolean = false;
  private currentPromptReject: ((err: Error) => void) | null = null;
  private currentPromptResolve: ((result: PromptResult) => void) | null = null;
  private currentPromptEventHandler: ((event: AgyStepUpdateEvent) => void | Promise<void>) | null = null;
  private pendingEventPromises: Promise<void>[] = [];

  constructor(private readonly options: AgySessionOptions) {
    super();
  }

  public getConversationId(): string | null {
    return this.conversationId;
  }

  public getInitEvent(): AgyInitEvent | null {
    return this.initEvent;
  }

  public isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }

  public async start(): Promise<AgyInitEvent> {
    if (this.isRunning() && this.initEvent) {
      return this.initEvent;
    }

    const args: string[] = [
      '--input-format=stream-json',
      '--output-format=stream-json',
    ];

    if (this.options.dangerouslySkipPermissions ?? true) {
      args.push('--dangerously-skip-permissions');
    }

    if (this.options.cwd) {
      args.push(`--add-dir=${this.options.cwd}`);
    }

    if (this.options.model) {
      args.push(`--model=${this.options.model}`);
    }

    if (this.options.effort) {
      args.push(`--effort=${this.options.effort}`);
    }

    if (this.conversationId) {
      args.push(`--conversation=${this.conversationId}`);
    }

    if (this.options.extraArgs && this.options.extraArgs.length > 0) {
      args.push(...this.options.extraArgs);
    }

    const child = spawn(this.options.binaryPath, args, {
      cwd: this.options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...(this.options.env ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = child;
    this.isClosing = false;

    if (!child.stdout || !child.stdin) {
      throw new Error('Failed to spawn agy process with valid stdio');
    }

    this.stdoutRl = createInterface({
      input: child.stdout,
      terminal: false,
    });

    if (child.stderr) {
      this.stderrRl = createInterface({
        input: child.stderr,
        terminal: false,
      });
      this.stderrRl.on('line', (line) => {
        if (line.trim()) {
          this.emit('stderr', line);
        }
      });
    }

    const initPromise = new Promise<AgyInitEvent>((resolve, reject) => {
      const onLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const parsed = JSON.parse(trimmed) as AgyStreamEvent;
          if (parsed.event === 'init') {
            this.initEvent = parsed;
            this.conversationId = parsed.conversation_id;
            resolve(parsed);
          }
        } catch {
          // Non-JSON output line before init
        }
      };

      this.stdoutRl?.on('line', onLine);

      child.once('error', (err) => {
        reject(new Error(`Failed to start agy process: ${err.message}`));
      });

      child.once('exit', (code, signal) => {
        if (!this.initEvent) {
          reject(new Error(`agy process exited before emitting init event (code: ${code}, signal: ${signal})`));
        }
      });
    });

    this.stdoutRl.on('line', (line) => {
      this.handleStdoutLine(line);
    });

    child.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    return await initPromise;
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: AgyStreamEvent;
    try {
      event = JSON.parse(trimmed) as AgyStreamEvent;
    } catch {
      this.emit('rawStdout', line);
      return;
    }

    this.emit('event', event);

    if (event.event === 'step_update') {
      if (this.currentPromptEventHandler) {
        try {
          const promise = Promise.resolve(this.currentPromptEventHandler(event)).catch((err) => {
            this.emit('error', err);
          });
          this.pendingEventPromises.push(promise);
        } catch (err) {
          this.emit('error', err);
        }
      }
    } else if (event.event === 'result') {
      const resolve = this.currentPromptResolve;
      this.currentPromptResolve = null;
      this.currentPromptReject = null;
      this.currentPromptEventHandler = null;

      if (resolve) {
        const pending = [...this.pendingEventPromises];
        this.pendingEventPromises = [];
        void Promise.all(pending).then(() => {
          resolve({
            status: event.result.status === 'ERROR' ? 'ERROR' : 'SUCCESS',
            response: event.result.response,
            error: event.result.error,
            conversationId: event.result.conversation_id,
            durationSeconds: event.result.duration_seconds,
            numTurns: event.result.num_turns,
          });
        });
      }
    }
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.stdoutRl?.close();
    this.stderrRl?.close();
    this.stdoutRl = null;
    this.stderrRl = null;
    this.process = null;

    if (this.currentPromptReject && !this.isClosing) {
      const reject = this.currentPromptReject;
      this.currentPromptReject = null;
      this.currentPromptResolve = null;
      this.currentPromptEventHandler = null;
      reject(new Error(`agy process terminated unexpectedly (code: ${code}, signal: ${signal})`));
    }

    this.emit('exit', code, signal);
  }

  public async prompt(
    content: string,
    onStepUpdate?: (event: AgyStepUpdateEvent) => void | Promise<void>
  ): Promise<PromptResult> {
    if (!this.isRunning()) {
      await this.start();
    }

    if (this.currentPromptResolve) {
      throw new Error('A prompt is already in progress on this session');
    }

    if (!this.process || !this.process.stdin) {
      throw new Error('No active agy stdin stream available');
    }

    const message: AgyUserInputMessage = {
      event: 'user',
      message: {
        content,
      },
    };

    return new Promise<PromptResult>((resolve, reject) => {
      this.currentPromptResolve = resolve;
      this.currentPromptReject = reject;
      this.currentPromptEventHandler = onStepUpdate ?? null;

      const payload = JSON.stringify(message) + '\n';
      this.process!.stdin!.write(payload, 'utf8', (err) => {
        if (err) {
          this.currentPromptResolve = null;
          this.currentPromptReject = null;
          this.currentPromptEventHandler = null;
          reject(new Error(`Failed to write prompt to agy stdin: ${err.message}`));
        }
      });
    });
  }

  public cancel(): void {
    if (this.currentPromptReject) {
      const reject = this.currentPromptReject;
      this.currentPromptResolve = null;
      this.currentPromptReject = null;
      this.currentPromptEventHandler = null;

      // Send SIGINT to agy to cancel turn
      if (this.process && this.isRunning()) {
        try {
          this.process.kill('SIGINT');
        } catch {
          // Process might already be stopping
        }
      }

      reject(new Error('Prompt was cancelled'));
    }
  }

  public close(): void {
    this.isClosing = true;
    this.cancel();

    if (this.process && this.isRunning()) {
      try {
        this.process.stdin?.end();
        this.process.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }
  }
}
