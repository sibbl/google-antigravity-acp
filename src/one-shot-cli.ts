#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { AgySession } from './agy-session.js';
import {
  collectAgentResponse,
  lastAgentResponse,
  projectResult,
  projectStep,
} from './one-shot-events.js';
import {
  assertExactToolAgyVersion,
  initializeHostSecurityEnvironment,
  resolveAgy,
} from './binary.js';

interface Options {
  binaryPath?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  conversation?: string;
  systemPromptFile?: string;
  skipPermissions: boolean;
  disableSlashCommands: boolean;
}

function writeEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const program = new Command()
    .name('google-antigravity-cli')
    .description('One-turn JSONL adapter for OpenClaw')
    .option('-b, --binary-path <path>', 'Path to custom agy binary')
    .option('-m, --model <model>', 'Antigravity model')
    .option('-e, --effort <effort>', 'Reasoning effort (low, medium, high)')
    .option('--conversation <id>', 'Resume an Antigravity conversation')
    .option('--system-prompt-file <path>', 'Read the OpenClaw system prompt from a file')
    .option('--no-skip-permissions', 'Do not auto-approve permissions in agy')
    .option('--disable-slash-commands', 'Disable Antigravity slash-command and skill expansion');

  program.parse(process.argv);
  const options = program.opts<Options>();
  if (options.effort && !['low', 'medium', 'high'].includes(options.effort)) {
    throw new Error(`Unsupported effort: ${options.effort}`);
  }

  initializeHostSecurityEnvironment();
  const [binaryPath, userPrompt, systemPrompt] = await Promise.all([
    resolveAgy(options.binaryPath, (message) => {
      process.stderr.write(`[Antigravity] ${message}\n`);
    }),
    readStdin(),
    options.systemPromptFile
      ? readFile(options.systemPromptFile, 'utf8')
      : Promise.resolve(''),
  ]);

  if (process.env.OPENCLAW_ANTIGRAVITY_EXACT_TOOLS === '1') {
    await assertExactToolAgyVersion(binaryPath);
  }

  const prompt = systemPrompt
    ? `<openclaw_system_instructions>\n${systemPrompt}\n</openclaw_system_instructions>\n\n${userPrompt}`
    : userPrompt;
  const session = new AgySession({
    binaryPath,
    cwd: process.env.OPENCLAW_ANTIGRAVITY_EXACT_CWD ?? process.cwd(),
    model: options.model,
    effort: options.effort,
    dangerouslySkipPermissions: options.skipPermissions,
    extraArgs: [
      ...(options.conversation ? [`--conversation=${options.conversation}`] : []),
      ...(options.disableSlashCommands ? ['--disable-slash-commands'] : []),
    ],
  });

  let terminating = false;
  const terminate = () => {
    if (terminating) return;
    terminating = true;
    session.close();
  };
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  session.on('stderr', (line: string) => {
    process.stderr.write(`${line}\n`);
  });

  try {
    const init = await session.start();
    writeEvent({ type: 'session', conversation_id: init.conversation_id });
    const agentResponses = new Map<number, string>();
    const result = await session.prompt(prompt, (event) => {
      collectAgentResponse(agentResponses, event);
      const projected = projectStep(event);
      if (projected) writeEvent(projected);
    });

    writeEvent(projectResult(result, lastAgentResponse(agentResponses)));
    if (result.status === 'ERROR') process.exitCode = 1;
  } finally {
    session.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  writeEvent({ type: 'result', status: 'ERROR', error: message });
  process.stderr.write(`[Antigravity ERROR] ${message}\n`);
  process.exitCode = 1;
});
