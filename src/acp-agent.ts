import * as acp from '@agentclientprotocol/sdk';
import { randomUUID } from 'node:crypto';
import { AgySession } from './agy-session.js';
import { AgyStepUpdateEvent } from './types.js';

export interface AntigravityAcpAgentOptions {
  binaryPath: string;
  defaultModel?: string;
  defaultEffort?: 'low' | 'medium' | 'high';
  dangerouslySkipPermissions?: boolean;
}

export class AntigravityAcpAgent {
  private readonly sessions = new Map<string, AgySession>();

  constructor(private readonly options: AntigravityAcpAgentOptions) {}

  public getSession(sessionId: string): AgySession | undefined {
    return this.sessions.get(sessionId);
  }

  public createApp(): acp.AgentApp {
    return acp
      .agent({
        name: 'google-antigravity',
      })
      .onRequest('initialize', async (_ctx) => {
        return {
          protocolVersion: acp.PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: false,
          },
          agentInfo: {
            name: 'google-antigravity',
            version: '1.2.1',
            title: 'Google Antigravity Agent',
          },
        };
      })
      .onRequest('authenticate', async (_ctx) => {
        return {};
      })
      .onRequest('session/set_mode', async (_ctx) => {
        return {};
      })
      .onRequest('session/new', async (ctx) => {
        const sessionId = randomUUID();
        const session = new AgySession({
          binaryPath: this.options.binaryPath,
          cwd: ctx.params.cwd,
          model: this.options.defaultModel,
          effort: this.options.defaultEffort,
          dangerouslySkipPermissions: this.options.dangerouslySkipPermissions ?? true,
        });

        this.sessions.set(sessionId, session);
        await session.start();

        return {
          sessionId,
        };
      })
      .onRequest('session/prompt', async (ctx) => {
        const sessionId = ctx.params.sessionId;
        const session = this.sessions.get(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const promptText = this.extractPromptText(ctx.params.prompt);

        try {
          const result = await session.prompt(promptText, async (stepEvent) => {
            await this.handleStepUpdate(sessionId, stepEvent, ctx.client);
          });

          if (result.status === 'ERROR' && result.error?.includes('cancelled')) {
            return {
              stopReason: 'cancelled' as const,
            };
          }

          return {
            stopReason: 'end_turn' as const,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('cancelled') || message.includes('Abort')) {
            return {
              stopReason: 'cancelled' as const,
            };
          }
          throw err;
        }
      })
      .onRequest('session/close', async (ctx) => {
        const session = this.sessions.get(ctx.params.sessionId);
        if (session) {
          session.close();
          this.sessions.delete(ctx.params.sessionId);
        }
      })
      .onNotification('session/cancel', async (ctx) => {
        if (ctx.params?.sessionId) {
          const session = this.sessions.get(ctx.params.sessionId);
          session?.cancel();
        }
      });
  }

  private extractPromptText(prompt: acp.ContentBlock[] | string): string {
    if (typeof prompt === 'string') return prompt;
    if (!Array.isArray(prompt)) return String(prompt);

    return prompt
      .map((block) => {
        if (block.type === 'text') {
          return block.text;
        }
        if (block.type === 'resource_link') {
          return `[${block.name ?? 'resource'}](${block.uri})`;
        }
        if (block.type === 'resource') {
          const res = block.resource;
          if ('text' in res && typeof res.text === 'string') {
            return res.text;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private async handleStepUpdate(
    sessionId: string,
    event: AgyStepUpdateEvent,
    client: acp.AgentContext
  ): Promise<void> {
    const step = event.step_update;

    if (step.step_type === 'agent_response') {
      if (step.text_delta) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: step.text_delta,
            },
          },
        });
      }
    } else if (step.step_type === 'tool_call') {
      const toolCallId = `step_${step.step_index}`;
      const toolName = step.tool_info?.name ?? 'tool_execution';

      if (step.state === 'ACTIVE') {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: `Executing ${toolName}`,
            name: toolName,
            status: 'in_progress',
          },
        });
      } else if (step.state === 'DONE' || step.state === 'ERROR') {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: step.state === 'ERROR' ? 'failed' : 'completed',
            content: step.tool_info?.output
              ? [
                  {
                    type: 'content',
                    content: {
                      type: 'text',
                      text: step.tool_info.output,
                    },
                  },
                ]
              : undefined,
          },
        });
      }
    }

    if (step.usage) {
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'usage_update',
          used: step.usage.total_tokens,
          size: 1_000_000,
        },
      });
    }
  }

  public closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }
}
