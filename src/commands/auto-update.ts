// Path: archon-cli/src/commands/auto-update.ts
// Auto-update policy management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { AutoUpdatePolicy, AutoUpdateSchedule, AutoUpdateRun } from '../api/types.js';
import { output, success, error, statusBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

const scheduleTableConfig: TableConfig<AutoUpdateSchedule[]> = {
  headers: ['Job ID', 'Service', 'Scheduled At', 'Time Until', 'Machines'],
  transform: (schedules) =>
    schedules.map(s => [
      s.jobId.substring(0, 8),
      s.serviceName,
      s.scheduledAtFormatted,
      s.timeUntil,
      s.machineCount.toString()
    ])
};

export function registerAutoUpdateCommands(program: Command): void {
  const autoUpdate = program
    .command('auto-update')
    .description('Auto-update policy management');

  // Show global policy
  autoUpdate
    .command('policy')
    .description('Show global auto-update policy')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const policy = await withSpinner<AutoUpdatePolicy>(
          'Fetching policy...',
          async () => api.get<AutoUpdatePolicy>('/api/auto-update/policy')
        );

        console.log();
        console.log(chalk.bold('Global Auto-Update Policy'));
        console.log(`  Enabled:              ${policy.enabled ? chalk.green('Yes') : chalk.gray('No')}`);
        console.log(`  Window:               ${formatHour(policy.windowStartHour)} - ${formatHour(policy.windowEndHour)}`);
        console.log(`  Timezone:             ${policy.windowTimezone}`);
        console.log(`  Notify on auto-start: ${policy.notifyOnAutoStart ? 'Yes' : 'No'}`);
        console.log(`  Require pre-check:    ${policy.requirePreCheck ? 'Yes' : 'No'}`);
        console.log(`  Block on warnings:    ${policy.blockOnWarnings ? 'Yes' : 'No'}`);
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Set global policy
  autoUpdate
    .command('policy-set')
    .description('Set global auto-update policy')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing policy for defaults
        const existing = await api.get<AutoUpdatePolicy>('/api/auto-update/policy');

        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'enabled',
            message: 'Enable auto-updates?',
            default: existing.enabled
          },
          {
            type: 'number',
            name: 'windowStartHour',
            message: 'Window start hour (0-23):',
            default: existing.windowStartHour,
            validate: (input: number) => input >= 0 && input <= 23 || 'Must be 0-23'
          },
          {
            type: 'number',
            name: 'windowEndHour',
            message: 'Window end hour (0-23):',
            default: existing.windowEndHour,
            validate: (input: number) => input >= 0 && input <= 23 || 'Must be 0-23'
          },
          {
            type: 'input',
            name: 'windowTimezone',
            message: 'Timezone:',
            default: existing.windowTimezone
          },
          {
            type: 'confirm',
            name: 'notifyOnAutoStart',
            message: 'Notify when auto-update starts?',
            default: existing.notifyOnAutoStart
          },
          {
            type: 'confirm',
            name: 'requirePreCheck',
            message: 'Require pre-check before auto-update?',
            default: existing.requirePreCheck
          },
          {
            type: 'confirm',
            name: 'blockOnWarnings',
            message: 'Block auto-update if warnings present?',
            default: existing.blockOnWarnings
          }
        ]);

        await withSpinner(
          'Saving policy...',
          async () => api.put('/api/auto-update/policy', answers),
          'Policy saved'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // List all policies (global + service-specific)
  autoUpdate
    .command('policies')
    .description('List all auto-update policies')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const policies = await withSpinner<AutoUpdatePolicy[]>(
          'Fetching policies...',
          async () => api.get<AutoUpdatePolicy[]>('/api/auto-update/policies')
        );

        for (const policy of policies) {
          const scope = policy.serviceId ? `Service ${policy.serviceId}` : 'Global';
          const status = policy.enabled ? chalk.green('Enabled') : chalk.gray('Disabled');
          console.log(`${scope}: ${status} (${formatHour(policy.windowStartHour)}-${formatHour(policy.windowEndHour)} ${policy.windowTimezone})`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // List scheduled updates
  autoUpdate
    .command('schedules')
    .description('List scheduled auto-updates')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const schedules = await withSpinner<AutoUpdateSchedule[]>(
          'Fetching schedules...',
          async () => api.get<AutoUpdateSchedule[]>('/api/auto-update/schedules')
        );

        if (schedules.length === 0) {
          console.log(chalk.gray('No scheduled auto-updates.'));
          return;
        }

        output(schedules, scheduleTableConfig);
      } catch (err) {
        handleError(err);
      }
    });

  // List recent runs
  autoUpdate
    .command('runs')
    .description('List recent auto-update runs')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const runs = await withSpinner<AutoUpdateRun[]>(
          'Fetching runs...',
          async () => api.get<AutoUpdateRun[]>('/api/auto-update/runs')
        );

        const limited = runs.slice(0, parseInt(options.limit));

        for (const run of limited) {
          const statusIcon = run.status === 'COMPLETED' ? chalk.green('✓') :
                            run.status === 'FAILED' ? chalk.red('✗') :
                            run.status === 'BLOCKED' ? chalk.yellow('○') :
                            chalk.gray('●');
          const time = run.startedAt
            ? format(new Date(run.startedAt), 'yyyy-MM-dd HH:mm')
            : format(new Date(run.windowStart), 'yyyy-MM-dd HH:mm');
          console.log(`${statusIcon} ${run.serviceName} - ${time} - ${run.status}`);
          if (run.blockedReason) {
            console.log(chalk.gray(`   ${run.blockedReason}`));
          }
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Service-specific policy
  const service = autoUpdate
    .command('service <serviceId>')
    .description('Service-specific auto-update management');

  service
    .command('policy')
    .description('Show service auto-update policy')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();
        const serviceId = service.parent?.args[0];

        const policy = await withSpinner<AutoUpdatePolicy>(
          'Fetching policy...',
          async () => api.get<AutoUpdatePolicy>(`/api/services/${serviceId}/auto-update/policy`)
        );

        console.log();
        console.log(chalk.bold(`Auto-Update Policy for Service ${serviceId}`));
        console.log(`  Enabled:              ${policy.enabled ? chalk.green('Yes') : chalk.gray('No')}`);
        console.log(`  Window:               ${formatHour(policy.windowStartHour)} - ${formatHour(policy.windowEndHour)}`);
        console.log(`  Timezone:             ${policy.windowTimezone}`);
        console.log(`  Notify on auto-start: ${policy.notifyOnAutoStart ? 'Yes' : 'No'}`);
        console.log(`  Require pre-check:    ${policy.requirePreCheck ? 'Yes' : 'No'}`);
        console.log(`  Block on warnings:    ${policy.blockOnWarnings ? 'Yes' : 'No'}`);
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  service
    .command('policy-set')
    .description('Set service auto-update policy')
    .option('--enabled <bool>', 'Enable auto-updates')
    .option('--start <hour>', 'Window start hour')
    .option('--end <hour>', 'Window end hour')
    .option('--timezone <tz>', 'Timezone')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();
        const serviceId = service.parent?.args[0];

        const updateData: Record<string, unknown> = {};
        if (options.enabled !== undefined) updateData.enabled = options.enabled === 'true';
        if (options.start !== undefined) updateData.windowStartHour = parseInt(options.start);
        if (options.end !== undefined) updateData.windowEndHour = parseInt(options.end);
        if (options.timezone !== undefined) updateData.windowTimezone = options.timezone;

        await withSpinner(
          'Saving policy...',
          async () => api.put(`/api/services/${serviceId}/auto-update/policy`, updateData),
          'Policy saved'
        );
      } catch (err) {
        handleError(err);
      }
    });

  service
    .command('schedule')
    .description('Show service auto-update schedule')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();
        const serviceId = service.parent?.args[0];

        const schedule = await withSpinner<AutoUpdateSchedule | null>(
          'Fetching schedule...',
          async () => {
            try {
              return await api.get<AutoUpdateSchedule>(`/api/services/${serviceId}/auto-update/schedule`);
            } catch {
              return null;
            }
          }
        );

        if (!schedule) {
          console.log(chalk.gray('No scheduled auto-update for this service.'));
          return;
        }

        console.log();
        console.log(chalk.bold('Scheduled Auto-Update'));
        console.log(`  Job ID:       ${schedule.jobId}`);
        console.log(`  Scheduled:    ${schedule.scheduledAtFormatted}`);
        console.log(`  Time until:   ${schedule.timeUntil}`);
        console.log(`  Machines:     ${schedule.machineCount}`);
        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}

function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
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
