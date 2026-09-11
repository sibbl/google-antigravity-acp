#!/usr/bin/env node
import { createInterface } from 'node:readline';

const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

const convId = 'mock-conv-1234';

// Emit init event immediately
process.stdout.write(
  JSON.stringify({
    event: 'init',
    conversation_id: convId,
    init: {
      cwd: process.cwd(),
      tools: ['mock_tool'],
      permission_mode: 'always-proceed',
    },
  }) + '\n'
);

let stepIndex = 0;

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    if (msg.event === 'user') {
      const promptText = msg.message?.content ?? '';

      if (promptText === '__HANG__') {
        // Do not respond, test cancellation
        return;
      }

      // Emit user input step done
      process.stdout.write(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: convId,
            step_index: stepIndex++,
            state: 'DONE',
            step_type: 'user_input',
          },
        }) + '\n'
      );

      // Emit tool call step if prompt requests it
      if (promptText.includes('tool')) {
        process.stdout.write(
          JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: convId,
              step_index: stepIndex++,
              state: 'ACTIVE',
              step_type: 'tool',
              tool_info: {
                name: 'mock_search',
                parameters: { query: 'test' },
              },
            },
          }) + '\n'
        );

        process.stdout.write(
          JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: convId,
              step_index: stepIndex - 1,
              state: 'DONE',
              step_type: 'tool',
              tool_info: {
                name: 'mock_search',
                output: 'mock search output result',
              },
            },
          }) + '\n'
        );
      }

      // Emit agent response delta
      process.stdout.write(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: convId,
            step_index: stepIndex++,
            state: 'ACTIVE',
            step_type: 'agent_response',
            text_delta: `Echo: ${promptText}`,
          },
        }) + '\n'
      );

      // Emit agent response done with usage
      process.stdout.write(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: convId,
            step_index: stepIndex - 1,
            state: 'DONE',
            step_type: 'agent_response',
            text_delta: '\n',
            duration_seconds: 0.1,
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
            },
          },
        }) + '\n'
      );

      // Emit terminal result
      process.stdout.write(
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: convId,
            status: 'SUCCESS',
            response: `Echo: ${promptText}\n`,
            duration_seconds: 0.1,
            num_turns: 1,
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
            },
          },
        }) + '\n'
      );
    }
  } catch (err) {
    process.stderr.write(`Mock error: ${err}\n`);
  }
});
