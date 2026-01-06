// Path: archon-cli/src/utils/version.ts
// Version checking and update notification

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

const PACKAGE_NAME = '@zincapp/archon-cli';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface VersionCache {
  latestVersion: string;
  checkedAt: number;
}

function getCacheDir(): string {
  const dir = join(homedir(), '.archon', 'cache');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCachePath(): string {
  return join(getCacheDir(), 'version.json');
}

function loadCache(): VersionCache | null {
  try {
    const path = getCachePath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(cache: VersionCache): void {
  try {
    writeFileSync(getCachePath(), JSON.stringify(cache));
  } catch {
    // Ignore cache write errors
  }
}

export function getCurrentVersion(): string {
  try {
    // Try to read from package.json relative to the module
    const packagePath = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(3000) // 3 second timeout
    });
    if (!response.ok) return null;
    const data = await response.json() as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

function compareVersions(current: string, latest: string): number {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return 1;  // latest is newer
    if (c > l) return -1; // current is newer
  }
  return 0; // same version
}

export async function checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion?: string }> {
  const cache = loadCache();
  const now = Date.now();

  // Use cached version if recent
  if (cache && (now - cache.checkedAt) < CHECK_INTERVAL_MS) {
    const current = getCurrentVersion();
    if (current !== 'unknown' && compareVersions(current, cache.latestVersion) > 0) {
      return { hasUpdate: true, latestVersion: cache.latestVersion };
    }
    return { hasUpdate: false };
  }

  // Fetch latest version (don't await, run in background)
  const latestVersion = await fetchLatestVersion();

  if (latestVersion) {
    saveCache({ latestVersion, checkedAt: now });
    const current = getCurrentVersion();
    if (current !== 'unknown' && compareVersions(current, latestVersion) > 0) {
      return { hasUpdate: true, latestVersion };
    }
  }

  return { hasUpdate: false };
}

// Non-blocking version check that runs in background
let updateCheckPromise: Promise<{ hasUpdate: boolean; latestVersion?: string }> | null = null;

export function startUpdateCheck(): void {
  updateCheckPromise = checkForUpdates().catch(() => ({ hasUpdate: false }));
}

export async function getUpdateCheckResult(): Promise<{ hasUpdate: boolean; latestVersion?: string }> {
  if (!updateCheckPromise) {
    return { hasUpdate: false };
  }
  return updateCheckPromise;
}

export function showVersionHeader(profileName: string, quiet: boolean = false): void {
  if (quiet) return;

  const version = getCurrentVersion();
  console.error(chalk.gray(`archon v${version} • ${profileName}`));
}

export async function showUpdateNotice(): Promise<void> {
  try {
    const result = await getUpdateCheckResult();
    if (result.hasUpdate && result.latestVersion) {
      const current = getCurrentVersion();
      console.error('');
      console.error(chalk.yellow(`Update available: ${current} → ${result.latestVersion}`));
      console.error(chalk.gray(`Run: npm install -g ${PACKAGE_NAME}@latest`));
    }
  } catch {
    // Ignore errors
  }
}
