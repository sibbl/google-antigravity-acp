import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MIN_AGY_VERSION = '1.1.8';
export const DEFAULT_RELEASE_BASE_URL = 'https://storage.googleapis.com/antigravity-public/antigravity-cli';

export const MACOS_SYSTEM_CA_PATH = '/etc/ssl/cert.pem';
export const LINUX_SYSTEM_CA_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
];

export function resolveSystemCaBundlePath(platform: string = process.platform): string | undefined {
  if (platform === 'darwin') {
    if (existsSync(MACOS_SYSTEM_CA_PATH)) {
      return MACOS_SYSTEM_CA_PATH;
    }
  } else if (platform === 'linux') {
    for (const candidate of LINUX_SYSTEM_CA_PATHS) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function initializeHostSecurityEnvironment(platform: string = process.platform): void {
  const systemCaPath = resolveSystemCaBundlePath(platform);
  if (systemCaPath) {
    if (!process.env.NODE_EXTRA_CA_CERTS) {
      process.env.NODE_EXTRA_CA_CERTS = systemCaPath;
    }
    if (!process.env.SSL_CERT_FILE) {
      process.env.SSL_CERT_FILE = systemCaPath;
    }
  }
  if (!process.env.NODE_USE_SYSTEM_CA && (platform === 'darwin' || platform === 'win32')) {
    process.env.NODE_USE_SYSTEM_CA = '1';
  }
}

export interface PlatformBinaryInfo {
  url: string;
  sha256?: string;
  sha512?: string;
}

export interface ReleaseManifest {
  version: string;
  platforms: Record<string, PlatformBinaryInfo>;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function getInstalledTargetPath(): string {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';
  return join(homedir(), '.gemini', 'bin', `agy${ext}`);
}

export function getPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm' : 'darwin-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm' : 'linux-x64';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'windows-arm' : 'windows-x64';
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export async function getBinaryVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], { timeout: 5000 });
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}

export function isVersionSufficient(version: string, minVersion: string = MIN_AGY_VERSION): boolean {
  const parse = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const v1 = parse(version);
  const v2 = parse(minVersion);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const num1 = v1[i] ?? 0;
    const num2 = v2[i] ?? 0;
    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }
  return true;
}

export async function findSystemAgy(): Promise<string | null> {
  if (process.env.AGY_PATH && (await pathExists(process.env.AGY_PATH))) {
    return process.env.AGY_PATH;
  }

  const installed = getInstalledTargetPath();
  if (await pathExists(installed)) {
    return installed;
  }

  // Check ~/.local/bin/agy
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';
  const localBin = join(homedir(), '.local', 'bin', `agy${ext}`);
  if (await pathExists(localBin)) {
    return localBin;
  }

  // Check PATH via which / where
  try {
    const lookupCmd = isWin ? 'where' : 'which';
    const { stdout } = await execFileAsync(lookupCmd, ['agy'], { timeout: 3000 });
    const foundPath = stdout.split(/\r?\n/)[0]?.trim();
    if (foundPath && (await pathExists(foundPath))) {
      return foundPath;
    }
  } catch {
    // Not on PATH
  }

  return null;
}

export async function fetchReleaseManifest(baseUrl: string = DEFAULT_RELEASE_BASE_URL): Promise<ReleaseManifest> {
  const cleanBase = baseUrl.replace(/\/+$/, '');

  // 1. Try /latest -> /<version>/manifest.json
  try {
    const latestRes = await fetch(`${cleanBase}/latest`);
    if (latestRes.ok) {
      const versionText = (await latestRes.text()).trim();
      const manifestRes = await fetch(`${cleanBase}/${versionText}/manifest.json`);
      if (manifestRes.ok) {
        return (await manifestRes.json()) as ReleaseManifest;
      }
    }
  } catch {
    // Fall back to candidate endpoints
  }

  // 2. Try /manifests/{platform}.json
  try {
    const goos = process.platform === 'win32' ? 'windows' : process.platform;
    const goarch = process.arch;
    const manifestRes = await fetch(`${cleanBase}/manifests/${goos}_${goarch}.json`);
    if (manifestRes.ok) {
      return (await manifestRes.json()) as ReleaseManifest;
    }
  } catch {
    // Ignore and try legacy
  }

  // 3. Try /releases/latest/manifest.json
  const legacyRes = await fetch(`${cleanBase}/releases/latest/manifest.json`);
  if (legacyRes.ok) {
    return (await legacyRes.json()) as ReleaseManifest;
  }

  throw new Error(`Failed to fetch release manifest from ${baseUrl}`);
}

