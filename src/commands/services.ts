// Path: archon-cli/src/commands/services.ts
// Service management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  Service,
  ServiceType,
  ClusterStatus,
  PreUpdateCheck,
  ServiceMember
} from '../api/types.js';
import { output, success, error, statusBadge, roleBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';
import { getAuthenticatedClient } from '../utils/auth.js';

interface ServiceListItem {
  id: string;
  name: string;
  type: string;
  health: string;
  members: number;
  pendingUpdates: number;
}

const serviceTableConfig: TableConfig<ServiceListItem[]> = {
  headers: ['ID', 'Name', 'Type', 'Health', 'Members', 'Updates'],
  transform: (services) =>
    services.map(s => [
      s.id,
      s.name,
      s.type,
      statusBadge(s.health),
      s.members.toString(),
      s.pendingUpdates > 0 ? chalk.yellow(s.pendingUpdates.toString()) : '0'
    ])
};

interface PluginInfo {
  typeId: string;
  typeName: string;
  supportedRoles: { id: string; name: string; description: string }[];
  supportedActions: { id: string; name: string; description: string }[];
}

interface ActionResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
}

export function registerServiceCommands(program: Command): void {
  const services = program
    .command('services')
    .description('Service management');

  // List services
  services
    .command('list')
    .description('List all services')
    .option('-t, --type <type>', 'Filter by service type')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const response = await withSpinner<{ services: Service[] }>(
          'Fetching services...',
          async () => api.get<{ services: Service[] }>('/api/services')
        );
        const services = response.services;

        let filtered = services;
        if (options.type) {
          filtered = filtered.filter(s => {
            const typeName = s.type.displayName || s.type.name || s.type.id;
            return s.type.id.toLowerCase().includes(options.type.toLowerCase()) ||
              typeName.toLowerCase().includes(options.type.toLowerCase());
          });
        }

        const items: ServiceListItem[] = filtered.map(s => ({
          id: s.id,
          name: s.displayName,
          type: s.type.displayName || s.type.name || s.type.id,
          health: s.healthSummary.overallStatus,
          members: s.members.length,
          pendingUpdates: s.pendingUpdates || 0
        }));

        output(items, serviceTableConfig);
        console.log(chalk.gray(`\n${items.length} service(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get service details
  services
    .command('get <id>')
    .description('Get service details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const service = await withSpinner<Service>(
          'Fetching service...',
          async () => api.get<Service>(`/api/services/${id}`)
        );

        console.log();
        console.log(chalk.bold(service.displayName));
        console.log(chalk.gray(service.description || 'No description'));
        console.log();
        console.log(`Type:             ${service.type.displayName || service.type.name || service.type.id}`);
        console.log(`Health:           ${statusBadge(service.healthSummary.overallStatus)}`);
        console.log(`Pending Updates:  ${service.pendingUpdates}`);
        console.log();
        console.log(chalk.bold('Members'));

        for (const member of service.members) {
          const healthIcon = member.healthStatus === 'OK' ? chalk.green('●') :
                            member.healthStatus === 'WARN' ? chalk.yellow('●') :
                            member.healthStatus === 'CRIT' ? chalk.red('●') :
                            chalk.gray('●');
          const role = member.role ? ` [${roleBadge(member.role)}]` : '';
          const updates = member.pendingUpdates && member.pendingUpdates > 0
            ? chalk.yellow(` (${member.pendingUpdates} updates)`)
            : '';
          console.log(`  ${healthIcon} ${member.name}${role}${updates}`);
          console.log(chalk.gray(`    ${member.primaryIp || 'No IP'}`));
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Create service
  services
    .command('create')
    .description('Create a new service')
    .option('-n, --name <name>', 'Service name')
    .option('-i, --id <id>', 'Service ID (slug)')
    .option('-t, --type <type>', 'Service type ID')
    .option('-d, --description <desc>', 'Description')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get available service types
        const types = await api.get<ServiceType[]>('/api/service-types');

        let name = options.name;
        let id = options.id;
        let typeId = options.type;
        let description = options.description;

        if (!name || !id || !typeId) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'name',
              message: 'Service name:',
              when: !name,
              validate: (input: string) => input.length > 0 || 'Name is required'
            },
            {
              type: 'input',
              name: 'id',
              message: 'Service ID (slug):',
              when: !id,
              default: (answers: { name?: string }) =>
                (answers.name || name || '').toLowerCase().replace(/\s+/g, '-'),
              validate: (input: string) => /^[a-z0-9-]+$/.test(input) || 'ID must be lowercase alphanumeric with dashes'
            },
            {
              type: 'list',
              name: 'typeId',
              message: 'Service type:',
              choices: types.map(t => ({ name: t.name, value: t.id })),
              when: !typeId
            },
            {
              type: 'input',
              name: 'description',
              message: 'Description (optional):',
              when: !description
            }
          ]);

          name = name || answers.name;
          id = id || answers.id;
          typeId = typeId || answers.typeId;
          description = description || answers.description;
        }

        const service = await withSpinner<Service>(
          'Creating service...',
          async () => api.post<Service>('/api/services', {
            id,
            displayName: name,
            typeId,
            description: description || null
          }),
          'Service created'
        );

        output({
          id: service.id,
          name: service.displayName,
          type: service.type.name
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Delete service
  services
    .command('delete <id>')
    .description('Delete a service')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        const service = await api.get<Service>(`/api/services/${id}`);

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete service '${service.displayName}' and unassign all members?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting service...',
          async () => api.delete(`/api/services/${id}`),
          `Service '${service.displayName}' deleted`
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Members subcommands
  const members = services
    .command('members')
    .description('Service member management');

  members
    .command('add <serviceId> <machineId>')
    .description('Add machine to service')
    .option('-r, --role <role>', 'Member role')
    .option('-o, --order <order>', 'Sort order', '0')
    .action(async (serviceId, machineId, options) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Adding member...',
          async () => api.post(`/api/services/${serviceId}/members`, {
            machineId,
            role: options.role || null,
            sortOrder: parseInt(options.order)
          }),
          'Member added'
        );
      } catch (err) {
        handleError(err);
      }
    });

  members
    .command('update <serviceId> <machineId>')
    .description('Update service member')
    .option('-r, --role <role>', 'Member role')
    .option('-o, --order <order>', 'Sort order')
    .action(async (serviceId, machineId, options) => {
      try {
        const api = await getAuthenticatedClient();

        const updateData: Record<string, unknown> = {};
        if (options.role !== undefined) updateData.role = options.role;
        if (options.order !== undefined) updateData.sortOrder = parseInt(options.order);

        await withSpinner(
          'Updating member...',
          async () => api.patch(`/api/services/${serviceId}/members/${machineId}`, updateData),
          'Member updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  members
    .command('remove <serviceId> <machineId>')
    .description('Remove machine from service')
    .action(async (serviceId, machineId) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Removing member...',
          async () => api.delete(`/api/services/${serviceId}/members/${machineId}`),
          'Member removed'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Detect roles
  services
    .command('detect-roles <id>')
    .description('Detect member roles using plugin')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const result = await withSpinner<{ updated: number }>(
          'Detecting roles...',
          async () => api.post<{ updated: number }>(`/api/services/${id}/detect-roles`)
        );

        success(`Detected roles for ${result.updated} member(s)`);
      } catch (err) {
        handleError(err);
      }
    });

  // Cluster status
  services
    .command('cluster-status <id>')
    .description('Get cluster health status')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const status = await withSpinner<ClusterStatus>(
          'Checking cluster status...',
          async () => api.get<ClusterStatus>(`/api/services/${id}/cluster-status`)
        );

        console.log();
        console.log(chalk.bold('Cluster Status'));
        console.log(`  Healthy: ${status.healthy ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`  Summary: ${status.summary}`);

        if (Object.keys(status.details).length > 0) {
          console.log();
          console.log(chalk.bold('Details'));
          console.log(JSON.stringify(status.details, null, 2));
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Pre-update check
  services
    .command('pre-check <id>')
    .description('Run pre-update check')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const check = await withSpinner<PreUpdateCheck>(
          'Running pre-update check...',
          async () => api.post<PreUpdateCheck>(`/api/services/${id}/pre-update-check`)
        );

        console.log();
        console.log(chalk.bold('Pre-Update Check'));
        console.log(`  Safe to update: ${check.safe ? chalk.green('Yes') : chalk.red('No')}`);

        if (check.blockers.length > 0) {
          console.log();
          console.log(chalk.red.bold('Blockers'));
          for (const b of check.blockers) {
            console.log(`  ${chalk.red('✗')} ${b.message}`);
          }
        }

        if (check.warnings.length > 0) {
          console.log();
          console.log(chalk.yellow.bold('Warnings'));
          for (const w of check.warnings) {
            console.log(`  ${chalk.yellow('⚠')} ${w.message}`);
          }
        }

        if (check.info.length > 0) {
          console.log();
          console.log(chalk.blue.bold('Info'));
          for (const i of check.info) {
            console.log(`  ${chalk.blue('ℹ')} ${i.message}`);
          }
        }

        if (check.updatePlan.length > 0) {
          console.log();
          console.log(chalk.bold('Update Plan'));
          for (let i = 0; i < check.updatePlan.length; i++) {
            const m = check.updatePlan[i];
            const role = m.role ? ` [${roleBadge(m.role)}]` : '';
            console.log(`  ${i + 1}. ${m.machineName}${role}`);
          }
        }

        if (check.clusterStatus) {
          console.log();
          console.log(chalk.bold('Cluster Status'));
          console.log(`  ${check.clusterStatus.healthy ? chalk.green('●') : chalk.red('●')} ${check.clusterStatus.summary}`);
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Plugin action
  services
    .command('action <id> <action>')
    .description('Execute plugin action')
    .option('--params <json>', 'Action parameters as JSON')
    .action(async (id, action, options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = options.params ? JSON.parse(options.params) : {};

        const result = await withSpinner<ActionResult>(
          `Executing '${action}'...`,
          async () => api.post<ActionResult>(`/api/services/${id}/actions/${action}`, params)
        );

        if (result.success) {
          success(action);
        } else {
          error(action);
        }

        if (result.output) {
          console.log();
          console.log(result.output);
        }

        if (result.data) {
          console.log();
          output(result.data);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Plugin info
  services
    .command('plugin-info <id>')
    .description('Show plugin information for service')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const info = await withSpinner<PluginInfo>(
          'Fetching plugin info...',
          async () => api.get<PluginInfo>(`/api/services/${id}/plugin-info`)
        );

        console.log();
        console.log(chalk.bold(`Plugin: ${info.typeName}`));
        console.log(`Type ID: ${info.typeId}`);

        if (info.supportedRoles.length > 0) {
          console.log();
          console.log(chalk.bold('Supported Roles'));
          for (const role of info.supportedRoles) {
            console.log(`  ${roleBadge(role.id)} - ${role.description}`);
          }
        }

        if (info.supportedActions.length > 0) {
          console.log();
          console.log(chalk.bold('Available Actions'));
          for (const action of info.supportedActions) {
            console.log(`  ${chalk.cyan(action.id)} - ${action.description}`);
          }
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Service types command
  program
    .command('service-types')
    .description('List available service types')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const types = await withSpinner<ServiceType[]>(
          'Fetching service types...',
          async () => api.get<ServiceType[]>('/api/service-types')
        );

        const items = types.map(t => ({
          id: t.id,
          name: t.displayName || t.name || t.id,
          hasPlugin: t.hasPlugin ? 'Yes' : 'No'
        }));

        output(items, {
          headers: ['ID', 'Name', 'Has Plugin'],
          transform: (items) => items.map(i => [i.id, i.name as string, i.hasPlugin])
        });
      } catch (err) {
        handleError(err);
      }
    });
}

