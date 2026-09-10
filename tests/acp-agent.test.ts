import * as acp from '@agentclientprotocol/sdk';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityAcpAgent } from '../src/acp-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mockAgyPath = join(__dirname, 'mock-agy.js');

describe('AntigravityAcpAgent', () => {
  let agent: AntigravityAcpAgent | null = null;

  afterEach(() => {
    if (agent) {
      agent.closeAll();
      agent = null;
    }
  });

  it('should handle initialize request according to ACP spec', async () => {
    agent = new AntigravityAcpAgent({
      binaryPath: mockAgyPath,
    });
    const agentApp = agent.createApp();
    const clientApp = acp.client({ name: 'test-client' });

    await clientApp.connectWith(agentApp, async (ctx) => {
      const initRes = await ctx.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      expect(initRes.protocolVersion).toBe(acp.PROTOCOL_VERSION);
      expect(initRes.agentInfo?.name).toBe('google-antigravity');
      expect(initRes.agentInfo?.version).toBe('1.2.1');
    });
  });

  it('should create session and handle prompt with streaming updates', async () => {
    agent = new AntigravityAcpAgent({
      binaryPath: mockAgyPath,
    });
    const agentApp = agent.createApp();

    const updates: acp.SessionUpdateParams[] = [];
    const clientApp = acp.client({ name: 'test-client' }).onNotification(
      'session/update',
      (ctx) => {
        updates.push(ctx.params);
      }
    );

    await clientApp.connectWith(agentApp, async (ctx) => {
      // 1. initialize
      await ctx.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      // 2. new session
      const sessionRes = await ctx.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      });
      expect(sessionRes.sessionId).toBeTruthy();
      const sessionId = sessionRes.sessionId;

      // 3. prompt
      const promptRes = await ctx.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'run tool and respond' }],
      });

      expect(promptRes.stopReason).toBe('end_turn');

      // Verify updates were streamed
      expect(updates.length).toBeGreaterThanOrEqual(3);

      const messageChunks = updates.filter(
        (u) => u.update.sessionUpdate === 'agent_message_chunk'
      );
      expect(messageChunks.length).toBeGreaterThan(0);

      const toolCalls = updates.filter(
        (u) => u.update.sessionUpdate === 'tool_call'
      );
      expect(toolCalls.length).toBeGreaterThan(0);

      const usageUpdates = updates.filter(
        (u) => u.update.sessionUpdate === 'usage_update'
      );
      expect(usageUpdates.length).toBeGreaterThan(0);
    });
  });

  it('should handle cancel notification during prompt', async () => {
    agent = new AntigravityAcpAgent({
      binaryPath: mockAgyPath,
    });
    const agentApp = agent.createApp();
    const clientApp = acp.client({ name: 'test-client' });

    await clientApp.connectWith(agentApp, async (ctx) => {
      await ctx.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      const sessionRes = await ctx.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      });
      const sessionId = sessionRes.sessionId;

      const promptPromise = ctx.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '__HANG__' }],
      });

      setTimeout(async () => {
        await ctx.notify('session/cancel', { sessionId });
      }, 50);

      const result = await promptPromise;
      expect(result.stopReason).toBe('cancelled');
    });
  });

  it('should handle session/close', async () => {
    agent = new AntigravityAcpAgent({
      binaryPath: mockAgyPath,
    });
    const agentApp = agent.createApp();
    const clientApp = acp.client({ name: 'test-client' });

    await clientApp.connectWith(agentApp, async (ctx) => {
      await ctx.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      const sessionRes = await ctx.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      });
      const sessionId = sessionRes.sessionId;
      expect(agent?.getSession(sessionId)).toBeDefined();

      await ctx.request('session/close', { sessionId });
      expect(agent?.getSession(sessionId)).toBeUndefined();
    });
  });
});
