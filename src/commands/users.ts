// Path: archon-cli/src/commands/users.ts
// User management commands (admin only)

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { User } from '../api/types.js';
import { output, success, error, roleBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface UserListItem {
  id: number;
  username: string;
  email: string;
  role: string;
  lastLogin: string;
}

const userTableConfig: TableConfig<UserListItem[]> = {
  headers: ['ID', 'Username', 'Email', 'Role', 'Last Login'],
  transform: (users) =>
    users.map(u => [
      u.id.toString(),
      u.username,
      u.email || '-',
      roleBadge(u.role),
      u.lastLogin
    ])
};

export function registerUserCommands(program: Command): void {
  const users = program
    .command('users')
    .description('User management (admin only)');

  // List users
  users
    .command('list')
    .description('List all users')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const users = await withSpinner<User[]>(
          'Fetching users...',
          async () => api.get<User[]>('/api/users')
        );

        const items: UserListItem[] = users.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email || '-',
          role: u.role,
          lastLogin: u.lastLogin
            ? format(new Date(u.lastLogin), 'yyyy-MM-dd HH:mm')
            : 'Never'
        }));

        output(items, userTableConfig);
        console.log(chalk.gray(`\n${items.length} user(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get user details
  users
    .command('get <id>')
    .description('Get user details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const user = await withSpinner<User>(
          'Fetching user...',
          async () => api.get<User>(`/api/users/${id}`)
        );

        output({
          id: user.id,
          username: user.username,
          email: user.email || '-',
          role: user.role,
          createdAt: format(new Date(user.createdAt), 'yyyy-MM-dd HH:mm:ss'),
          lastLogin: user.lastLogin
            ? format(new Date(user.lastLogin), 'yyyy-MM-dd HH:mm:ss')
            : 'Never'
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Create user
  users
    .command('create')
    .description('Create a new user')
    .option('-u, --username <username>', 'Username')
    .option('-p, --password <password>', 'Password')
    .option('-e, --email <email>', 'Email')
    .option('-r, --role <role>', 'Role (ADMIN, OPERATOR, VIEWER)')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        let username = options.username;
        let password = options.password;
        let email = options.email;
        let role = options.role;

        if (!username || !password || !role) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'username',
              message: 'Username:',
              when: !username,
              validate: (input: string) => input.length >= 3 || 'Username must be at least 3 characters'
            },
            {
              type: 'password',
              name: 'password',
              message: 'Password:',
              mask: '*',
              when: !password,
              validate: (input: string) => input.length >= 8 || 'Password must be at least 8 characters'
            },
            {
              type: 'input',
              name: 'email',
              message: 'Email (optional):',
              when: !email
            },
            {
              type: 'list',
              name: 'role',
              message: 'Role:',
              choices: [
                { name: 'Admin - Full access', value: 'ADMIN' },
                { name: 'Operator - Can run updates', value: 'OPERATOR' },
                { name: 'Viewer - Read-only access', value: 'VIEWER' }
              ],
              when: !role
            }
          ]);

          username = username || answers.username;
          password = password || answers.password;
          email = email || answers.email;
          role = role || answers.role;
        }

        const user = await withSpinner<User>(
          'Creating user...',
          async () => api.post<User>('/api/users', {
            username,
            password,
            email: email || null,
            role
          }),
          'User created'
        );

        output({
          id: user.id,
          username: user.username,
          role: user.role
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Update user
  users
    .command('update <id>')
    .description('Update a user')
    .option('-e, --email <email>', 'Email')
    .option('-r, --role <role>', 'Role (ADMIN, OPERATOR, VIEWER)')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const updateData: Record<string, unknown> = {};
        if (options.email !== undefined) updateData.email = options.email;
        if (options.role !== undefined) updateData.role = options.role.toUpperCase();

        if (Object.keys(updateData).length === 0) {
          error('No update options provided. Use --email or --role.');
          process.exit(1);
        }

        await withSpinner(
          'Updating user...',
          async () => api.patch(`/api/users/${id}`, updateData),
          'User updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Delete user
  users
    .command('delete <id>')
    .description('Delete a user')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get user details first
        const user = await api.get<User>(`/api/users/${id}`);

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete user '${user.username}'?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting user...',
          async () => api.delete(`/api/users/${id}`),
          `User '${user.username}' deleted`
        );
      } catch (err) {
        handleError(err);
      }
    });
}

async function getAuthenticatedClient() {
  const profileName = getActiveProfileName();
  const profile = getActiveProfile();

  const token = await getValidToken(profileName, profile.url);
  if (!token) {
    error('Not authenticated. Run: archon auth login');
    process.exit(1);
  }

  return createApiClient(profile.url, token);
}
