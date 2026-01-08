// Path: archon-cli/src/utils/auth.ts
// Authentication helper utilities

import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken, loadTokens, isTokenExpired, TokenData } from '../config/tokens.js';
import { createApiClient, ApiClient } from '../api/client.js';
import { error, warn } from '../output/index.js';
import chalk from 'chalk';

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  token?: string;
  reason?: 'not_logged_in' | 'expired' | 'refresh_failed';
  tokenData?: TokenData;
}

/**
 * Check if the current session has a valid JWT token.
 * This does NOT attempt to refresh - use for quick pre-checks.
 */
export function checkTokenValidity(profileName?: string): TokenValidationResult {
  const name = profileName || getActiveProfileName();

  // Check for direct token override
  if (process.env.ARCHON_TOKEN) {
    return { valid: true, token: process.env.ARCHON_TOKEN };
  }

  // Check for auto-login credentials (will handle on demand)
  if (process.env.ARCHON_USER && process.env.ARCHON_PASS) {
    return { valid: true };
  }

  // Load stored tokens
  const tokens = loadTokens(name);

  if (!tokens) {
    return { valid: false, reason: 'not_logged_in' };
  }

  if (isTokenExpired(tokens)) {
    return { valid: false, reason: 'expired', tokenData: tokens };
  }

  return { valid: true, token: tokens.accessToken, tokenData: tokens };
}

/**
 * Require a valid authentication before proceeding.
 * Checks token validity and provides helpful error messages.
 * Exits the process if not authenticated.
 */
export async function requireAuth(): Promise<string> {
  const profileName = getActiveProfileName();
  const profile = getActiveProfile();

  // Quick check first
  const validation = checkTokenValidity(profileName);

  if (!validation.valid) {
    switch (validation.reason) {
      case 'not_logged_in':
        error('Not logged in.');
        console.error(chalk.gray(`Run: archon auth login`));
        process.exit(1);
        break;

      case 'expired':
        // Token is expired, but we'll try to refresh
        warn('Session expired. Attempting to refresh...');
        break;
    }
  }

  // Try to get a valid token (with refresh if needed)
  const token = await getValidToken(profileName, profile.url, profile.insecure);

  if (!token) {
    error('Session expired and could not be refreshed.');
    console.error(chalk.gray('Run: archon auth login'));
    process.exit(1);
  }

  return token;
}

/**
 * Get an authenticated API client for the active profile.
 * Validates token and attempts refresh if expired.
 * Exits the process if not authenticated.
 */
export async function getAuthenticatedClient(): Promise<ApiClient> {
  const profile = getActiveProfile();
  const token = await requireAuth();
  return createApiClient(profile.url, token, profile.insecure);
}

/**
 * Get the current user info from stored tokens, if available.
 */
export function getCurrentUser(profileName?: string): { id: number; username: string; role: string } | null {
  const name = profileName || getActiveProfileName();
  const tokens = loadTokens(name);
  return tokens?.user || null;
}
