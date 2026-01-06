// Path: archon-cli/src/commands/updates.ts
// Update job management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import {
  UpdateJob,
  UpdateStep,
  UpdatePreview,
  Service
} from '../api/types.js';
import { output, success, error, statusBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface UpdateJobListItem {
  id: string;
  service: string;
  status: string;
  progress: string;
  createdBy: string;
  createdAt: string;
}

const updateTableConfig: TableConfig<UpdateJobListItem[]> = {
  headers: ['ID', 'Service', 'Status', 'Progress', 'Created By', 'Created At'],
  transform: (jobs) =>
    jobs.map(j => [
      j.id.substring(0, 8),
      j.service,
      statusBadge(j.status),
      j.progress,
      j.createdBy,
      j.createdAt
    ])
};

export function registerUpdateCommands(program: Command): void {
  const updates = program
    .command('updates')
    .description('Update job management');

  // List update jobs
  updates
    .command('list')
    .description('List update jobs')
    .option('-s, --status <status>', 'Filter by status (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const jobs = await withSpinner<UpdateJob[]>(
          'Fetching update jobs...',
          async () => api.get<UpdateJob[]>('/api/updates')
        );

        let filtered = jobs;
        if (options.status) {
          filtered = filtered.filter(j =>
            j.status === options.status.toUpperCase()
          );
        }

        filtered = filtered.slice(0, parseInt(options.limit));

        const items: UpdateJobListItem[] = filtered.map(j => ({
          id: j.id,
          service: j.serviceDisplayName || j.service,
          status: j.status,
          progress: `${j.currentMachineIndex}/${j.totalMachines}`,
          createdBy: j.createdByUsername || `User ${j.createdBy}`,
          createdAt: format(new Date(j.createdAt), 'yyyy-MM-dd HH:mm')
        }));

        output(items, updateTableConfig);
        console.log(chalk.gray(`\n${items.length} job(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get update job details
  updates
    .command('get <id>')
    .description('Get update job details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const job = await withSpinner<UpdateJob>(
          'Fetching job...',
          async () => api.get<UpdateJob>(`/api/updates/${id}`)
        );

        console.log();
        console.log(chalk.bold(`Update Job: ${job.id}`));
        console.log();
        console.log(`Service:    ${job.serviceDisplayName || job.service}`);
        console.log(`Status:     ${statusBadge(job.status)}`);
        console.log(`Progress:   ${job.currentMachineIndex}/${job.totalMachines} (${job.progress}%)`);
        console.log(`Created:    ${format(new Date(job.createdAt), 'yyyy-MM-dd HH:mm:ss')}`);
        console.log(`Created By: ${job.createdByUsername || `User ${job.createdBy}`}`);

        if (job.startedAt) {
          console.log(`Started:    ${format(new Date(job.startedAt), 'yyyy-MM-dd HH:mm:ss')}`);
        }
        if (job.completedAt) {
          console.log(`Completed:  ${format(new Date(job.completedAt), 'yyyy-MM-dd HH:mm:ss')}`);
        }
        if (job.scheduledAt) {
          console.log(`Scheduled:  ${format(new Date(job.scheduledAt), 'yyyy-MM-dd HH:mm:ss')}`);
        }

        if (job.results.length > 0) {
          console.log();
          console.log(chalk.bold('Results'));
          for (const result of job.results) {
            const statusIcon = result.status === 'COMPLETED' ? chalk.green('✓') :
                              result.status === 'FAILED' ? chalk.red('✗') :
                              result.status === 'RUNNING' ? chalk.blue('●') :
                              result.status === 'SKIPPED' ? chalk.gray('○') :
                              chalk.gray('○');
            const packages = result.packagesUpdated !== undefined
              ? chalk.gray(` (${result.packagesUpdated} packages)`)
              : '';
            const errorMsg = result.error ? chalk.red(` - ${result.error}`) : '';
            console.log(`  ${statusIcon} ${result.machineName}${packages}${errorMsg}`);
          }
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Get active update job
  updates
    .command('active')
    .description('Show active update job')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const jobs = await api.get<UpdateJob[]>('/api/updates');
        const active = jobs.find(j => j.status === 'RUNNING');

        if (!active) {
          console.log(chalk.gray('No active update job.'));
          return;
        }

        console.log();
        console.log(chalk.bold(`Active Update: ${active.serviceDisplayName || active.service}`));
        console.log(`Job ID:   ${active.id}`);
        console.log(`Progress: ${active.currentMachineIndex}/${active.totalMachines} (${active.progress}%)`);
        console.log(`Started:  ${format(new Date(active.startedAt!), 'yyyy-MM-dd HH:mm:ss')}`);

        const currentResult = active.results.find(r => r.status === 'RUNNING');
        if (currentResult) {
          console.log(`Current:  ${currentResult.machineName}`);
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Start rolling update
  updates
    .command('start <serviceId>')
    .description('Start a rolling update')
    .option('--machines <ids>', 'Specific machine IDs (comma-separated)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (serviceId, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get service details first
        const service = await api.get<Service>(`/api/services/${serviceId}`);

        if (service.pendingUpdates === 0) {
          console.log(chalk.gray('No pending updates for this service.'));
          return;
        }

        // Run pre-check
        console.log(chalk.gray('Running pre-update check...'));
        const check = await api.post<{ safe: boolean; blockers: { message: string }[] }>(
          `/api/services/${serviceId}/pre-update-check`
        );

        if (!check.safe) {
          error('Pre-update check failed:');
          for (const b of check.blockers) {
            console.log(`  ${chalk.red('✗')} ${b.message}`);
          }
          process.exit(1);
        }

        if (!options.yes) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Start rolling update for '${service.displayName}'?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        const machineIds = options.machines
          ? options.machines.split(',').map((id: string) => id.trim())
          : undefined;

        const job = await withSpinner<UpdateJob>(
          'Starting update...',
          async () => api.post<UpdateJob>(`/api/services/${serviceId}/updates/start`, {
            machineIds
          }),
          'Update started'
        );

        console.log(`Job ID: ${job.id}`);
        console.log(chalk.gray('Run `archon updates logs <id>` to follow progress'));
      } catch (err) {
        handleError(err);
      }
    });

  // Schedule update
  updates
    .command('schedule <serviceId>')
    .description('Schedule an update')
    .option('-t, --time <datetime>', 'Schedule time (ISO format)')
    .action(async (serviceId, options) => {
      try {
        const api = await getAuthenticatedClient();

        let scheduledAt = options.time;

        if (!scheduledAt) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'scheduledAt',
              message: 'Schedule time (YYYY-MM-DD HH:mm):',
              validate: (input: string) => {
                const date = new Date(input);
                if (isNaN(date.getTime())) {
                  return 'Invalid date format';
                }
                if (date <= new Date()) {
                  return 'Schedule time must be in the future';
                }
                return true;
              }
            }
          ]);
          scheduledAt = answers.scheduledAt;
        }

        const job = await withSpinner<UpdateJob>(
          'Scheduling update...',
          async () => api.post<UpdateJob>(`/api/services/${serviceId}/updates/schedule`, {
            scheduledAt: new Date(scheduledAt).toISOString()
          }),
          'Update scheduled'
        );

        console.log(`Job ID: ${job.id}`);
        console.log(`Scheduled for: ${format(new Date(job.scheduledAt!), 'yyyy-MM-dd HH:mm:ss')}`);
      } catch (err) {
        handleError(err);
      }
    });

  // Cancel update
  updates
    .command('cancel <id>')
    .description('Cancel an update job')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: 'Cancel this update job?',
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Cancelling update...',
          async () => api.post(`/api/updates/${id}/cancel`),
          'Update cancelled'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Reschedule update
  updates
    .command('reschedule <id>')
    .description('Reschedule an update job')
    .option('-t, --time <datetime>', 'New schedule time (ISO format)')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        let scheduledAt = options.time;

        if (!scheduledAt) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'scheduledAt',
              message: 'New schedule time (YYYY-MM-DD HH:mm):',
              validate: (input: string) => {
                const date = new Date(input);
                if (isNaN(date.getTime())) {
                  return 'Invalid date format';
                }
                if (date <= new Date()) {
                  return 'Schedule time must be in the future';
                }
                return true;
              }
            }
          ]);
          scheduledAt = answers.scheduledAt;
        }

        await withSpinner(
          'Rescheduling update...',
          async () => api.patch(`/api/updates/${id}`, {
            scheduledAt: new Date(scheduledAt).toISOString()
          }),
          'Update rescheduled'
        );

        console.log(`New schedule: ${format(new Date(scheduledAt), 'yyyy-MM-dd HH:mm:ss')}`);
      } catch (err) {
        handleError(err);
      }
    });

  // Get update logs
  updates
    .command('logs <id>')
    .description('Get update job logs')
    .option('-f, --follow', 'Follow log output')
    .action(async (id, options) => {
      try {
        const api = await getAuthenticatedClient();

        if (options.follow) {
          // WebSocket streaming - simplified for CLI
          console.log(chalk.gray('Streaming logs... (Press Ctrl+C to stop)'));

          const poll = async () => {
            const steps = await api.get<UpdateStep[]>(`/api/updates/${id}/steps`);
            console.clear();
            console.log(chalk.bold(`Update Job: ${id}\n`));

            for (const step of steps) {
              const statusIcon = step.status === 'SUCCEEDED' ? chalk.green('✓') :
                                step.status === 'FAILED' ? chalk.red('✗') :
                                step.status === 'RUNNING' ? chalk.blue('●') :
                                step.status === 'SKIPPED' ? chalk.gray('○') :
                                chalk.gray('○');
              console.log(`${statusIcon} ${step.stepName}`);
              if (step.output) {
                console.log(chalk.gray(`   ${step.output.split('\n').slice(0, 3).join('\n   ')}`));
              }
            }

            // Check if job is still running
            const job = await api.get<UpdateJob>(`/api/updates/${id}`);
            if (job.status === 'RUNNING' || job.status === 'PENDING') {
              setTimeout(poll, 2000);
            } else {
              console.log(chalk.bold(`\nJob ${statusBadge(job.status)}`));
            }
          };

          poll();
        } else {
          const steps = await withSpinner<UpdateStep[]>(
            'Fetching logs...',
            async () => api.get<UpdateStep[]>(`/api/updates/${id}/steps`)
          );

          console.log();
          for (const step of steps) {
            const statusIcon = step.status === 'SUCCEEDED' ? chalk.green('✓') :
                              step.status === 'FAILED' ? chalk.red('✗') :
                              step.status === 'RUNNING' ? chalk.blue('●') :
                              step.status === 'SKIPPED' ? chalk.gray('○') :
                              chalk.gray('○');
            const duration = step.durationMs ? chalk.gray(` (${step.durationMs}ms)`) : '';
            console.log(`${statusIcon} ${step.stepName}${duration}`);
            if (step.output) {
              console.log(chalk.gray(`   ${step.output}`));
            }
          }
          console.log();
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Get update steps
  updates
    .command('steps <id>')
    .description('Get update job steps')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const steps = await withSpinner<UpdateStep[]>(
          'Fetching steps...',
          async () => api.get<UpdateStep[]>(`/api/updates/${id}/steps`)
        );

        output(steps);
      } catch (err) {
        handleError(err);
      }
    });

  // Preview pending updates
  updates
    .command('preview <serviceId>')
    .description('Preview pending updates for service')
    .action(async (serviceId) => {
      try {
        const api = await getAuthenticatedClient();

        const previews = await withSpinner<UpdatePreview[]>(
          'Fetching update preview...',
          async () => api.get<UpdatePreview[]>(`/api/services/${serviceId}/updates/preview`)
        );

        if (previews.length === 0) {
          console.log(chalk.gray('No pending updates.'));
          return;
        }

        for (const preview of previews) {
          console.log();
          console.log(chalk.bold(preview.machineName));
          console.log(chalk.gray(`${preview.totalCount} package(s)`));

          for (const pkg of preview.packages.slice(0, 10)) {
            console.log(`  ${pkg.name}: ${chalk.red(pkg.currentVersion)} → ${chalk.green(pkg.newVersion)}`);
          }

          if (preview.packages.length > 10) {
            console.log(chalk.gray(`  ... and ${preview.packages.length - 10} more`));
          }
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Show pending updates count
  updates
    .command('pending <serviceId>')
    .description('Show pending updates for service')
    .action(async (serviceId) => {
      try {
        const api = await getAuthenticatedClient();

        const service = await api.get<Service>(`/api/services/${serviceId}`);

        console.log();
        console.log(chalk.bold(service.displayName));
        console.log(`Total pending: ${service.pendingUpdates}`);
        console.log();

        for (const member of service.members) {
          const updates = member.pendingUpdates || 0;
          const bar = updates > 0
            ? chalk.yellow('█'.repeat(Math.min(updates, 20)))
            : chalk.gray('─');
          console.log(`  ${member.name.padEnd(25)} ${bar} ${updates}`);
        }
        console.log();
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
