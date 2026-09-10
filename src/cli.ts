#!/usr/bin/env node
import * as acp from '@agentclientprotocol/sdk';
import { Command } from 'commander';
import { Readable, Writable } from 'node:stream';
import { AntigravityAcpAgent } from './acp-agent.js';
import { initializeHostSecurityEnvironment, resolveAgy } from './binary.js';

const program = new Command()
  .name('google-antigravity-acp')
  .description('Agent Client Protocol (ACP) server for Google Antigravity')
  .version('1.0.0')
  .option('-b, --binary-path <path>', 'Path to custom agy binary')
  .option('-m, --model <model>', 'Default model for agent sessions')
  .option('-e, --effort <effort>', 'Reasoning effort (low, medium, high)')
  .option('--no-skip-permissions', 'Do not auto-approve permissions in agy')
  .action(async (options) => {
    try {
      initializeHostSecurityEnvironment();

      const binaryPath = await resolveAgy(options.binaryPath, (msg) => {
        // Output logs to stderr so stdout remains clean for JSON-RPC
        process.stderr.write(`[ACP] ${msg}\n`);
      });

      const agent = new AntigravityAcpAgent({
        binaryPath,
        defaultModel: options.model,
        defaultEffort: options.effort,
        dangerouslySkipPermissions: options.skipPermissions !== false,
      });

      const stream = acp.ndJsonStream(
        Writable.toWeb(process.stdout),
        Readable.toWeb(process.stdin)
      );

      const app = agent.createApp();
      app.connect(stream);

      const cleanup = () => {
        agent.closeAll();
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ACP ERROR] ${message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
