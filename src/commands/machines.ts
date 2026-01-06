// Path: archon-cli/src/commands/machines.ts
// Machine management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { Machine, MachineDetail, Identity } from '../api/types.js';
import { output, success, error, statusBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';
import { getAuthenticatedClient } from '../utils/auth.js';

interface MachineListItem {
  machineId: string;
  name: string;
  primaryIp: string;
  provider: string;
  environment: string;
  health: string;
  service: string;
  pendingUpdates: number;
}

const machineTableConfig: TableConfig<MachineListItem[]> = {
  headers: ['Name', 'IP', 'Provider', 'Env', 'Health', 'Service', 'Updates'],
  transform: (machines) =>
    machines.map(m => [
      m.name,
      m.primaryIp || '-',
      m.provider,
      m.environment || '-',
      statusBadge(m.health),
      m.service || '-',
      m.pendingUpdates > 0 ? chalk.yellow(m.pendingUpdates.toString()) : '0'
    ])
};

export function registerMachineCommands(program: Command): void {
  const machines = program
    .command('machines')
    .description('Machine management');

  // List machines
  machines
    .command('list')
    .description('List all machines')
    .option('-e, --environment <env>', 'Filter by environment')
    .option('-s, --service <service>', 'Filter by service')
    .option('--status <status>', 'Filter by health status (OK, WARN, CRIT, UNKNOWN)')
    .option('-p, --provider <provider>', 'Filter by provider')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const machines = await withSpinner<Machine[]>(
          'Fetching machines...',
          async () => api.get<Machine[]>('/api/machines')
        );

        let filtered = machines;

        if (options.environment) {
          filtered = filtered.filter(m =>
            m.environment?.toLowerCase() === options.environment.toLowerCase()
          );
        }
        if (options.service) {
          filtered = filtered.filter(m =>
            m.service?.toLowerCase().includes(options.service.toLowerCase()) ||
            m.serviceDisplayName?.toLowerCase().includes(options.service.toLowerCase())
          );
        }
        if (options.status) {
          filtered = filtered.filter(m =>
            m.healthStatus === options.status.toUpperCase()
          );
        }
        if (options.provider) {
          filtered = filtered.filter(m =>
            m.provider.toLowerCase() === options.provider.toLowerCase()
          );
        }

        const items: MachineListItem[] = filtered.map(m => ({
          machineId: m.machineId,
          name: m.name,
          primaryIp: m.primaryIp || '-',
          provider: m.provider,
          environment: m.env || m.environment || '-',
          health: m.healthStatus,
          service: m.serviceDisplayName || m.service || '-',
          pendingUpdates: m.pendingUpdates || 0
        }));

        output(items, machineTableConfig);
        console.log(chalk.gray(`\n${items.length} machine(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get machine details
  machines
    .command('get <id>')
    .description('Get machine details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const machine = await withSpinner<MachineDetail>(
          'Fetching machine...',
          async () => api.get<MachineDetail>(`/api/machines/${id}`)
        );

        output({
          machineId: machine.machineId,
          name: machine.name,
          primaryIp: machine.primaryIp,
          managementIp: machine.managementIp,
          provider: machine.provider,
          environment: machine.env || machine.environment,
          powerState: machine.powerState,
          health: machine.healthStatus,
          service: machine.serviceDisplayName || machine.service,
          identity: machine.identityName,
          pendingUpdates: machine.pendingUpdates,
          vmUuid: machine.vmUuid,
          folder: machine.folder,
          cluster: machine.cluster,
          datacenter: machine.datacenter,
          guestOs: machine.guestOs,
          cpu: machine.cpuCount,
          memoryMb: machine.memoryMb,
          diskGb: machine.diskGb,
          tags: machine.tags
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Create baremetal machine
  machines
    .command('create')
    .description('Create a baremetal machine')
    .option('-n, --name <name>', 'Machine name')
    .option('-i, --ip <ip>', 'Primary IP address')
    .option('-e, --environment <env>', 'Environment')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        let name = options.name;
        let ip = options.ip;
        let environment = options.environment;

        if (!name || !ip) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'name',
              message: 'Machine name:',
              when: !name,
              validate: (input: string) => input.length > 0 || 'Name is required'
            },
            {
              type: 'input',
              name: 'ip',
              message: 'Primary IP address:',
              when: !ip,
              validate: (input: string) => {
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                return ipRegex.test(input) || 'Invalid IP address';
              }
            },
            {
              type: 'input',
              name: 'environment',
              message: 'Environment (optional):',
              when: !environment
            }
          ]);

          name = name || answers.name;
          ip = ip || answers.ip;
          environment = environment || answers.environment;
        }

        const machine = await withSpinner<Machine>(
          'Creating machine...',
          async () => api.post<Machine>('/api/machines/baremetal', {
            name,
            primaryIp: ip,
            environment: environment || null
          }),
          'Machine created'
        );

        output({
          machineId: machine.machineId,
          name: machine.name,
          primaryIp: machine.primaryIp
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Delete machine
  machines
    .command('delete <id>')
    .description('Delete a machine')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get machine details first
        const machine = await api.get<Machine>(`/api/machines/${id}`);

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete machine '${machine.name}'?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting machine...',
          async () => api.delete(`/api/machines/${id}`),
          `Machine '${machine.name}' deleted`
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Refresh machines from vCenter
  machines
    .command('refresh')
    .description('Refresh all machines from vCenter')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Refreshing machines from vCenter...',
          async () => api.post('/api/machines/refresh'),
          'Machines refreshed'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Health check
  machines
    .command('health-check [id]')
    .description('Run SSH health check')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const endpoint = id
          ? `/api/machines/${id}/health-check`
          : '/api/machines/health-check';

        await withSpinner(
          id ? 'Running health check...' : 'Running health checks on all machines...',
          async () => api.post(endpoint),
          'Health check complete'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // BMC health check
  machines
    .command('bmc-health-check [id]')
    .description('Run BMC/IPMI health check')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const endpoint = id
          ? `/api/machines/${id}/bmc-health-check`
          : '/api/machines/bmc-health-check';

        await withSpinner(
          'Running BMC health check...',
          async () => api.post(endpoint),
          'BMC health check complete'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Identity subcommands
  const identity = machines
    .command('identity')
    .description('Machine identity management');

  identity
    .command('get <machineId>')
    .description('Get identity assignment')
    .action(async (machineId) => {
      try {
        const api = await getAuthenticatedClient();

        const machine = await api.get<MachineDetail>(`/api/machines/${machineId}`);

        if (!machine.identityId) {
          console.log(chalk.gray('No identity assigned.'));
          return;
        }

        output({
          machineId: machine.machineId,
          machineName: machine.name,
          identityId: machine.identityId,
          identityName: machine.identityName
        });
      } catch (err) {
        handleError(err);
      }
    });

  identity
    .command('assign <machineId> <identityId>')
    .description('Assign identity to machine')
    .action(async (machineId, identityId) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Assigning identity...',
          async () => api.put(`/api/machines/${machineId}/identity`, {
            identityId: parseInt(identityId)
          }),
          'Identity assigned'
        );
      } catch (err) {
        handleError(err);
      }
    });

  identity
    .command('remove <machineId>')
    .description('Remove identity assignment')
    .action(async (machineId) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Removing identity...',
          async () => api.delete(`/api/machines/${machineId}/identity`),
          'Identity removed'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Tags subcommands
  const tags = machines
    .command('tags')
    .description('Machine tag management');

  tags
    .command('get <machineId>')
    .description('Get machine tags')
    .action(async (machineId) => {
      try {
        const api = await getAuthenticatedClient();

        const machine = await api.get<MachineDetail>(`/api/machines/${machineId}`);
        output(machine.tags || {});
      } catch (err) {
        handleError(err);
      }
    });

  tags
    .command('set <machineId> <json>')
    .description('Set all machine tags')
    .action(async (machineId, json) => {
      try {
        const api = await getAuthenticatedClient();
        const tagsObj = JSON.parse(json);

        await withSpinner(
          'Setting tags...',
          async () => api.put(`/api/machines/${machineId}/tags`, tagsObj),
          'Tags updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  tags
    .command('add <machineId> <key> <value>')
    .description('Add a tag')
    .action(async (machineId, key, value) => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing tags
        const machine = await api.get<MachineDetail>(`/api/machines/${machineId}`);
        const updatedTags = { ...(machine.tags || {}), [key]: value };

        await withSpinner(
          'Adding tag...',
          async () => api.put(`/api/machines/${machineId}/tags`, updatedTags),
          'Tag added'
        );
      } catch (err) {
        handleError(err);
      }
    });

  tags
    .command('remove <machineId> <key>')
    .description('Remove a tag')
    .action(async (machineId, key) => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing tags
        const machine = await api.get<MachineDetail>(`/api/machines/${machineId}`);
        const updatedTags = { ...(machine.tags || {}) };
        delete updatedTags[key];

        await withSpinner(
          'Removing tag...',
          async () => api.put(`/api/machines/${machineId}/tags`, updatedTags),
          'Tag removed'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Grouped view
  machines
    .command('grouped')
    .description('Show machines grouped')
    .option('--by <field>', 'Group by field (service, environment, folder)', 'service')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const machines = await withSpinner<Machine[]>(
          'Fetching machines...',
          async () => api.get<Machine[]>('/api/machines')
        );

        const grouped = new Map<string, Machine[]>();

        for (const machine of machines) {
          let key: string;
          switch (options.by) {
            case 'service':
              key = machine.serviceDisplayName || machine.service || 'Unassigned';
              break;
            case 'environment':
              key = machine.environment || 'Unknown';
              break;
            case 'folder':
              key = (machine as MachineDetail).folder || 'Unknown';
              break;
            default:
              key = 'Unknown';
          }

          if (!grouped.has(key)) {
            grouped.set(key, []);
          }
          grouped.get(key)!.push(machine);
        }

        for (const [group, machines] of grouped.entries()) {
          console.log();
          console.log(chalk.bold(group) + chalk.gray(` (${machines.length})`));
          for (const m of machines) {
            const healthIcon = m.healthStatus === 'OK' ? chalk.green('●') :
                              m.healthStatus === 'WARN' ? chalk.yellow('●') :
                              m.healthStatus === 'CRIT' ? chalk.red('●') :
                              chalk.gray('●');
            console.log(`  ${healthIcon} ${m.name} ${chalk.gray(m.primaryIp || '')}`);
          }
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}

