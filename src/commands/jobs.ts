// Path: archon-cli/src/commands/jobs.ts
// Jobs dashboard commands

import { Command } from 'commander';
import chalk from 'chalk';
import { format, startOfWeek, addDays } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { JobStatistics, JobSummary, UpdateJob } from '../api/types.js';
import { output, error, statusBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface ScheduledJob {
  id: string;
  service: string;
  serviceName: string;
  scheduledAt: number;
  machineCount: number;
}

const scheduledTableConfig: TableConfig<ScheduledJob[]> = {
  headers: ['ID', 'Service', 'Scheduled For', 'Machines'],
  transform: (jobs) =>
    jobs.map(j => [
      j.id.substring(0, 8),
      j.serviceName,
      format(new Date(j.scheduledAt), 'yyyy-MM-dd HH:mm'),
      j.machineCount.toString()
    ])
};

export function registerJobCommands(program: Command): void {
  const jobs = program
    .command('jobs')
    .description('Jobs dashboard');

  // Job statistics
  jobs
    .command('stats')
    .description('Show job statistics')
    .option('--days <n>', 'Statistics for last N days', '30')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const stats = await withSpinner<JobStatistics>(
          'Fetching statistics...',
          async () => api.get<JobStatistics>(`/api/jobs/stats?days=${options.days}`)
        );

        console.log();
        console.log(chalk.bold('Job Statistics') + chalk.gray(` (last ${options.days} days)`));
        console.log();
        console.log(`  Total:      ${stats.total}`);
        console.log(`  ${chalk.green('Completed')}: ${stats.completed}`);
        console.log(`  ${chalk.red('Failed')}:    ${stats.failed}`);
        console.log(`  ${chalk.gray('Cancelled')}: ${stats.cancelled}`);
        console.log(`  Avg time:   ${formatDuration(stats.avgDurationMs)}`);

        if (Object.keys(stats.byService).length > 0) {
          console.log();
          console.log(chalk.bold('By Service'));
          for (const [service, count] of Object.entries(stats.byService)) {
            console.log(`  ${service}: ${count}`);
          }
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Recent jobs timeline
  jobs
    .command('timeline')
    .description('Show recent jobs timeline')
    .option('-l, --limit <n>', 'Number of jobs', '20')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const allJobs = await withSpinner<UpdateJob[]>(
          'Fetching jobs...',
          async () => api.get<UpdateJob[]>('/api/updates')
        );

        const jobs = allJobs.slice(0, parseInt(options.limit));

        console.log();
        console.log(chalk.bold('Recent Jobs'));
        console.log();

        for (const job of jobs) {
          const statusIcon = job.status === 'COMPLETED' ? chalk.green('✓') :
                            job.status === 'FAILED' ? chalk.red('✗') :
                            job.status === 'CANCELLED' ? chalk.gray('○') :
                            job.status === 'RUNNING' ? chalk.blue('●') :
                            chalk.gray('○');

          const time = job.completedAt
            ? format(new Date(job.completedAt), 'MM-dd HH:mm')
            : job.startedAt
              ? format(new Date(job.startedAt), 'MM-dd HH:mm')
              : format(new Date(job.createdAt), 'MM-dd HH:mm');

          const duration = job.completedAt && job.startedAt
            ? chalk.gray(` (${formatDuration(job.completedAt - job.startedAt)})`)
            : '';

          console.log(`${statusIcon} ${time} ${job.serviceDisplayName || job.service} ${statusBadge(job.status)}${duration}`);
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Calendar view
  jobs
    .command('calendar')
    .description('Show jobs calendar for current week')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const jobs = await withSpinner<UpdateJob[]>(
          'Fetching jobs...',
          async () => api.get<UpdateJob[]>('/api/updates')
        );

        // Group by day
        const byDay = new Map<string, UpdateJob[]>();
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

        for (let i = 0; i < 7; i++) {
          const day = format(addDays(weekStart, i), 'yyyy-MM-dd');
          byDay.set(day, []);
        }

        for (const job of jobs) {
          const day = format(new Date(job.createdAt), 'yyyy-MM-dd');
          if (byDay.has(day)) {
            byDay.get(day)!.push(job);
          }
        }

        console.log();
        console.log(chalk.bold('This Week'));
        console.log();

        for (const [day, dayJobs] of byDay.entries()) {
          const dayName = format(new Date(day), 'EEE MMM d');
          const isToday = day === format(new Date(), 'yyyy-MM-dd');
          const header = isToday ? chalk.cyan.bold(dayName) : chalk.bold(dayName);

          console.log(header);

          if (dayJobs.length === 0) {
            console.log(chalk.gray('  No jobs'));
          } else {
            for (const job of dayJobs) {
              const statusIcon = job.status === 'COMPLETED' ? chalk.green('✓') :
                                job.status === 'FAILED' ? chalk.red('✗') :
                                job.status === 'CANCELLED' ? chalk.gray('○') :
                                job.status === 'RUNNING' ? chalk.blue('●') :
                                chalk.gray('○');
              console.log(`  ${statusIcon} ${job.serviceDisplayName || job.service}`);
            }
          }
          console.log();
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Scheduled jobs
  jobs
    .command('scheduled')
    .description('Show scheduled jobs')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const allJobs = await withSpinner<UpdateJob[]>(
          'Fetching jobs...',
          async () => api.get<UpdateJob[]>('/api/updates')
        );

        const scheduled = allJobs.filter(j =>
          j.status === 'PENDING' && j.scheduledAt && j.scheduledAt > Date.now()
        );

        if (scheduled.length === 0) {
          console.log(chalk.gray('No scheduled jobs.'));
          return;
        }

        const items: ScheduledJob[] = scheduled.map(j => ({
          id: j.id,
          service: j.service,
          serviceName: j.serviceDisplayName || j.service,
          scheduledAt: j.scheduledAt!,
          machineCount: j.totalMachines
        }));

        output(items, scheduledTableConfig);
      } catch (err) {
        handleError(err);
      }
    });

  // Job summary
  jobs
    .command('summary <id>')
    .description('Show detailed job summary')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const summary = await withSpinner<JobSummary>(
          'Fetching summary...',
          async () => api.get<JobSummary>(`/api/jobs/${id}/summary`)
        );

        console.log();
        console.log(chalk.bold('Job Summary'));
        console.log(`  ID:       ${summary.job.id}`);
        console.log(`  Service:  ${summary.service.displayName}`);
        console.log(`  Status:   ${statusBadge(summary.job.status)}`);
        console.log(`  Progress: ${summary.job.progress}%`);

        if (summary.job.startedAt && summary.job.completedAt) {
          const duration = summary.job.completedAt - summary.job.startedAt;
          console.log(`  Duration: ${formatDuration(duration)}`);
        }

        console.log();
        console.log(chalk.bold('Machines'));

        for (const machine of summary.machines) {
          const statusIcon = machine.status === 'COMPLETED' ? chalk.green('✓') :
                            machine.status === 'FAILED' ? chalk.red('✗') :
                            machine.status === 'RUNNING' ? chalk.blue('●') :
                            machine.status === 'SKIPPED' ? chalk.gray('○') :
                            chalk.gray('○');
          const duration = machine.durationMs
            ? chalk.gray(` (${formatDuration(machine.durationMs)})`)
            : '';
          const packages = machine.packagesUpdated !== undefined
            ? chalk.gray(` ${machine.packagesUpdated} packages`)
            : '';
          console.log(`  ${statusIcon} ${machine.name}${duration}${packages}`);
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Retry failed job
  jobs
    .command('retry <id>')
    .description('Retry a failed job')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const newJob = await withSpinner<UpdateJob>(
          'Creating retry job...',
          async () => api.post<UpdateJob>(`/api/jobs/${id}/retry`),
          'Retry job created'
        );

        console.log(`New job ID: ${newJob.id}`);
      } catch (err) {
        handleError(err);
      }
    });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
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
