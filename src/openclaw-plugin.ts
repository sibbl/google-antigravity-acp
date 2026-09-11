import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from 'openclaw/plugin-sdk/plugin-entry';

const BACKEND_ID = 'google-antigravity-cli';
const DEFAULT_MODEL = 'gemini-3.8-flash-low';

type ToolAvailability = {
  native: readonly string[];
  openClaw: readonly string[];
};

type ExactToolHome = {
  home: string;
  cleanup: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error(`Expected a JSON object in ${filePath}`);
  return parsed;
}

function toAntigravityMcpServer(server: Record<string, unknown>): Record<string, unknown> {
  const serverUrl =
    typeof server.serverUrl === 'string'
      ? server.serverUrl
      : typeof server.url === 'string'
        ? server.url
        : undefined;
  if (!serverUrl) {
    throw new Error('OpenClaw MCP server is missing its HTTP URL');
  }
  return {
    disabled: false,
    serverUrl,
    ...(isRecord(server.headers) ? { headers: server.headers } : {}),
  };
}

/**
 * Build a private Antigravity home for an exact-cap run. Native tools are
 * denied by the CLI permission engine; the host-isolated OpenClaw MCP bridge
 * remains the only executable tool surface.
 */
export async function prepareExactToolHome(params: {
  toolAvailability: ToolAvailability;
  systemSettingsPath?: string;
  sourceHome?: string;
  temporaryRoot?: string;
}): Promise<ExactToolHome> {
  if (params.toolAvailability.native.length > 0) {
    throw new Error(
      'Antigravity exact tool availability currently supports OpenClaw MCP tools only',
    );
  }

  const exposesOpenClawTools = params.toolAvailability.openClaw.length > 0;
  let openClawServer: Record<string, unknown> | undefined;
  if (exposesOpenClawTools) {
    if (!params.systemSettingsPath) {
      throw new Error('Antigravity exact tool availability requires bundled MCP settings');
    }
    const settings = await readJsonObject(params.systemSettingsPath);
    const mcpServers = isRecord(settings.mcpServers) ? settings.mcpServers : undefined;
    const candidate = mcpServers && isRecord(mcpServers.openclaw)
      ? mcpServers.openclaw
      : undefined;
    if (!candidate) {
      throw new Error('Antigravity exact tool availability requires the OpenClaw MCP server');
    }
    openClawServer = toAntigravityMcpServer(candidate);
  }

  const home = await mkdtemp(
    path.join(params.temporaryRoot ?? tmpdir(), 'openclaw-antigravity-exact-'),
  );
  await chmod(home, 0o700);
  try {
    const sourceHome = params.sourceHome ?? homedir();
    const sourceRuntime = path.join(sourceHome, '.gemini', 'antigravity-cli');
    const targetGemini = path.join(home, '.gemini');
    const targetRuntime = path.join(targetGemini, 'antigravity-cli');
    await mkdir(targetRuntime, { recursive: true, mode: 0o700 });

    for (const entry of await readdir(sourceRuntime)) {
      if (entry === 'settings.json') continue;
      await symlink(path.join(sourceRuntime, entry), path.join(targetRuntime, entry));
    }

    const settings = {
      toolPermission: 'strict',
      artifactReviewPolicy: 'asks-for-review',
      permissions: {
        allow: exposesOpenClawTools ? ['mcp(openclaw/*)'] : [],
        deny: [
          'read_file(*)',
          'write_file(*)',
          'command(*)',
          'unsandboxed(*)',
          'read_url(*)',
          'execute_url(*)',
          ...(exposesOpenClawTools ? [] : ['mcp(*)']),
        ],
      },
    };
    await writeFile(
      path.join(targetRuntime, 'settings.json'),
      `${JSON.stringify(settings, null, 2)}\n`,
      { mode: 0o600 },
    );

    await mkdir(path.join(targetGemini, 'config'), { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(targetGemini, 'config', 'mcp_config.json'),
      `${JSON.stringify({
        mcpServers: openClawServer ? { openclaw: openClawServer } : {},
      }, null, 2)}\n`,
      { mode: 0o600 },
    );

    return {
      home,
      cleanup: async () => {
        await rm(home, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

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
    bundleMcp: true,
    bundleMcpMode: 'gemini-system-settings',
    nativeToolMode: 'selectable',
    toolAvailabilityEnforcement: 'prepare-execution',
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
      if (ctx.toolAvailability) {
        args.push('--no-skip-permissions', '--disable-slash-commands');
      }
      const effort = ctx.thinkingLevel;
      if (effort === 'low' || effort === 'medium' || effort === 'high') {
        args.push('--effort', effort);
      }
      return args;
    },
    async prepareExecution(ctx) {
      if (!ctx.toolAvailability) return;
      const exactHome = await prepareExactToolHome({
        toolAvailability: ctx.toolAvailability,
        systemSettingsPath: ctx.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH,
      });
      return {
        env: { HOME: exactHome.home },
        cleanup: exactHome.cleanup,
        toolAvailabilityEnforced: true,
      };
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
