import { fileURLToPath } from 'node:url';
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from 'openclaw/plugin-sdk/plugin-entry';

const BACKEND_ID = 'google-antigravity-cli';
const DEFAULT_MODEL = 'gemini-3.8-flash-low';

type ParsedEvent =
  | { kind: 'text'; text: string }
  | {
      kind: 'toolStart';
      toolCallId: string;
      name: string;
      args?: Record<string, unknown>;
    }
  | {
      kind: 'toolResult';
      toolCallId: string;
      name?: string;
      isError?: boolean;
      result?: unknown;
    }
  | {
      kind: 'result';
      text?: string;
      sessionId?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        total?: number;
      };
      errorText?: string;
    }
  | { kind: 'sessionId'; sessionId: string }
  | null;

export function parseAntigravityJsonlEvent(line: string): ParsedEvent {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (event.type === 'session' && typeof event.conversation_id === 'string') {
    return { kind: 'sessionId', sessionId: event.conversation_id };
  }
  if (event.type === 'text' && typeof event.text === 'string') {
    return { kind: 'text', text: event.text };
  }
  if (
    event.type === 'tool_start' &&
    typeof event.tool_call_id === 'string' &&
    typeof event.name === 'string'
  ) {
    return {
      kind: 'toolStart',
      toolCallId: event.tool_call_id,
      name: event.name,
      args:
        event.args && typeof event.args === 'object'
          ? (event.args as Record<string, unknown>)
          : undefined,
    };
  }
  if (event.type === 'tool_result' && typeof event.tool_call_id === 'string') {
    return {
      kind: 'toolResult',
      toolCallId: event.tool_call_id,
      name: typeof event.name === 'string' ? event.name : undefined,
      isError: event.is_error === true,
      result: event.result,
    };
  }
  if (event.type === 'result') {
    const usage =
      event.usage && typeof event.usage === 'object'
        ? (event.usage as Record<string, unknown>)
        : undefined;
    return {
      kind: 'result',
      text: typeof event.text === 'string' ? event.text : undefined,
      sessionId:
        typeof event.conversation_id === 'string'
          ? event.conversation_id
          : undefined,
      usage: usage
        ? {
            input:
              typeof usage.input_tokens === 'number'
                ? usage.input_tokens
                : undefined,
            output:
              typeof usage.output_tokens === 'number'
                ? usage.output_tokens
                : undefined,
            cacheRead:
              typeof usage.cache_read_tokens === 'number'
                ? usage.cache_read_tokens
                : undefined,
            total:
              typeof usage.total_tokens === 'number'
                ? usage.total_tokens
                : undefined,
          }
        : undefined,
      errorText: typeof event.error === 'string' ? event.error : undefined,
    };
  }
  return null;
}

function buildBackend(): Parameters<OpenClawPluginApi['registerCliBackend']>[0] {
  const cliPath = fileURLToPath(new URL('./one-shot-cli.js', import.meta.url));

  return {
    id: BACKEND_ID,
    modelProvider: BACKEND_ID,
    nativeToolMode: 'always-on',
    ownsNativeCompaction: true,
    liveTest: {
      defaultModelRef: `${BACKEND_ID}/${DEFAULT_MODEL}`,
      defaultImageProbe: false,
      defaultMcpProbe: false,
      docker: {
        npmPackage: 'google-antigravity-acp',
        binaryName: 'google-antigravity-cli',
      },
    },
    config: {
      command: process.execPath,
      args: [cliPath],
      resumeArgs: [cliPath, '--conversation', '{sessionId}'],
      output: 'jsonl',
      resumeOutput: 'jsonl',
      input: 'stdin',
      modelArg: '--model',
      sessionMode: 'existing',
      sessionIdFields: ['conversation_id', 'session_id'],
      systemPromptFileArg: '--system-prompt-file',
      systemPromptMode: 'append',
      systemPromptWhen: 'first',
      serialize: false,
      freshSessionRecovery: 'invalidated-only',
    },
    resolveExecutionArgs(ctx) {
      const args = [...ctx.baseArgs];
      const effort = ctx.thinkingLevel;
      if (effort === 'low' || effort === 'medium' || effort === 'high') {
        args.push('--effort', effort);
      }
      return args;
    },
    parseJsonlEvent: parseAntigravityJsonlEvent,
  };
}

export default definePluginEntry({
  id: BACKEND_ID,
  name: 'Google Antigravity CLI',
  description: 'Run Google Antigravity as a native OpenClaw CLI model backend',
  register(api) {
    api.registerCliBackend(buildBackend());
  },
});
