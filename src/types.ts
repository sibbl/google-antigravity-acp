/**
 * Types for Google Antigravity `agy` streaming protocol and ACP adapter.
 */

export interface AgyUsage {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens: number;
}

export interface AgyToolInfo {
  name?: string;
  parameters?: Record<string, unknown>;
  output?: string;
}

export interface AgySubagentInfo {
  conversation_id?: string;
  log_uri?: string;
}

export interface AgyInitEvent {
  event: 'init';
  conversation_id: string;
  init: {
    cwd: string;
    tools: string[];
    permission_mode?: string;
  };
}

export interface AgyStepUpdateEvent {
  event: 'step_update';
  step_update: {
    conversation_id: string;
    step_index: number;
    state: 'ACTIVE' | 'DONE' | 'ERROR' | string;
    step_type: 'user_input' | 'agent_response' | 'tool' | 'tool_call' | string;
    text_delta?: string;
    duration_seconds?: number;
    usage?: AgyUsage;
    tool_info?: AgyToolInfo;
    subagent_info?: AgySubagentInfo;
  };
}

export interface AgyResultEvent {
  event: 'result';
  result: {
    conversation_id: string;
    status: 'SUCCESS' | 'ERROR' | string;
    response: string;
    error?: string;
    duration_seconds?: number;
    num_turns?: number;
    usage?: AgyUsage;
  };
}

export type AgyStreamEvent = AgyInitEvent | AgyStepUpdateEvent | AgyResultEvent;

export interface AgyUserInputMessage {
  event: 'user';
  message: {
    content: string;
  };
}

export interface AgySessionOptions {
  binaryPath: string;
  cwd?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  dangerouslySkipPermissions?: boolean;
  extraArgs?: string[];
  env?: Record<string, string>;
}