export async function computeFileHash(filePath: string, algorithm: 'sha256' | 'sha512'): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash(algorithm).update(content).digest('hex');
}

export async function downloadAgy(
  targetPath: string = getInstalledTargetPath(),
  baseUrl: string = DEFAULT_RELEASE_BASE_URL,
  onProgress?: (message: string) => void
): Promise<string> {
  const manifest = await fetchReleaseManifest(baseUrl);
  const platformKey = getPlatformKey();
  const platformInfo = manifest.platforms[platformKey];

  if (!platformInfo) {
    throw new Error(`Platform ${platformKey} not supported in Antigravity manifest for version ${manifest.version}`);
  }

  const installDir = dirname(targetPath);
  await fs.mkdir(installDir, { recursive: true });

  const isWin = process.platform === 'win32';
  const isTarGz = platformInfo.url.endsWith('.tar.gz') || platformInfo.url.endsWith('.tgz');
  const stagingPath = join(installDir, `agy-staging-${Date.now()}${isTarGz ? '.tar.gz' : isWin ? '.exe' : ''}`);

  onProgress?.(`Downloading Google Antigravity v${manifest.version} from ${platformInfo.url}...`);

  const response = await fetch(platformInfo.url);
  if (!response.ok) {
    throw new Error(`Failed to download binary from ${platformInfo.url}: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(stagingPath, Buffer.from(arrayBuffer));

  if (platformInfo.sha512) {
    const hash = await computeFileHash(stagingPath, 'sha512');
    if (hash.toLowerCase() !== platformInfo.sha512.toLowerCase()) {
      await fs.unlink(stagingPath).catch(() => {});
      throw new Error(`SHA512 checksum mismatch. Expected ${platformInfo.sha512}, got ${hash}`);
    }
  } else if (platformInfo.sha256) {
    const hash = await computeFileHash(stagingPath, 'sha256');
    if (hash.toLowerCase() !== platformInfo.sha256.toLowerCase()) {
      await fs.unlink(stagingPath).catch(() => {});
      throw new Error(`SHA256 checksum mismatch. Expected ${platformInfo.sha256}, got ${hash}`);
    }
  }

  if (!isTarGz) {
    if (!isWin) {
      await fs.chmod(stagingPath, 0o755);
    }
    await fs.rename(stagingPath, targetPath);
    return targetPath;
  }

  onProgress?.(`Extracting Antigravity archive...`);
  try {
    await execFileAsync('tar', ['-xzf', stagingPath, '-C', installDir]);
  } finally {
    await fs.unlink(stagingPath).catch(() => {});
  }

  const ext = isWin ? '.exe' : '';
  const candidateNames = [
    `antigravity${ext}`,
    `agy${ext}`,
    `cli${ext}`,
    join('bin', `antigravity${ext}`),
    join('bin', `agy${ext}`),
    join('bin', `cli${ext}`),
  ];

  for (const candidate of candidateNames) {
    const extractedPath = join(installDir, candidate);
    if (await pathExists(extractedPath)) {
      if (!isWin) {
        await fs.chmod(extractedPath, 0o755);
      }
      if (extractedPath !== targetPath) {
        await fs.rename(extractedPath, targetPath);
      }
      return targetPath;
    }
  }

  throw new Error(`Downloaded and extracted archive, but could not locate agy executable in ${installDir}`);
}

export async function resolveAgy(customPath?: string, onProgress?: (msg: string) => void): Promise<string> {
  if (customPath) {
    if (await pathExists(customPath)) {
      return customPath;
    }
    throw new Error(`Specified agy binary path does not exist: ${customPath}`);
  }

  const existing = await findSystemAgy();
  if (existing) {
    const version = await getBinaryVersion(existing);
    if (version && isVersionSufficient(version)) {
      return existing;
    }
  }

  return await downloadAgy(undefined, undefined, onProgress);
}
