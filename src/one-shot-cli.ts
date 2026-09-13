#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { AgySession } from './agy-session.js';
import {
  assertExactToolAgyVersion,
  initializeHostSecurityEnvironment,
  resolveAgy,
} from './binary.js';
import type { AgyStepUpdateEvent, AgyUsage } from './types.js';

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

function usageRecord(usage: AgyUsage | undefined): Record<string, number> | undefined {
  if (!usage) return undefined;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    ...(usage.thinking_tokens === undefined
      ? {}
      : { thinking_tokens: usage.thinking_tokens }),
    ...(usage.cache_read_tokens === undefined
      ? {}
      : { cache_read_tokens: usage.cache_read_tokens }),
    total_tokens: usage.total_tokens,
  };
}

function projectStep(event: AgyStepUpdateEvent): string {
  const step = event.step_update;
  if (step.step_type === 'agent_response' && step.text_delta) {
    writeEvent({ type: 'text', text: step.text_delta });
    return step.text_delta;
  }
  // agy releases have used both names for native tool steps.
  if (step.step_type !== 'tool' && step.step_type !== 'tool_call') return '';

  const id = `${step.conversation_id}:${step.step_index}`;
  const name = step.tool_info?.name ?? 'tool_execution';
  if (step.state === 'ACTIVE') {
    writeEvent({
      type: 'tool_start',
      tool_call_id: id,
      name,
      args: step.tool_info?.parameters,
    });
  } else if (step.state === 'DONE' || step.state === 'ERROR') {
    writeEvent({
      type: 'tool_result',
      tool_call_id: id,
      name,
      is_error: step.state === 'ERROR',
      result: step.tool_info?.output,
    });
  }
  return '';
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

  let streamedText = '';
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
    const result = await session.prompt(prompt, (event) => {
      streamedText += projectStep(event);
    });

    writeEvent({
      type: 'result',
      status: result.status,
      conversation_id: result.conversationId,
      ...(streamedText.length === 0 && result.response
        ? { text: result.response }
        : {}),
      ...(result.error ? { error: result.error } : {}),
      usage: usageRecord(result.usage),
    });
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
