// Path: archon-cli/src/commands/auth.ts
// Authentication commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  login,
  logout,
  isLoggedIn,
  getStoredTokens,
  getValidToken
} from '../config/tokens.js';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { createApiClient } from '../api/client.js';
import { output, success, error, info, roleBadge } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface CurrentUser {
  id: number;
  username: string;
  email?: string;
  role: string;
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Authentication commands');

  // Login - supports: login, login <username>, login <username> <password>
  auth
    .command('login [username] [password]')
    .description('Login and save credentials')
    .action(async (usernameArg, passwordArg) => {
      try {
        const profile = getActiveProfile();
        const profileName = getActiveProfileName();

        info(`Logging in to ${profile.name} (${profile.url})`);

        let username = usernameArg;
        let password = passwordArg;

        // Interactive mode if credentials not provided
        if (!username || !password) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'username',
              message: 'Username:',
              when: !username,
              validate: (input: string) => input.length > 0 || 'Username is required'
            },
            {
              type: 'password',
              name: 'password',
              message: 'Password:',
              mask: '*',
              when: !password,
              validate: (input: string) => input.length > 0 || 'Password is required'
            }
          ]);

          username = username || answers.username;
          password = password || answers.password;
        }

        await withSpinner(
          'Authenticating...',
          async () => {
            await login(profileName, profile.url, username, password, profile.insecure);
          },
          'Authenticated successfully'
        );

        // Show who we logged in as
        const tokens = getStoredTokens(profileName);
        if (tokens?.user) {
          console.log(
            chalk.gray(`  Logged in as ${chalk.white(tokens.user.username)} (${roleBadge(tokens.user.role)})`)
          );
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Logout
  auth
    .command('logout')
    .description('Clear saved credentials')
    .action(() => {
      try {
        const profileName = getActiveProfileName();
        const profile = getActiveProfile();

        if (!isLoggedIn(profileName)) {
          info(`Not logged in to ${profile.name}.`);
          return;
        }

        logout(profileName);
        success(`Logged out from ${profile.name}.`);
      } catch (err) {
        handleError(err);
      }
    });

  // Status
  auth
    .command('status')
    .description('Show authentication status')
    .action(() => {
      try {
        const profileName = getActiveProfileName();
        const profile = getActiveProfile();
        const tokens = getStoredTokens(profileName);
        const loggedIn = isLoggedIn(profileName);

        const status = {
          profile: profileName,
          profileName: profile.name,
          url: profile.url,
          authenticated: loggedIn,
          user: tokens?.user?.username || null,
          role: tokens?.user?.role || null,
          expiresAt: tokens?.expiresAt
            ? new Date(tokens.expiresAt).toISOString()
            : null
        };

        output(status);

        // Add helpful message if not logged in
        if (!loggedIn) {
          console.log();
          console.log(chalk.gray('Run: archon auth login'));
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Me - show current user details from API
  auth
    .command('me')
    .description('Show current user details')
    .action(async () => {
      try {
        const profileName = getActiveProfileName();
        const profile = getActiveProfile();

        const token = await getValidToken(profileName, profile.url, profile.insecure);
        if (!token) {
          error('Not authenticated. Run: archon auth login');
          process.exit(1);
        }

        const api = createApiClient(profile.url, token, profile.insecure);

        const user = await withSpinner<CurrentUser>(
          'Fetching user info...',
          async () => api.get<CurrentUser>('/api/auth/me')
        );

        output({
          id: user.id,
          username: user.username,
          email: user.email || '-',
          role: user.role
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Password change
  auth
    .command('password')
    .description('Change password')
    .action(async () => {
      try {
        const profileName = getActiveProfileName();
        const profile = getActiveProfile();

        const token = await getValidToken(profileName, profile.url, profile.insecure);
        if (!token) {
          error('Not authenticated. Run: archon auth login');
          process.exit(1);
        }

        const answers = await inquirer.prompt([
          {
            type: 'password',
            name: 'currentPassword',
            message: 'Current password:',
            mask: '*'
          },
          {
            type: 'password',
            name: 'newPassword',
            message: 'New password:',
            mask: '*',
            validate: (input: string) => {
              if (input.length < 8) {
                return 'Password must be at least 8 characters';
              }
              return true;
            }
          },
          {
            type: 'password',
            name: 'confirmPassword',
            message: 'Confirm new password:',
            mask: '*',
            validate: (input: string, answers: { newPassword: string }) => {
              if (input !== answers.newPassword) {
                return 'Passwords do not match';
              }
              return true;
            }
          }
        ]);

        const api = createApiClient(profile.url, token, profile.insecure);

        await withSpinner(
          'Changing password...',
          async () => {
            await api.post('/api/auth/change-password', {
              currentPassword: answers.currentPassword,
              newPassword: answers.newPassword
            });
          },
          'Password changed successfully'
        );

        // Re-login with new password
        info('Re-authenticating with new password...');
        const tokens = getStoredTokens(profileName);
        if (tokens?.user?.username) {
          await login(profileName, profile.url, tokens.user.username, answers.newPassword, profile.insecure);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
