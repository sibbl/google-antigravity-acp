import { describe, expect, it } from 'vitest';
import {
  findSystemAgy,
  getBinaryVersion,
  getInstalledTargetPath,
  getPlatformKey,
  isVersionSufficient,
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
});
