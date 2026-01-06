// Path: archon-cli/src/commands/identities.ts
// SSH identity management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { Identity } from '../api/types.js';
import { output, success, error, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface IdentityListItem {
  id: number;
  name: string;
  username: string;
  authType: string;
  isDefault: string;
  machines: number;
}

const identityTableConfig: TableConfig<IdentityListItem[]> = {
  headers: ['ID', 'Name', 'Username', 'Auth Type', 'Default', 'Machines'],
  transform: (identities) =>
    identities.map(i => [
      i.id.toString(),
      i.name,
      i.username,
      i.authType,
      i.isDefault,
      i.machines.toString()
    ])
};

export function registerIdentityCommands(program: Command): void {
  const identities = program
    .command('identities')
    .description('SSH identity management');

  // List identities
  identities
    .command('list')
    .description('List all identities')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const identities = await withSpinner<Identity[]>(
          'Fetching identities...',
          async () => api.get<Identity[]>('/api/identities')
        );

        const items: IdentityListItem[] = identities.map(i => ({
          id: i.id,
          name: i.name,
          username: i.username,
          authType: i.authType,
          isDefault: i.isDefault ? chalk.green('Yes') : '-',
          machines: i.machineCount
        }));

        output(items, identityTableConfig);
        console.log(chalk.gray(`\n${items.length} identity(ies)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get identity details
  identities
    .command('get <id>')
    .description('Get identity details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const identity = await withSpinner<Identity>(
          'Fetching identity...',
          async () => api.get<Identity>(`/api/identities/${id}`)
        );

        output({
          id: identity.id,
          name: identity.name,
          username: identity.username,
          authType: identity.authType,
          isDefault: identity.isDefault,
          machineCount: identity.machineCount,
          createdAt: format(new Date(identity.createdAt), 'yyyy-MM-dd HH:mm:ss')
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Create identity
  identities
    .command('create')
    .description('Create a new identity')
    .option('-n, --name <name>', 'Identity name')
    .option('-u, --username <username>', 'SSH username')
    .option('-t, --type <type>', 'Auth type (PASSWORD, SSH_KEY)')
    .option('-p, --password <password>', 'Password (for PASSWORD type)')
    .option('-k, --key <key>', 'Private key (for SSH_KEY type)')
    .option('-d, --default', 'Set as default identity')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        let name = options.name;
        let username = options.username;
        let authType = options.type;
        let password = options.password;
        let privateKey = options.key;
        let isDefault = options.default || false;

        if (!name || !username || !authType) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'name',
              message: 'Identity name:',
              when: !name,
              validate: (input: string) => input.length > 0 || 'Name is required'
            },
            {
              type: 'input',
              name: 'username',
              message: 'SSH username:',
              when: !username,
              default: 'sysadmin'
            },
            {
              type: 'list',
              name: 'authType',
              message: 'Authentication type:',
              choices: [
                { name: 'Password', value: 'PASSWORD' },
                { name: 'SSH Key', value: 'SSH_KEY' }
              ],
              when: !authType
            },
            {
              type: 'password',
              name: 'password',
              message: 'Password:',
              mask: '*',
              when: (answers: { authType?: string }) =>
                (answers.authType || authType) === 'PASSWORD' && !password
            },
            {
              type: 'editor',
              name: 'privateKey',
              message: 'Private key (opens editor):',
              when: (answers: { authType?: string }) =>
                (answers.authType || authType) === 'SSH_KEY' && !privateKey
            },
            {
              type: 'confirm',
              name: 'isDefault',
              message: 'Set as default identity?',
              default: false,
              when: !options.default
            }
          ]);

          name = name || answers.name;
          username = username || answers.username;
          authType = authType || answers.authType;
          password = password || answers.password;
          privateKey = privateKey || answers.privateKey;
          isDefault = options.default || answers.isDefault;
        }

        const payload: Record<string, unknown> = {
          name,
          username,
          authType,
          isDefault
        };

        if (authType === 'PASSWORD') {
          payload.password = password;
        } else {
          payload.privateKey = privateKey;
        }

        const identity = await withSpinner<Identity>(
          'Creating identity...',
          async () => api.post<Identity>('/api/identities', payload),
          'Identity created'
        );

        output({
          id: identity.id,
          name: identity.name,
          username: identity.username
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Update identity
  identities
    .command('update <id>')
    .description('Update an identity')
    .option('-n, --name <name>', 'Identity name')
    .option('-u, --username <username>', 'SSH username')
    .option('-p, --password <password>', 'New password')
    .option('-d, --default', 'Set as default identity')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const updateData: Record<string, unknown> = {};
        if (options.name !== undefined) updateData.name = options.name;
        if (options.username !== undefined) updateData.username = options.username;
        if (options.password !== undefined) updateData.password = options.password;
        if (options.default !== undefined) updateData.isDefault = options.default;

        if (Object.keys(updateData).length === 0) {
          error('No update options provided.');
          process.exit(1);
        }

        await withSpinner(
          'Updating identity...',
          async () => api.patch(`/api/identities/${id}`, updateData),
          'Identity updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Delete identity
  identities
    .command('delete <id>')
    .description('Delete an identity')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get identity details first
        const identity = await api.get<Identity>(`/api/identities/${id}`);

        if (identity.machineCount > 0 && !options.force) {
          error(`Identity '${identity.name}' is assigned to ${identity.machineCount} machine(s).`);
          console.log(chalk.gray('Use --force to delete anyway.'));
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete identity '${identity.name}'?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting identity...',
          async () => api.delete(`/api/identities/${id}`),
          `Identity '${identity.name}' deleted`
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Test identity
  identities
    .command('test <id>')
    .description('Test identity connection')
    .option('-m, --machine <machineId>', 'Machine to test against')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const endpoint = options.machine
          ? `/api/identities/${id}/test?machineId=${options.machine}`
          : `/api/identities/${id}/test`;

        const result = await withSpinner<{ success: boolean; message: string }>(
          'Testing identity...',
          async () => api.post<{ success: boolean; message: string }>(endpoint)
        );

        if (result.success) {
          success(result.message);
        } else {
          error(result.message);
        }
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
