import { describe, expect, it } from 'vitest';
import { parseAntigravityJsonlEvent } from '../src/openclaw-plugin.js';

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
