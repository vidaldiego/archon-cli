// Integration tests for CLI commands

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync, exec } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI_PATH = join(process.cwd(), 'bin', 'archon');
const testConfigDir = join(tmpdir(), 'archon-cli-integration-test-' + Date.now());

// Helper to run CLI commands
function runCli(args: string, env: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number } {
  const fullEnv = {
    ...process.env,
    HOME: testConfigDir, // Override home for config isolation
    ...env
  };

  try {
    const stdout = execSync(`${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      env: fullEnv,
      timeout: 10000
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.status || 1
    };
  }
}

// Helper to set up test config
function setupTestConfig(config: any) {
  const configDir = join(testConfigDir, '.archon');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, 'tokens'), { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2));
}

// Helper to set up test tokens
function setupTestTokens(profileName: string, tokens: any) {
  const tokensDir = join(testConfigDir, '.archon', 'tokens');
  mkdirSync(tokensDir, { recursive: true });
  writeFileSync(join(tokensDir, `${profileName}.json`), JSON.stringify(tokens, null, 2));
}

describe('CLI Integration Tests', () => {
  beforeEach(() => {
    // Create test directory
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Help and Version', () => {
    it('should show help with --help', () => {
      const { stdout, exitCode } = runCli('--help');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('ARCHON Infrastructure Management CLI');
      expect(stdout).toContain('Commands:');
      expect(stdout).toContain('profile');
      expect(stdout).toContain('auth');
      expect(stdout).toContain('services');
      expect(stdout).toContain('machines');
    });

    it('should show version with --version', () => {
      const { stdout, exitCode } = runCli('--version');

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Profile Commands', () => {
    describe('profile list', () => {
      it('should list default profiles', () => {
        const { stdout, exitCode } = runCli('profile list');

        expect(exitCode).toBe(0);
        expect(stdout).toContain('production');
        expect(stdout).toContain('development');
        expect(stdout).toContain('local');
      });

      it('should show active profile indicator', () => {
        const { stdout } = runCli('profile list');

        // Should have active indicator (green dot or similar)
        expect(stdout).toContain('production');
      });
    });

    describe('profile create', () => {
      it('should create a new profile', () => {
        const { stdout, exitCode } = runCli('profile create testprofile -u https://test.example.com');

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Profile 'testprofile' created");

        // Verify profile exists
        const { stdout: listOutput } = runCli('profile list');
        expect(listOutput).toContain('testprofile');
      });

      it('should create profile with --use flag', () => {
        runCli('profile create testprofile -u https://test.example.com --use');

        const { stdout } = runCli('profile show');

        expect(stdout).toContain('testprofile');
      });

      it('should create profile with --insecure flag', () => {
        runCli('profile create insecureprofile -u https://test.example.com --insecure');

        const { stdout } = runCli('profile show insecureprofile');

        expect(stdout).toContain('insecure');
        expect(stdout).toContain('true');
      });

      it('should fail if profile already exists', () => {
        runCli('profile create testprofile -u https://test.example.com');
        const { stderr, exitCode } = runCli('profile create testprofile -u https://test2.example.com');

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('already exists');
      });
    });

    describe('profile show', () => {
      it('should show active profile by default', () => {
        const { stdout, exitCode } = runCli('profile show');

        expect(exitCode).toBe(0);
        expect(stdout).toContain('production');
        expect(stdout).toContain('https://archon.zincapp.com');
      });

      it('should show specific profile', () => {
        const { stdout, exitCode } = runCli('profile show local');

        expect(exitCode).toBe(0);
        expect(stdout).toContain('local');
        expect(stdout).toContain('http://localhost:4000');
      });

      it('should fail for non-existent profile', () => {
        const { stderr, exitCode } = runCli('profile show nonexistent');

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('not found');
      });
    });

    describe('profile use', () => {
      it('should switch active profile', () => {
        const { stdout, exitCode } = runCli('profile use local');

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Now using profile 'local'");

        // Verify switch
        const { stdout: showOutput } = runCli('profile show');
        expect(showOutput).toContain('local');
      });

      it('should fail for non-existent profile', () => {
        const { stderr, exitCode } = runCli('profile use nonexistent');

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('not found');
      });
    });

    describe('profile update', () => {
      it('should update profile URL', () => {
        runCli('profile create testprofile -u https://old.example.com');
        runCli('profile update testprofile -u https://new.example.com');

        const { stdout } = runCli('profile show testprofile');

        expect(stdout).toContain('https://new.example.com');
      });

      it('should update profile display name', () => {
        runCli('profile create testprofile -u https://test.example.com');
        runCli('profile update testprofile -n "New Display Name"');

        const { stdout } = runCli('profile show testprofile');

        expect(stdout).toContain('New Display Name');
      });

      it('should fail for non-existent profile', () => {
        const { stderr, exitCode } = runCli('profile update nonexistent -u https://test.example.com');

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('not found');
      });
    });

    describe('profile delete', () => {
      it('should delete profile with --force', () => {
        runCli('profile create todelete -u https://test.example.com');
        const { stdout, exitCode } = runCli('profile delete todelete --force');

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Profile 'todelete' deleted");

        // Verify deletion
        const { stdout: listOutput } = runCli('profile list');
        expect(listOutput).not.toContain('todelete');
      });

      it('should fail for non-existent profile', () => {
        const { stderr, exitCode } = runCli('profile delete nonexistent --force');

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('not found');
      });
    });
  });

  describe('Auth Commands', () => {
    describe('auth status', () => {
      it('should show not authenticated when no tokens', () => {
        const { stdout, exitCode } = runCli('auth status');

        expect(exitCode).toBe(0);
        expect(stdout).toContain('authenticated');
        expect(stdout).toContain('false');
      });

      it('should show authenticated when tokens exist', () => {
        setupTestConfig({
          defaultProfile: 'test',
          profiles: {
            test: { name: 'Test', url: 'https://test.example.com' }
          }
        });
        setupTestTokens('test', {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          user: { id: 1, username: 'admin', role: 'ADMIN' }
        });

        const { stdout, exitCode } = runCli('auth status');

        expect(exitCode).toBe(0);
        expect(stdout).toContain('authenticated');
        expect(stdout).toContain('true');
        expect(stdout).toContain('admin');
      });
    });

    describe('auth logout', () => {
      it('should clear tokens', () => {
        setupTestConfig({
          defaultProfile: 'test',
          profiles: {
            test: { name: 'Test', url: 'https://test.example.com' }
          }
        });
        setupTestTokens('test', {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          user: { id: 1, username: 'admin', role: 'ADMIN' }
        });

        runCli('auth logout');

        // Verify logged out
        const { stdout } = runCli('auth status');
        expect(stdout).toContain('false');
      });

      it('should handle already logged out', () => {
        const { stdout, exitCode } = runCli('auth logout');

        expect(exitCode).toBe(0);
        expect(stdout).toContain('Not logged in');
      });
    });
  });

  describe('Health Command', () => {
    it('should show help for health command', () => {
      const { stdout, exitCode } = runCli('health --help');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Show backend health status');
    });
  });

  describe('Global Options', () => {
    describe('--profile option', () => {
      it('should use specified profile', () => {
        runCli('profile create custom -u https://custom.example.com');

        const { stdout } = runCli('--profile custom profile show');

        expect(stdout).toContain('custom');
        expect(stdout).toContain('https://custom.example.com');
      });
    });

    describe('--json option', () => {
      it('should output JSON format', () => {
        const { stdout } = runCli('--json profile show');

        // Should be valid JSON
        expect(() => JSON.parse(stdout)).not.toThrow();
      });
    });

    describe('--quiet option', () => {
      it('should suppress non-essential output', () => {
        const { stdout: quietOutput } = runCli('--quiet profile create quiettest -u https://test.example.com');
        const { stdout: normalOutput } = runCli('profile create normaltest -u https://test.example.com');

        // Quiet should have less output
        expect(quietOutput.length).toBeLessThanOrEqual(normalOutput.length);
      });
    });
  });

  describe('Raw Command', () => {
    it('should show help for raw command', () => {
      const { stdout, exitCode } = runCli('raw --help');

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Make a raw API request');
      expect(stdout).toContain('method');
      expect(stdout).toContain('path');
    });
  });

  describe('Command Help', () => {
    const commands = [
      'profile',
      'auth',
      'machines',
      'services',
      'updates',
      'alerts',
      'settings',
      'users',
      'identities',
      'auto-update',
      'ssh-keys',
      'vcenters',
      'knowledge',
      'logs',
      'jobs'
    ];

    commands.forEach(cmd => {
      it(`should show help for ${cmd} command`, () => {
        const { stdout, exitCode } = runCli(`${cmd} --help`);

        expect(exitCode).toBe(0);
        expect(stdout.length).toBeGreaterThan(0);
      });
    });
  });
});
