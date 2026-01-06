// Path: archon-cli/src/commands/ssh-keys.ts
// SSH host key management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { SshHostKey, SshHostKeyChange } from '../api/types.js';
import { output, success, error, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

const hostKeyTableConfig: TableConfig<SshHostKey[]> = {
  headers: ['ID', 'Machine', 'Key Type', 'Fingerprint', 'Trusted At'],
  transform: (keys) =>
    keys.map(k => [
      k.id.toString(),
      k.machineName,
      k.keyType,
      k.fingerprint.substring(0, 30) + '...',
      format(new Date(k.trustedAt), 'yyyy-MM-dd HH:mm')
    ])
};

const changeTableConfig: TableConfig<SshHostKeyChange[]> = {
  headers: ['ID', 'Machine', 'Type', 'Fingerprint', 'Detected At'],
  transform: (changes) =>
    changes.map(c => [
      c.id.toString(),
      c.machineName,
      c.changeType === 'NEW' ? chalk.green('NEW') : chalk.yellow('CHANGED'),
      c.newFingerprint.substring(0, 30) + '...',
      format(new Date(c.detectedAt), 'yyyy-MM-dd HH:mm')
    ])
};

export function registerSshKeyCommands(program: Command): void {
  const sshKeys = program
    .command('ssh-keys')
    .description('SSH host key management');

  // List trusted keys for a machine
  sshKeys
    .command('list <machineId>')
    .description('List trusted SSH host keys for a machine')
    .action(async (machineId) => {
      try {
        const api = await getAuthenticatedClient();

        const keys = await withSpinner<SshHostKey[]>(
          'Fetching host keys...',
          async () => api.get<SshHostKey[]>(`/api/machines/${machineId}/ssh-host-keys`)
        );

        if (keys.length === 0) {
          console.log(chalk.gray('No trusted host keys.'));
          return;
        }

        output(keys, hostKeyTableConfig);
      } catch (err) {
        handleError(err);
      }
    });

  // Delete a trusted key
  sshKeys
    .command('delete <id>')
    .description('Delete a trusted SSH host key')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: 'Delete this trusted host key?',
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting host key...',
          async () => api.delete(`/api/ssh-host-keys/${id}`),
          'Host key deleted'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // List pending key changes
  sshKeys
    .command('changes')
    .description('List pending SSH host key changes')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const response = await withSpinner<{ changes: SshHostKeyChange[] } | SshHostKeyChange[]>(
          'Fetching key changes...',
          async () => api.get<{ changes: SshHostKeyChange[] } | SshHostKeyChange[]>('/api/ssh-host-keys/changes')
        );

        // Handle both wrapped and unwrapped responses
        const changes = Array.isArray(response) ? response : response.changes;

        if (changes.length === 0) {
          console.log(chalk.gray('No pending key changes.'));
          return;
        }

        output(changes, changeTableConfig);
        console.log();
        console.log(chalk.gray('Use `archon ssh-keys approve <id>` to trust a new key'));
        console.log(chalk.gray('Use `archon ssh-keys reject <id>` to reject a key change'));
      } catch (err) {
        handleError(err);
      }
    });

  // Approve a key change
  sshKeys
    .command('approve <id>')
    .description('Approve and trust a host key change')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Approving key change...',
          async () => api.post(`/api/ssh-host-keys/changes/${id}/approve`),
          'Key change approved'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Reject a key change
  sshKeys
    .command('reject <id>')
    .description('Reject a host key change')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Rejecting key change...',
          async () => api.post(`/api/ssh-host-keys/changes/${id}/reject`),
          'Key change rejected'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Approve all pending changes
  sshKeys
    .command('approve-all')
    .description('Approve all pending host key changes')
    .option('-f, --force', 'Skip confirmation')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get pending changes count
        const response = await api.get<{ changes: SshHostKeyChange[] } | SshHostKeyChange[]>('/api/ssh-host-keys/changes');
        const changes = Array.isArray(response) ? response : response.changes;

        if (changes.length === 0) {
          console.log(chalk.gray('No pending key changes.'));
          return;
        }

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Approve all ${changes.length} pending key change(s)?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        const result = await withSpinner<{ count: number }>(
          'Approving all key changes...',
          async () => api.post<{ count: number }>('/api/ssh-host-keys/changes/approve-all')
        );

        success(`${result.count} key change(s) approved`);
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
