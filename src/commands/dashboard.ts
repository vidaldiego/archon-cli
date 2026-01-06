// Path: archon-cli/src/commands/dashboard.ts
// Dashboard and health commands

import { Command } from 'commander';
import chalk from 'chalk';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { DashboardStats, HealthStatus } from '../api/types.js';
import { output, error, statusBadge } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

export function registerDashboardCommands(program: Command): void {
  // Dashboard command
  program
    .command('dashboard')
    .description('Show dashboard statistics')
    .action(async () => {
      try {
        const profileName = getActiveProfileName();
        const profile = getActiveProfile();

        const token = await getValidToken(profileName, profile.url);
        if (!token) {
          error('Not authenticated. Run: archon auth login');
          process.exit(1);
        }

        const api = createApiClient(profile.url, token);

        const stats = await withSpinner<DashboardStats>(
          'Fetching dashboard...',
          async () => api.get<DashboardStats>('/api/dashboard')
        );

        // Custom display for dashboard
        console.log();
        console.log(chalk.bold('Machines'));
        console.log(`  Total:       ${stats.totalMachines}`);
        console.log(`  ${chalk.green('OK')}:          ${stats.byStatus['OK'] || 0}`);
        console.log(`  ${chalk.yellow('WARN')}:        ${stats.byStatus['WARN'] || 0}`);
        console.log(`  ${chalk.red('CRIT')}:        ${stats.byStatus['CRIT'] || 0}`);
        console.log(`  ${chalk.gray('UNKNOWN')}:     ${stats.byStatus['UNKNOWN'] || 0}`);

        if (stats.byEnv && Object.keys(stats.byEnv).length > 0) {
          console.log();
          console.log(chalk.bold('By Environment'));
          for (const [env, count] of Object.entries(stats.byEnv)) {
            console.log(`  ${env}: ${count}`);
          }
        }

        if (stats.byProvider && Object.keys(stats.byProvider).length > 0) {
          console.log();
          console.log(chalk.bold('By Provider'));
          for (const [provider, count] of Object.entries(stats.byProvider)) {
            console.log(`  ${provider}: ${count}`);
          }
        }

        if (stats.topIssues && stats.topIssues.length > 0) {
          console.log();
          console.log(chalk.bold('Top Issues'));
          for (const issue of stats.topIssues.slice(0, 5)) {
            const reason = issue.primaryReason || (issue.reasons ? issue.reasons.join(', ') : 'Unknown');
            const statusIcon = issue.status === 'OK' ? chalk.green('●') :
                              issue.status === 'WARN' ? chalk.yellow('●') :
                              issue.status === 'CRIT' ? chalk.red('●') :
                              chalk.gray('●');
            console.log(`  ${statusIcon} ${issue.machineName}: ${reason}`);
          }
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Health command
  program
    .command('health')
    .description('Show backend health status')
    .action(async () => {
      try {
        const profile = getActiveProfile();

        // Health endpoint doesn't require authentication
        const response = await fetch(`${profile.url}/api/health`);
        const health = await response.json() as HealthStatus;

        console.log();
        console.log(chalk.bold('Backend Health'));
        console.log(`  Status:   ${statusBadge(health.status)}`);
        console.log(`  Version:  ${health.version}`);
        console.log(`  Uptime:   ${formatUptime(health.uptime)}`);
        console.log();
        console.log(chalk.bold('Components'));
        console.log(`  Database:     ${health.database ? chalk.green('✓') : chalk.red('✗')}`);
        console.log(`  vCenter:      ${health.vcenter ? chalk.green('✓') : chalk.red('✗')}`);
        console.log(`  SMTP:         ${health.smtp ? chalk.green('✓') : chalk.red('✗')}`);
        console.log(`  SSH Key:      ${health.sshKeyLoaded ? chalk.green('✓') : chalk.red('✗')}`);
        console.log();

        // Also output as JSON for --json flag
        output(health);
      } catch (err) {
        handleError(err);
      }
    });
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}
