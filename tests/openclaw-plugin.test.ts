import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseAntigravityJsonlEvent,
  prepareExactToolHome,
} from '../src/openclaw-plugin.js';

describe('OpenClaw plugin manifest', () => {
  it('declares native CLI authentication for the model provider', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'),
    );

    expect(manifest.syntheticAuthRefs).toEqual(['google-antigravity-cli']);
  });
});

describe('OpenClaw JSONL event parser', () => {
  it('maps session and text events', () => {
    expect(
      parseAntigravityJsonlEvent(
        JSON.stringify({ type: 'session', conversation_id: 'conv-123' }),
      ),
    ).toEqual({ kind: 'sessionId', sessionId: 'conv-123' });
    expect(
      parseAntigravityJsonlEvent(JSON.stringify({ type: 'text', text: 'hello' })),
    ).toEqual({ kind: 'text', text: 'hello' });
  });

  it('maps native tool calls and results', () => {
    expect(
      parseAntigravityJsonlEvent(
        JSON.stringify({
          type: 'tool_start',
          tool_call_id: 'tool-1',
          name: 'shell',
          args: { command: 'pwd' },
        }),
      ),
    ).toEqual({
      kind: 'toolStart',
      toolCallId: 'tool-1',
      name: 'shell',
      args: { command: 'pwd' },
    });
    expect(
      parseAntigravityJsonlEvent(
        JSON.stringify({
          type: 'tool_result',
          tool_call_id: 'tool-1',
          name: 'shell',
          is_error: false,
          result: '/workspace',
        }),
      ),
    ).toEqual({
      kind: 'toolResult',
      toolCallId: 'tool-1',
      name: 'shell',
      isError: false,
      result: '/workspace',
    });
  });

  it('maps final usage, session, and errors', () => {
    expect(
      parseAntigravityJsonlEvent(
        JSON.stringify({
          type: 'result',
          text: 'done',
          conversation_id: 'conv-123',
          usage: {
            input_tokens: 10,
            output_tokens: 3,
            cache_read_tokens: 4,
            total_tokens: 17,
          },
          error: 'optional error',
        }),
      ),
    ).toEqual({
      kind: 'result',
      text: 'done',
      sessionId: 'conv-123',
      usage: { input: 10, output: 3, cacheRead: 4, total: 17 },
      errorText: 'optional error',
    });
  });

  it('ignores malformed or unknown events', () => {
    expect(parseAntigravityJsonlEvent('not-json')).toBeNull();
    expect(parseAntigravityJsonlEvent(JSON.stringify({ type: 'mystery' }))).toBeNull();
  });
});

describe('OpenClaw exact tool availability', () => {
  it('isolates Antigravity and exposes only the OpenClaw MCP bridge', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'antigravity-plugin-test-'));
    const sourceHome = path.join(fixture, 'source-home');
    const runtimeDir = path.join(sourceHome, '.gemini', 'antigravity-cli');
    const systemSettingsPath = path.join(fixture, 'system-settings.json');
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path.join(runtimeDir, 'antigravity-oauth-token'), 'fixture-token');
    await writeFile(path.join(runtimeDir, 'installation_id'), 'fixture-installation');
    await writeFile(path.join(runtimeDir, 'settings.json'), '{"unsafe":true}');
    await mkdir(path.join(runtimeDir, 'plugins', 'untrusted-plugin'), { recursive: true });
    await writeFile(
      path.join(runtimeDir, 'plugins', 'untrusted-plugin', 'plugin.json'),
      '{"mcpServers":{"untrusted":{}}}',
    );
    await mkdir(path.join(runtimeDir, 'skills', 'untrusted-skill'), { recursive: true });
    await writeFile(
      path.join(runtimeDir, 'skills', 'untrusted-skill', 'SKILL.md'),
      'ambient instructions',
    );
    await writeFile(
      systemSettingsPath,
      JSON.stringify({
        mcpServers: {
          openclaw: {
            url: 'http://127.0.0.1:1234/mcp',
            headers: { Authorization: 'Bearer ${OPENCLAW_MCP_TEST_TOKEN}' },
            includeTools: ['message'],
          },
        },
      }),
    );

    const prepared = await prepareExactToolHome({
      toolAvailability: { native: [], openClaw: ['message'] },
      systemSettingsPath,
      env: { OPENCLAW_MCP_TEST_TOKEN: 'fixture' },
      sourceHome,
      temporaryRoot: fixture,
    });
    try {
      const settings = JSON.parse(
        await readFile(
          path.join(prepared.home, '.gemini', 'antigravity-cli', 'settings.json'),
          'utf8',
        ),
      );
      expect(settings.mcp.allowed).toEqual(['openclaw']);
      expect(settings.permissions.allow).toEqual(['mcp(openclaw/message)']);
      expect(settings.permissions.deny).toContain('command(*)');
      expect(settings.permissions.deny).toContain('read_file(*)');
      expect(settings.unsafe).toBeUndefined();

      const mcp = JSON.parse(
        await readFile(
          path.join(prepared.home, '.gemini', 'config', 'mcp_config.json'),
          'utf8',
        ),
      );
      expect(mcp.mcpServers.openclaw).toEqual({
        disabled: false,
        serverUrl: 'http://127.0.0.1:1234/mcp',
        headers: { Authorization: 'Bearer fixture' },
      });
      const linkedToken = path.join(
        prepared.home,
        '.gemini',
        'antigravity-cli',
        'antigravity-oauth-token',
      );
      expect(await readFile(linkedToken, 'utf8')).toBe('fixture-token');
      expect(await realpath(linkedToken)).toBe(path.join(runtimeDir, 'antigravity-oauth-token'));
      await expect(
        access(path.join(prepared.home, '.gemini', 'antigravity-cli', 'plugins')),
      ).rejects.toThrow();
      await expect(
        access(path.join(prepared.home, '.gemini', 'antigravity-cli', 'skills')),
      ).rejects.toThrow();
      await expect(access(path.join(prepared.workspace, '.gemini'))).rejects.toThrow();
    } finally {
      await prepared.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed when native tools are requested', async () => {
    await expect(
      prepareExactToolHome({
        toolAvailability: { native: ['run_command'], openClaw: [] },
      }),
    ).rejects.toThrow('supports OpenClaw MCP tools only');
  });
});
