// Path: archon-cli/src/config/index.ts
// Configuration manager - handles profiles and settings

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface Profile {
  name: string;
  url: string;
  insecure?: boolean;
}

export interface Config {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

const CONFIG_DIR = join(homedir(), '.archon');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const TOKENS_DIR = join(CONFIG_DIR, 'tokens');

// Default configuration
const DEFAULT_CONFIG: Config = {
  defaultProfile: 'production',
  profiles: {
    production: {
      name: 'Production',
      url: 'https://archon.zincapp.com'
    },
    development: {
      name: 'Development',
      url: 'https://archon.zincapp.dev'
    },
    local: {
      name: 'Local',
      url: 'http://localhost:4000'
    }
  }
};

/**
 * Ensure config directories exist
 */
export function ensureConfigDirs(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(TOKENS_DIR)) {
    mkdirSync(TOKENS_DIR, { recursive: true });
  }
}

/**
 * Load configuration from disk
 */
export function loadConfig(): Config {
  ensureConfigDirs();

  if (!existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data) as Config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: Config): void {
  ensureConfigDirs();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Active profile override for current session
let activeProfileOverride: string | null = null;

/**
 * Reset the active profile override (for testing)
 */
export function resetActiveProfileOverride(): void {
  activeProfileOverride = null;
}

/**
 * Set the active profile for the current session (doesn't persist)
 */
export function setActiveProfile(name: string): void {
  const config = loadConfig();
  if (!config.profiles[name]) {
    throw new Error(`Profile '${name}' not found`);
  }
  activeProfileOverride = name;
}

/**
 * Get the active profile name
 */
export function getActiveProfileName(): string {
  // Session override takes highest precedence
  if (activeProfileOverride) {
    return activeProfileOverride;
  }

  // Environment variable takes precedence
  if (process.env.ARCHON_PROFILE) {
    return process.env.ARCHON_PROFILE;
  }

  const config = loadConfig();
  return config.defaultProfile;
}

/**
 * Get the active profile
 */
export function getActiveProfile(): Profile {
  const config = loadConfig();
  const profileName = getActiveProfileName();

  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`Profile '${profileName}' not found. Run 'archon profile list' to see available profiles.`);
  }

  // Allow URL override from environment
  if (process.env.ARCHON_URL) {
    return { ...profile, url: process.env.ARCHON_URL };
  }

  return profile;
}

/**
 * Get all profiles
 */
export function getProfiles(): Record<string, Profile> {
  const config = loadConfig();
  return config.profiles;
}

/**
 * Add or update a profile
 */
export function setProfile(name: string, profile: Profile): void {
  const config = loadConfig();
  config.profiles[name] = profile;
  saveConfig(config);
}

/**
 * Delete a profile
 */
export function deleteProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.profiles[name]) {
    return false;
  }

  delete config.profiles[name];

  // If we deleted the default profile, set a new default
  if (config.defaultProfile === name) {
    const remaining = Object.keys(config.profiles);
    config.defaultProfile = remaining[0] || 'production';
  }

  saveConfig(config);
  return true;
}

/**
 * Set the default profile
 */
export function setDefaultProfile(name: string): void {
  const config = loadConfig();
  if (!config.profiles[name]) {
    throw new Error(`Profile '${name}' not found`);
  }
  config.defaultProfile = name;
  saveConfig(config);
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get tokens directory path
 */
export function getTokensDir(): string {
  return TOKENS_DIR;
}
