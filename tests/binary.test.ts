import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertExactToolAgyVersion,
  findSystemAgy,
  getBinaryVersion,
  getInstalledTargetPath,
  getPlatformKey,
  isVersionSufficient,
  MIN_EXACT_TOOL_AGY_VERSION,
  pathExists,
} from '../src/binary.js';

describe('binary utilities', () => {
  it('should detect existing paths correctly', async () => {
    expect(await pathExists(process.cwd())).toBe(true);
    expect(await pathExists('/non/existent/path/for/sure')).toBe(false);
  });

  it('should resolve a valid platform key', () => {
    const key = getPlatformKey();
    expect([
      'darwin-arm',
      'darwin-x64',
      'linux-arm',
      'linux-x64',
      'windows-arm',
      'windows-x64',
    ]).toContain(key);
  });

  it('should compute installed target path in .gemini', () => {
    const target = getInstalledTargetPath();
    expect(target).toContain('.gemini');
    expect(target).toMatch(/agy(\.exe)?$/);
  });

  it('should correctly compare semantic versions', () => {
    expect(isVersionSufficient('1.2.0', '1.1.8')).toBe(true);
    expect(isVersionSufficient('1.1.8', '1.1.8')).toBe(true);
    expect(isVersionSufficient('1.1.7', '1.1.8')).toBe(false);
    expect(isVersionSufficient('2.0.0', '1.1.8')).toBe(true);
    expect(isVersionSufficient('1.2.1', '1.2.0')).toBe(true);
    expect(isVersionSufficient('1.1.8', MIN_EXACT_TOOL_AGY_VERSION)).toBe(false);
    expect(isVersionSufficient('1.1.9', MIN_EXACT_TOOL_AGY_VERSION)).toBe(true);
  });

  it('should find system agy binary and verify its version', async () => {
    const agyPath = await findSystemAgy();
    expect(agyPath).toBeTruthy();
    if (agyPath) {
      const version = await getBinaryVersion(agyPath);
      expect(version).toBeTruthy();
      expect(isVersionSufficient(version!)).toBe(true);
    }
  });

  it('requires agy 1.1.9 or newer for exact-tool runs', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'agy-version-test-'));
    const binary = path.join(fixture, 'agy');
    try {
      await writeFile(binary, '#!/bin/sh\necho 1.1.8\n');
      await chmod(binary, 0o755);
      await expect(assertExactToolAgyVersion(binary)).rejects.toThrow(
        'requires Antigravity CLI 1.1.9 or newer',
      );

      await writeFile(binary, '#!/bin/sh\necho 1.1.9\n');
      await expect(assertExactToolAgyVersion(binary)).resolves.toBeUndefined();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
