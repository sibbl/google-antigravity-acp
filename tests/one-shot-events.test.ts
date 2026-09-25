import { describe, expect, it } from 'vitest';
import {
  collectAgentResponse,
  lastAgentResponse,
  projectResult,
  projectStep,
} from '../src/one-shot-events.js';

describe('OpenClaw one-shot event projection', () => {
  it('streams intermediate agent responses before the final answer', () => {
    const streamed = projectStep({
      event: 'step_update',
      step_update: {
        conversation_id: 'conv-123',
        step_index: 1,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: 'Working on it...',
      },
    });
    const result = projectResult({
      status: 'SUCCESS',
      response: 'Done.',
      conversationId: 'conv-123',
    });

    expect(streamed).toEqual({ type: 'text', text: 'Working on it...' });
    expect(result).toEqual({
      type: 'result',
      status: 'SUCCESS',
      conversation_id: 'conv-123',
      text: 'Done.',
      usage: undefined,
    });
  });

  it('uses the last agent response when the terminal result has no response', () => {
    const responses = new Map<number, string>();
    for (const [stepIndex, state, textDelta] of [
      [1, 'ACTIVE', 'Still working...'],
      [2, 'ACTIVE', 'Done via '],
      [2, 'DONE', 'agent_response.'],
    ] as const) {
      collectAgentResponse(responses, {
        event: 'step_update',
        step_update: {
          conversation_id: 'conv-123',
          step_index: stepIndex,
          state,
          step_type: 'agent_response',
          text_delta: textDelta,
        },
      });
    }
    const result = projectResult(
      {
        status: 'SUCCESS',
        response: '',
        conversationId: 'conv-123',
      },
      lastAgentResponse(responses),
    );

    expect(result).toEqual({
      type: 'result',
      status: 'SUCCESS',
      conversation_id: 'conv-123',
      text: 'Done via agent_response.',
      usage: undefined,
    });
  });

  it('prefers the authoritative terminal response over the fallback', () => {
    const result = projectResult(
      {
        status: 'SUCCESS',
        response: 'Authoritative result.',
        conversationId: 'conv-123',
      },
      'Intermediate update.',
    );

    expect(result).toMatchObject({ text: 'Authoritative result.' });
  });
});
