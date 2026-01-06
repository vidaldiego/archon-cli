// Path: archon-cli/src/commands/vcenters.ts
// vCenter management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { VCenter } from '../api/types.js';
import { output, success, error, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface VCenterListItem {
  id: number;
  name: string;
  url: string;
  enabled: string;
  machines: number;
  lastSync: string;
}

const vcenterTableConfig: TableConfig<VCenterListItem[]> = {
  headers: ['ID', 'Name', 'URL', 'Enabled', 'Machines', 'Last Sync'],
  transform: (vcenters) =>
    vcenters.map(v => [
      v.id.toString(),
      v.name,
      v.url,
      v.enabled,
      v.machines.toString(),
      v.lastSync
    ])
};

interface DiscoveredVm {
  name: string;
  uuid: string;
  folder: string;
  powerState: string;
  guestOs: string;
}

export function registerVCenterCommands(program: Command): void {
  const vcenters = program
    .command('vcenters')
    .description('vCenter management');

  // List vCenters
  vcenters
    .command('list')
    .description('List all vCenters')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const vcenters = await withSpinner<VCenter[]>(
          'Fetching vCenters...',
          async () => api.get<VCenter[]>('/api/vcenters')
        );

        const items: VCenterListItem[] = vcenters.map(v => ({
          id: v.id,
          name: v.name,
          url: v.url,
          enabled: v.enabled ? chalk.green('Yes') : chalk.gray('No'),
          machines: v.machineCount,
          lastSync: v.lastSync
            ? format(new Date(v.lastSync), 'yyyy-MM-dd HH:mm')
            : 'Never'
        }));

        output(items, vcenterTableConfig);
        console.log(chalk.gray(`\n${items.length} vCenter(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get vCenter details
  vcenters
    .command('get <id>')
    .description('Get vCenter details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const vcenter = await withSpinner<VCenter>(
          'Fetching vCenter...',
          async () => api.get<VCenter>(`/api/vcenters/${id}`)
        );

        output({
          id: vcenter.id,
          name: vcenter.name,
          url: vcenter.url,
          username: vcenter.username,
          enabled: vcenter.enabled,
          machineCount: vcenter.machineCount,
          lastSync: vcenter.lastSync
            ? format(new Date(vcenter.lastSync), 'yyyy-MM-dd HH:mm:ss')
            : 'Never'
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Create vCenter
  vcenters
    .command('create')
    .description('Add a new vCenter')
    .option('-n, --name <name>', 'Display name')
    .option('-u, --url <url>', 'vCenter URL')
    .option('--username <username>', 'vCenter username')
    .option('--password <password>', 'vCenter password')
    .option('-e, --enabled', 'Enable the vCenter')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        let name = options.name;
        let url = options.url;
        let username = options.username;
        let password = options.password;
        let enabled = options.enabled || false;

        if (!name || !url || !username || !password) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'name',
              message: 'Display name:',
              when: !name,
              validate: (input: string) => input.length > 0 || 'Name is required'
            },
            {
              type: 'input',
              name: 'url',
              message: 'vCenter URL:',
              when: !url,
              default: 'https://vcenter.example.com'
            },
            {
              type: 'input',
              name: 'username',
              message: 'vCenter username:',
              when: !username
            },
            {
              type: 'password',
              name: 'password',
              message: 'vCenter password:',
              mask: '*',
              when: !password
            },
            {
              type: 'confirm',
              name: 'enabled',
              message: 'Enable this vCenter?',
              default: true,
              when: !options.enabled
            }
          ]);

          name = name || answers.name;
          url = url || answers.url;
          username = username || answers.username;
          password = password || answers.password;
          enabled = options.enabled || answers.enabled;
        }

        const vcenter = await withSpinner<VCenter>(
          'Creating vCenter...',
          async () => api.post<VCenter>('/api/vcenters', {
            name,
            url,
            username,
            password,
            enabled
          }),
          'vCenter created'
        );

        output({
          id: vcenter.id,
          name: vcenter.name,
          url: vcenter.url
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Update vCenter
  vcenters
    .command('update <id>')
    .description('Update a vCenter')
    .option('-n, --name <name>', 'Display name')
    .option('-u, --url <url>', 'vCenter URL')
    .option('--username <username>', 'vCenter username')
    .option('--password <password>', 'vCenter password')
    .option('-e, --enabled <bool>', 'Enable/disable')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const updateData: Record<string, unknown> = {};
        if (options.name !== undefined) updateData.name = options.name;
        if (options.url !== undefined) updateData.url = options.url;
        if (options.username !== undefined) updateData.username = options.username;
        if (options.password !== undefined) updateData.password = options.password;
        if (options.enabled !== undefined) updateData.enabled = options.enabled === 'true';

        if (Object.keys(updateData).length === 0) {
          error('No update options provided.');
          process.exit(1);
        }

        await withSpinner(
          'Updating vCenter...',
          async () => api.patch(`/api/vcenters/${id}`, updateData),
          'vCenter updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Delete vCenter
  vcenters
    .command('delete <id>')
    .description('Delete a vCenter')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const vcenter = await api.get<VCenter>(`/api/vcenters/${id}`);

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete vCenter '${vcenter.name}'? This will remove all associated machines.`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting vCenter...',
          async () => api.delete(`/api/vcenters/${id}`),
          `vCenter '${vcenter.name}' deleted`
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Test vCenter connection
  vcenters
    .command('test [id]')
    .description('Test vCenter connection')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const endpoint = id
          ? `/api/vcenters/${id}/test`
          : '/api/vcenters/test';

        const result = await withSpinner<{ success: boolean; message: string }>(
          'Testing connection...',
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

  // Discover VMs from vCenter
  vcenters
    .command('discover <id>')
    .description('Discover VMs from vCenter')
    .option('--folder <folder>', 'Filter by folder path')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = options.folder ? `?folder=${encodeURIComponent(options.folder)}` : '';

        const vms = await withSpinner<DiscoveredVm[]>(
          'Discovering VMs...',
          async () => api.get<DiscoveredVm[]>(`/api/vcenters/${id}/discover${params}`)
        );

        if (vms.length === 0) {
          console.log(chalk.gray('No VMs found.'));
          return;
        }

        console.log();
        console.log(chalk.bold(`Discovered ${vms.length} VM(s)`));
        console.log();

        for (const vm of vms) {
          const power = vm.powerState === 'poweredOn' ? chalk.green('●') : chalk.gray('○');
          console.log(`${power} ${vm.name}`);
          console.log(chalk.gray(`   ${vm.folder} | ${vm.guestOs || 'Unknown OS'}`));
        }

        console.log();
        console.log(chalk.gray('Use `archon vcenters import <id>` to import VMs as machines'));
      } catch (err) {
        handleError(err);
      }
    });

  // Import VMs from vCenter
  vcenters
    .command('import <id>')
    .description('Import VMs from vCenter as machines')
    .option('--folder <folder>', 'Filter by folder path')
    .option('--uuids <uuids>', 'Specific VM UUIDs (comma-separated)')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const payload: Record<string, unknown> = {};
        if (options.folder) payload.folder = options.folder;
        if (options.uuids) payload.uuids = options.uuids.split(',').map((u: string) => u.trim());

        const result = await withSpinner<{ imported: number; skipped: number }>(
          'Importing VMs...',
          async () => api.post<{ imported: number; skipped: number }>(
            `/api/vcenters/${id}/import`,
            payload
          )
        );

        success(`Imported ${result.imported} VM(s), skipped ${result.skipped}`);
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
