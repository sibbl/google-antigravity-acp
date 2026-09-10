import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const cliPath = join(projectRoot, 'dist', 'cli.js');

describe('E2E with acpx', () => {
  it(
    'should successfully execute a prompt via acpx --agent',
    async () => {
      const { stdout } = await execFileAsync(
        'npx',
        [
          '-y',
          'acpx@0.15.1',
          '--agent',
          `node ${cliPath}`,
          '--format',
          'json',
          'exec',
          'say ping',
        ],
        {
          cwd: projectRoot,
          timeout: 25000,
        }
      );

      const lines = stdout
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const messages = lines.map((l) => JSON.parse(l));

      // Verify initialize response
      const initResp = messages.find(
        (m) => m.result && m.result.agentInfo?.name === 'google-antigravity'
      );
      expect(initResp).toBeDefined();
      expect(initResp.result.protocolVersion).toBe(1);

      // Verify session/new response
      const sessionResp = messages.find((m) => m.result && m.result.sessionId);
      expect(sessionResp).toBeDefined();

      // Verify streaming updates
      const updates = messages.filter((m) => m.method === 'session/update');
      expect(updates.length).toBeGreaterThan(0);

      // Verify prompt finished with stopReason end_turn
      const promptResp = messages.find((m) => m.result && m.result.stopReason);
      expect(promptResp).toBeDefined();
      expect(promptResp.result.stopReason).toBe('end_turn');
    },
    30000
  );
});
