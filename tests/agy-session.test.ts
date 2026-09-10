import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AgySession } from '../src/agy-session.js';
import { AgyStepUpdateEvent } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mockAgyPath = join(__dirname, 'mock-agy.js');

describe('AgySession', () => {
  let session: AgySession | null = null;

  afterEach(() => {
    if (session) {
      session.close();
      session = null;
    }
  });

  it('should start session and emit init event', async () => {
    session = new AgySession({
      binaryPath: mockAgyPath,
      cwd: process.cwd(),
    });

    const init = await session.start();
    expect(init.event).toBe('init');
    expect(init.conversation_id).toBe('mock-conv-1234');
    expect(session.isRunning()).toBe(true);
    expect(session.getConversationId()).toBe('mock-conv-1234');
  });

  it('should stream step updates and resolve prompt result', async () => {
    session = new AgySession({
      binaryPath: mockAgyPath,
      cwd: process.cwd(),
    });

    const stepUpdates: AgyStepUpdateEvent[] = [];
    const result = await session.prompt('hello mock agy', (event) => {
      stepUpdates.push(event);
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.response).toContain('Echo: hello mock agy');
    expect(stepUpdates.length).toBeGreaterThanOrEqual(2);

    const textDelta = stepUpdates.find(
      (s) => s.step_update.step_type === 'agent_response' && s.step_update.text_delta
    );
    expect(textDelta).toBeDefined();
    expect(textDelta?.step_update.text_delta).toBe('Echo: hello mock agy');
  });

  it('should support multiple consecutive turns', async () => {
    session = new AgySession({
      binaryPath: mockAgyPath,
      cwd: process.cwd(),
    });

    const res1 = await session.prompt('first');
    expect(res1.response).toContain('Echo: first');

    const res2 = await session.prompt('second');
    expect(res2.response).toContain('Echo: second');
  });

  it('should handle cancellation of active prompt', async () => {
    session = new AgySession({
      binaryPath: mockAgyPath,
      cwd: process.cwd(),
    });

    await session.start();

    const promptPromise = session.prompt('__HANG__');
    setTimeout(() => {
      session?.cancel();
    }, 50);

    await expect(promptPromise).rejects.toThrow('Prompt was cancelled');
  });

  it('should close process cleanly', async () => {
    session = new AgySession({
      binaryPath: mockAgyPath,
      cwd: process.cwd(),
    });

    await session.start();
    expect(session.isRunning()).toBe(true);

    session.close();
    expect(session.isRunning()).toBe(false);
  });
});
