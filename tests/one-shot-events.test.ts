import { describe, expect, it } from 'vitest';
import { projectResult, projectStep } from '../src/one-shot-events.js';

describe('OpenClaw one-shot event projection', () => {
  it('keeps intermediate agent responses separate from the final answer', () => {
    const thinking = projectStep({
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

    expect(thinking).toEqual({ type: 'thinking', text: 'Working on it...' });
    expect(result).toEqual({
      type: 'result',
      status: 'SUCCESS',
      conversation_id: 'conv-123',
      text: 'Done.',
      usage: undefined,
    });
  });
});
