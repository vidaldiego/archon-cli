// Path: archon-cli/src/utils/auth.ts
// Authentication helper utilities

import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient, ApiClient } from '../api/client.js';
import { error } from '../output/index.js';

/**
 * Get an authenticated API client for the active profile
 * Exits the process if not authenticated
 */
export async function getAuthenticatedClient(): Promise<ApiClient> {
  const profileName = getActiveProfileName();
  const profile = getActiveProfile();

  const token = await getValidToken(profileName, profile.url, profile.insecure);
  if (!token) {
    error('Not authenticated. Run: archon auth login');
    process.exit(1);
  }

  return createApiClient(profile.url, token, profile.insecure);
}
