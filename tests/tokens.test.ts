// Tests for config/tokens.ts - Token management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the homedir to use a temp directory
const testConfigDir = join(tmpdir(), 'archon-cli-tokens-test-' + Date.now());

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => testConfigDir
  };
});

// Mock fetch for login/refresh tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
const {
  loadTokens,
  saveTokens,
  deleteTokens,
  isTokenExpired,
  parseJwt,
  login,
  refreshAccessToken,
  getValidToken,
  logout,
  isLoggedIn,
  getStoredTokens
} = await import('../src/config/tokens.js');

const { ensureConfigDirs, getTokensDir } = await import('../src/config/index.js');

describe('Tokens Module', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
    ensureConfigDirs();

    // Clear env vars
    delete process.env.ARCHON_TOKEN;
    delete process.env.ARCHON_USER;
    delete process.env.ARCHON_PASS;

    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Token Storage', () => {
    const sampleTokens = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      user: { id: 1, username: 'testuser', role: 'ADMIN' }
    };

    describe('saveTokens', () => {
      it('should save tokens to file', () => {
        saveTokens(sampleTokens, 'testprofile');

        const tokenFile = join(getTokensDir(), 'testprofile.json');
        expect(existsSync(tokenFile)).toBe(true);

        const savedData = JSON.parse(readFileSync(tokenFile, 'utf-8'));
        expect(savedData.accessToken).toBe('test-access-token');
        expect(savedData.user.username).toBe('testuser');
      });
    });

    describe('loadTokens', () => {
      it('should return null if no token file exists', () => {
        const tokens = loadTokens('nonexistent');
        expect(tokens).toBeNull();
      });

      it('should load tokens from file', () => {
        saveTokens(sampleTokens, 'testprofile');

        const tokens = loadTokens('testprofile');

        expect(tokens).not.toBeNull();
        expect(tokens!.accessToken).toBe('test-access-token');
        expect(tokens!.user.username).toBe('testuser');
      });
    });

    describe('deleteTokens', () => {
      it('should delete token file', () => {
        saveTokens(sampleTokens, 'testprofile');

        const result = deleteTokens('testprofile');

        expect(result).toBe(true);
        expect(loadTokens('testprofile')).toBeNull();
      });

      it('should return false if no token file exists', () => {
        const result = deleteTokens('nonexistent');
        expect(result).toBe(false);
      });
    });

    describe('getStoredTokens', () => {
      it('should return stored tokens', () => {
        saveTokens(sampleTokens, 'testprofile');

        const tokens = getStoredTokens('testprofile');

        expect(tokens).not.toBeNull();
        expect(tokens!.accessToken).toBe('test-access-token');
      });
    });
  });

  describe('Token Expiration', () => {
    describe('isTokenExpired', () => {
      it('should return false for non-expired token', () => {
        const tokens = {
          accessToken: 'test',
          refreshToken: 'test',
          expiresAt: Date.now() + 3600000, // 1 hour in future
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };

        expect(isTokenExpired(tokens)).toBe(false);
      });

      it('should return true for expired token', () => {
        const tokens = {
          accessToken: 'test',
          refreshToken: 'test',
          expiresAt: Date.now() - 1000, // 1 second in past
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };

        expect(isTokenExpired(tokens)).toBe(true);
      });

      it('should return true for token expiring within 5 minutes', () => {
        const tokens = {
          accessToken: 'test',
          refreshToken: 'test',
          expiresAt: Date.now() + 60000, // 1 minute in future (< 5 min buffer)
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };

        expect(isTokenExpired(tokens)).toBe(true);
      });
    });
  });

  describe('JWT Parsing', () => {
    describe('parseJwt', () => {
      it('should parse valid JWT', () => {
        // JWT with payload: {"sub":"1","username":"admin","role":"ADMIN","exp":9999999999}
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiIsImV4cCI6OTk5OTk5OTk5OX0.test';

        const result = parseJwt(jwt);

        expect(result).not.toBeNull();
        expect(result!.username).toBe('admin');
        expect(result!.role).toBe('ADMIN');
      });

      it('should return null for invalid JWT', () => {
        const result = parseJwt('invalid-token');
        expect(result).toBeNull();
      });
    });
  });

  describe('Authentication', () => {
    describe('login', () => {
      it('should login and store tokens', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresIn: 3600,
            user: { id: 1, username: 'admin', role: 'ADMIN' }
          })
        });

        const tokens = await login(
          'testprofile',
          'https://test.example.com',
          'admin',
          'password123'
        );

        expect(tokens.accessToken).toBe('new-access-token');
        expect(tokens.user.username).toBe('admin');

        // Verify fetch was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          'https://test.example.com/api/auth/login',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              'X-Auth-Mode': 'token'
            }),
            body: JSON.stringify({ username: 'admin', password: 'password123' })
          })
        );

        // Verify tokens were saved
        const savedTokens = loadTokens('testprofile');
        expect(savedTokens).not.toBeNull();
        expect(savedTokens!.accessToken).toBe('new-access-token');
      });

      it('should throw error on login failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Invalid credentials' })
        });

        await expect(
          login('testprofile', 'https://test.example.com', 'admin', 'wrong')
        ).rejects.toThrow('Invalid credentials');
      });
    });

    describe('refreshAccessToken', () => {
      it('should refresh and store new tokens', async () => {
        const existingTokens = {
          accessToken: 'old-access-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now(),
          user: { id: 1, username: 'admin', role: 'ADMIN' }
        };
        saveTokens(existingTokens, 'testprofile');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'new-access-token',
            expiresIn: 3600
          })
        });

        const newTokens = await refreshAccessToken(
          existingTokens,
          'https://test.example.com',
          'testprofile'
        );

        expect(newTokens.accessToken).toBe('new-access-token');
        expect(newTokens.refreshToken).toBe('refresh-token'); // Should keep existing

        // Verify tokens were saved
        const savedTokens = loadTokens('testprofile');
        expect(savedTokens!.accessToken).toBe('new-access-token');
      });

      it('should delete tokens and throw on refresh failure', async () => {
        const existingTokens = {
          accessToken: 'old-access-token',
          refreshToken: 'invalid-refresh',
          expiresAt: Date.now(),
          user: { id: 1, username: 'admin', role: 'ADMIN' }
        };
        saveTokens(existingTokens, 'testprofile');

        mockFetch.mockResolvedValueOnce({
          ok: false
        });

        await expect(
          refreshAccessToken(existingTokens, 'https://test.example.com', 'testprofile')
        ).rejects.toThrow('Session expired');

        // Tokens should be deleted
        expect(loadTokens('testprofile')).toBeNull();
      });
    });

    describe('logout', () => {
      it('should delete tokens', () => {
        const tokens = {
          accessToken: 'test',
          refreshToken: 'test',
          expiresAt: Date.now() + 3600000,
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };
        saveTokens(tokens, 'testprofile');

        logout('testprofile');

        expect(loadTokens('testprofile')).toBeNull();
      });
    });

    describe('isLoggedIn', () => {
      it('should return false if no tokens exist', () => {
        expect(isLoggedIn('testprofile')).toBe(false);
      });

      it('should return true if tokens exist', () => {
        const tokens = {
          accessToken: 'test',
          refreshToken: 'test',
          expiresAt: Date.now() + 3600000,
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };
        saveTokens(tokens, 'testprofile');

        expect(isLoggedIn('testprofile')).toBe(true);
      });

      it('should return true if ARCHON_TOKEN env var is set', () => {
        process.env.ARCHON_TOKEN = 'env-token';

        expect(isLoggedIn('anyprofile')).toBe(true);
      });

      it('should return true if ARCHON_USER and ARCHON_PASS are set', () => {
        process.env.ARCHON_USER = 'admin';
        process.env.ARCHON_PASS = 'password';

        expect(isLoggedIn('anyprofile')).toBe(true);
      });
    });

    describe('getValidToken', () => {
      it('should return env token if ARCHON_TOKEN is set', async () => {
        process.env.ARCHON_TOKEN = 'env-token';

        const token = await getValidToken('testprofile', 'https://test.example.com');

        expect(token).toBe('env-token');
      });

      it('should auto-login with ARCHON_USER/ARCHON_PASS', async () => {
        process.env.ARCHON_USER = 'admin';
        process.env.ARCHON_PASS = 'password';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'auto-login-token',
            refreshToken: 'refresh-token',
            expiresIn: 3600,
            user: { id: 1, username: 'admin', role: 'ADMIN' }
          })
        });

        const token = await getValidToken('testprofile', 'https://test.example.com');

        expect(token).toBe('auto-login-token');
      });

      it('should return stored token if valid', async () => {
        const tokens = {
          accessToken: 'stored-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };
        saveTokens(tokens, 'testprofile');

        const token = await getValidToken('testprofile', 'https://test.example.com');

        expect(token).toBe('stored-token');
      });

      it('should refresh expired token', async () => {
        const tokens = {
          accessToken: 'expired-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 1000, // Expired
          user: { id: 1, username: 'test', role: 'ADMIN' }
        };
        saveTokens(tokens, 'testprofile');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'refreshed-token',
            expiresIn: 3600
          })
        });

        const token = await getValidToken('testprofile', 'https://test.example.com');

        expect(token).toBe('refreshed-token');
      });

      it('should return null if no tokens and no env vars', async () => {
        const token = await getValidToken('testprofile', 'https://test.example.com');

        expect(token).toBeNull();
      });
    });
  });
});
