// Tests for config/index.ts - Profile management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the homedir to use a temp directory
const testConfigDir = join(tmpdir(), 'archon-cli-test-' + Date.now());

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => testConfigDir
  };
});

// Import after mocking
const configModule = await import('../src/config/index.js');
const {
  loadConfig,
  saveConfig,
  getProfiles,
  setProfile,
  deleteProfile,
  setDefaultProfile,
  getActiveProfileName,
  getActiveProfile,
  setActiveProfile,
  ensureConfigDirs,
  getConfigDir,
  getTokensDir,
  resetActiveProfileOverride
} = configModule;

describe('Config Module', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
    // Clear any env overrides
    delete process.env.ARCHON_PROFILE;
    delete process.env.ARCHON_URL;
    // Reset session override between tests
    resetActiveProfileOverride();
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('ensureConfigDirs', () => {
    it('should create config and tokens directories', () => {
      ensureConfigDirs();

      expect(existsSync(getConfigDir())).toBe(true);
      expect(existsSync(getTokensDir())).toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('should return default config if no config file exists', () => {
      const config = loadConfig();

      expect(config.defaultProfile).toBe('production');
      expect(config.profiles).toBeDefined();
      expect(config.profiles.production).toBeDefined();
      expect(config.profiles.production.url).toBe('https://archon.zincapp.com');
    });

    it('should load existing config from file', () => {
      ensureConfigDirs();
      const customConfig = {
        defaultProfile: 'custom',
        profiles: {
          custom: { name: 'Custom', url: 'https://custom.example.com' }
        }
      };
      writeFileSync(
        join(getConfigDir(), 'config.json'),
        JSON.stringify(customConfig)
      );

      const config = loadConfig();

      expect(config.defaultProfile).toBe('custom');
      expect(config.profiles.custom.url).toBe('https://custom.example.com');
    });
  });

  describe('saveConfig', () => {
    it('should save config to file', () => {
      const config = {
        defaultProfile: 'test',
        profiles: {
          test: { name: 'Test', url: 'https://test.example.com' }
        }
      };

      saveConfig(config);

      const savedData = readFileSync(
        join(getConfigDir(), 'config.json'),
        'utf-8'
      );
      const savedConfig = JSON.parse(savedData);

      expect(savedConfig.defaultProfile).toBe('test');
      expect(savedConfig.profiles.test.url).toBe('https://test.example.com');
    });
  });

  describe('Profile Management', () => {
    beforeEach(() => {
      // Initialize with default config
      loadConfig();
    });

    describe('getProfiles', () => {
      it('should return all profiles', () => {
        const profiles = getProfiles();

        expect(profiles.production).toBeDefined();
        expect(profiles.development).toBeDefined();
        expect(profiles.local).toBeDefined();
      });
    });

    describe('setProfile', () => {
      it('should add a new profile', () => {
        setProfile('newprofile', {
          name: 'New Profile',
          url: 'https://new.example.com',
          insecure: true
        });

        const profiles = getProfiles();

        expect(profiles.newprofile).toBeDefined();
        expect(profiles.newprofile.name).toBe('New Profile');
        expect(profiles.newprofile.url).toBe('https://new.example.com');
        expect(profiles.newprofile.insecure).toBe(true);
      });

      it('should update an existing profile', () => {
        setProfile('production', {
          name: 'Updated Production',
          url: 'https://updated.example.com'
        });

        const profiles = getProfiles();

        expect(profiles.production.name).toBe('Updated Production');
        expect(profiles.production.url).toBe('https://updated.example.com');
      });
    });

    describe('deleteProfile', () => {
      it('should delete an existing profile', () => {
        setProfile('todelete', {
          name: 'To Delete',
          url: 'https://delete.example.com'
        });

        const result = deleteProfile('todelete');

        expect(result).toBe(true);
        expect(getProfiles().todelete).toBeUndefined();
      });

      it('should return false for non-existent profile', () => {
        const result = deleteProfile('nonexistent');

        expect(result).toBe(false);
      });

      it('should set new default if default profile is deleted', () => {
        setDefaultProfile('development');
        deleteProfile('development');

        const config = loadConfig();

        expect(config.defaultProfile).not.toBe('development');
      });
    });

    describe('setDefaultProfile', () => {
      it('should set the default profile', () => {
        setDefaultProfile('local');

        const config = loadConfig();

        expect(config.defaultProfile).toBe('local');
      });

      it('should throw error for non-existent profile', () => {
        expect(() => setDefaultProfile('nonexistent')).toThrow(
          "Profile 'nonexistent' not found"
        );
      });
    });
  });

  describe('Active Profile', () => {
    beforeEach(() => {
      loadConfig();
    });

    describe('getActiveProfileName', () => {
      it('should return default profile name', () => {
        const name = getActiveProfileName();

        expect(name).toBe('production');
      });

      it('should respect ARCHON_PROFILE env var', () => {
        process.env.ARCHON_PROFILE = 'local';

        const name = getActiveProfileName();

        expect(name).toBe('local');
      });

      it('should respect session override', () => {
        setActiveProfile('development');

        const name = getActiveProfileName();

        expect(name).toBe('development');
      });

      it('should prioritize session override over env var', () => {
        process.env.ARCHON_PROFILE = 'local';
        setActiveProfile('development');

        const name = getActiveProfileName();

        expect(name).toBe('development');
      });
    });

    describe('getActiveProfile', () => {
      it('should return the active profile', () => {
        const profile = getActiveProfile();

        expect(profile.name).toBe('Production');
        expect(profile.url).toBe('https://archon.zincapp.com');
      });

      it('should respect ARCHON_URL env var override', () => {
        process.env.ARCHON_URL = 'https://override.example.com';

        const profile = getActiveProfile();

        expect(profile.url).toBe('https://override.example.com');
      });

      it('should throw error for non-existent profile', () => {
        process.env.ARCHON_PROFILE = 'nonexistent';

        expect(() => getActiveProfile()).toThrow(
          "Profile 'nonexistent' not found"
        );
      });
    });

    describe('setActiveProfile', () => {
      it('should set session override', () => {
        setActiveProfile('local');

        expect(getActiveProfileName()).toBe('local');
      });

      it('should throw error for non-existent profile', () => {
        expect(() => setActiveProfile('nonexistent')).toThrow(
          "Profile 'nonexistent' not found"
        );
      });
    });
  });
});
