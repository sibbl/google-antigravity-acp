import type { PromptResult } from './agy-session.js';
import type { AgyStepUpdateEvent, AgyUsage } from './types.js';

export type OneShotEvent = Record<string, unknown>;
export type AgentResponseBuffer = Map<number, string>;

export function collectAgentResponse(
  responses: AgentResponseBuffer,
  event: AgyStepUpdateEvent,
): void {
  const step = event.step_update;
  if (step.step_type !== 'agent_response' || !step.text_delta) return;
  responses.set(
    step.step_index,
    `${responses.get(step.step_index) ?? ''}${step.text_delta}`,
  );
}

export function lastAgentResponse(
  responses: AgentResponseBuffer,
): string | undefined {
  return [...responses.entries()].sort(([left], [right]) => right - left)[0]?.[1];
}

export function usageRecord(
  usage: AgyUsage | undefined,
): Record<string, number> | undefined {
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

export function projectStep(event: AgyStepUpdateEvent): OneShotEvent | undefined {
  const step = event.step_update;
  if (step.step_type === 'agent_response' && step.text_delta) {
    return { type: 'thinking', text: step.text_delta };
  }
  // agy releases have used both names for native tool steps.
  if (step.step_type !== 'tool' && step.step_type !== 'tool_call') return undefined;

  const toolCallId = `${step.conversation_id}:${step.step_index}`;
  const name = step.tool_info?.name ?? 'tool_execution';
  if (step.state === 'ACTIVE') {
    return {
      type: 'tool_start',
      tool_call_id: toolCallId,
      name,
      args: step.tool_info?.parameters,
    };
  }
  if (step.state === 'DONE' || step.state === 'ERROR') {
    return {
      type: 'tool_result',
      tool_call_id: toolCallId,
      name,
      is_error: step.state === 'ERROR',
      result: step.tool_info?.output,
    };
  }
  return undefined;
}

export function projectResult(
  result: PromptResult,
  fallbackText?: string,
): OneShotEvent {
  const text = result.response || fallbackText;
  return {
    type: 'result',
    status: result.status,
    conversation_id: result.conversationId,
    ...(text ? { text } : {}),
    ...(result.error ? { error: result.error } : {}),
    usage: usageRecord(result.usage),
  };
}
