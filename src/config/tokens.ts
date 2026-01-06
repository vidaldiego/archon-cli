// Path: archon-cli/src/config/tokens.ts
// Token management - storage, refresh, and validation

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { jwtDecode } from 'jwt-decode';
import https from 'https';
import { getTokensDir, getActiveProfileName, ensureConfigDirs } from './index.js';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: {
    id: number;
    username: string;
    role: string;
  };
}

interface JwtPayload {
  exp: number;
  sub: string;
  username: string;
  role: string;
}

// Create an HTTPS agent that ignores certificate errors
const insecureAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * Get fetch options for insecure mode
 */
function getFetchOptions(insecure?: boolean): RequestInit {
  if (insecure) {
    return {
      // @ts-expect-error Node.js specific option
      agent: insecureAgent
    };
  }
  return {};
}

/**
 * Get the token file path for a profile
 */
function getTokenFilePath(profileName?: string): string {
  const name = profileName || getActiveProfileName();
  return join(getTokensDir(), `${name}.json`);
}

/**
 * Load tokens from disk for the current profile
 */
export function loadTokens(profileName?: string): TokenData | null {
  const tokenFile = getTokenFilePath(profileName);

  if (!existsSync(tokenFile)) {
    return null;
  }

  try {
    const data = readFileSync(tokenFile, 'utf-8');
    return JSON.parse(data) as TokenData;
  } catch {
    return null;
  }
}

/**
 * Save tokens to disk for the current profile
 */
export function saveTokens(tokens: TokenData, profileName?: string): void {
  ensureConfigDirs();
  const tokenFile = getTokenFilePath(profileName);
  writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
}

/**
 * Delete tokens for a profile
 */
export function deleteTokens(profileName?: string): boolean {
  const tokenFile = getTokenFilePath(profileName);

  if (existsSync(tokenFile)) {
    unlinkSync(tokenFile);
    return true;
  }
  return false;
}

/**
 * Check if a token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(tokens: TokenData): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
  return tokens.expiresAt < Date.now() + bufferMs;
}

/**
 * Parse JWT and extract user info
 */
export function parseJwt(token: string): { exp: number; username: string; role: string } | null {
  try {
    const decoded = jwtDecode<JwtPayload>(token);
    return {
      exp: decoded.exp * 1000, // Convert to milliseconds
      username: decoded.username,
      role: decoded.role
    };
  } catch {
    return null;
  }
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user?: { id: number; username: string; role: string };
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

/**
 * Login and store tokens
 */
export async function login(
  profileName: string,
  url: string,
  username: string,
  password: string,
  insecure?: boolean
): Promise<TokenData> {
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Mode': 'token'
    },
    body: JSON.stringify({ username, password }),
    ...getFetchOptions(insecure)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' })) as ErrorResponse;
    throw new Error(error.error || error.message || 'Login failed');
  }

  const data = await response.json() as LoginResponse;

  const tokens: TokenData = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
    user: data.user || { id: 0, username, role: 'VIEWER' }
  };

  saveTokens(tokens, profileName);
  return tokens;
}

interface RefreshResponse {
  accessToken: string;
  expiresIn?: number;
}

/**
 * Refresh the access token
 */
export async function refreshAccessToken(
  tokens: TokenData,
  url: string,
  profileName?: string,
  insecure?: boolean
): Promise<TokenData> {
  const response = await fetch(`${url}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    ...getFetchOptions(insecure)
  });

  if (!response.ok) {
    // Refresh failed - tokens are invalid
    deleteTokens(profileName);
    throw new Error('Session expired. Please login again.');
  }

  const data = await response.json() as RefreshResponse;

  const newTokens: TokenData = {
    ...tokens,
    accessToken: data.accessToken,
    expiresAt: Date.now() + (data.expiresIn || 3600) * 1000
  };

  saveTokens(newTokens, profileName);
  return newTokens;
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidToken(
  profileName: string,
  url: string,
  insecure?: boolean
): Promise<string | null> {
  // Check for direct token override
  if (process.env.ARCHON_TOKEN) {
    return process.env.ARCHON_TOKEN;
  }

  // Check for auto-login credentials
  if (process.env.ARCHON_USER && process.env.ARCHON_PASS) {
    let tokens = loadTokens(profileName);
    if (!tokens || isTokenExpired(tokens)) {
      tokens = await login(profileName, url, process.env.ARCHON_USER, process.env.ARCHON_PASS, insecure);
    }
    return tokens.accessToken;
  }

  // Load from file
  let tokens = loadTokens(profileName);

  if (!tokens) {
    return null;
  }

  // Refresh if expired
  if (isTokenExpired(tokens)) {
    try {
      tokens = await refreshAccessToken(tokens, url, profileName, insecure);
    } catch {
      return null;
    }
  }

  return tokens.accessToken;
}

/**
 * Logout - delete tokens
 */
export function logout(profileName?: string): void {
  deleteTokens(profileName);
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(profileName?: string): boolean {
  if (process.env.ARCHON_TOKEN) {
    return true;
  }

  if (process.env.ARCHON_USER && process.env.ARCHON_PASS) {
    return true;
  }

  const tokens = loadTokens(profileName);
  return tokens !== null;
}

/**
 * Get stored tokens without validation (for display purposes)
 */
export function getStoredTokens(profileName?: string): TokenData | null {
  return loadTokens(profileName);
}
