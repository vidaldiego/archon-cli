// Path: archon-cli/src/commands/raw.ts
// Raw API request command

import { Command } from 'commander';
import chalk from 'chalk';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { outputJson, error } from '../output/index.js';
import { handleError } from '../utils/errors.js';

export function registerRawCommand(program: Command): void {
  program
    .command('raw <method> <path> [body]')
    .description('Make a raw API request')
    .option('--no-auth', 'Skip authentication')
    .action(async (method, path, body, options) => {
      try {
        const profile = getActiveProfile();
        const profileName = getActiveProfileName();

        // Ensure path starts with /
        if (!path.startsWith('/')) {
          path = '/' + path;
        }

        let token: string | null = null;
        if (options.auth !== false) {
          token = await getValidToken(profileName, profile.url);
          if (!token) {
            error('Not authenticated. Run: archon auth login');
            console.log(chalk.gray('Or use --no-auth to skip authentication'));
            process.exit(1);
          }
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const url = `${profile.url}${path}`;
        const upperMethod = method.toUpperCase();

        console.error(chalk.gray(`${upperMethod} ${url}`));

        const fetchOptions: RequestInit = {
          method: upperMethod,
          headers
        };

        if (body && ['POST', 'PUT', 'PATCH'].includes(upperMethod)) {
          // Try to parse as JSON, otherwise use as-is
          try {
            fetchOptions.body = JSON.stringify(JSON.parse(body));
          } catch {
            fetchOptions.body = body;
          }
        }

        const response = await fetch(url, fetchOptions);

        console.error(chalk.gray(`Status: ${response.status} ${response.statusText}`));

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const data = await response.json();
          outputJson(data);
        } else {
          const text = await response.text();
          console.log(text);
        }

        if (!response.ok) {
          process.exit(1);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
