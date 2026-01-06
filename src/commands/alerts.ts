// Path: archon-cli/src/commands/alerts.ts
// Alert management commands

import { Command } from 'commander';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { Alert } from '../api/types.js';
import { output, success, error, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface AlertListItem {
  id: number;
  severity: string;
  category: string;
  title: string;
  machine: string;
  acknowledged: string;
  createdAt: string;
}

const alertTableConfig: TableConfig<AlertListItem[]> = {
  headers: ['ID', 'Severity', 'Category', 'Title', 'Machine', 'Ack', 'Created'],
  transform: (alerts) =>
    alerts.map(a => [
      a.id.toString(),
      severityBadge(a.severity),
      a.category,
      a.title.substring(0, 30),
      a.machine || '-',
      a.acknowledged,
      a.createdAt
    ])
};

function severityBadge(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return chalk.red.bold(severity);
    case 'WARNING':
      return chalk.yellow(severity);
    case 'INFO':
      return chalk.blue(severity);
    default:
      return severity;
  }
}

export function registerAlertCommands(program: Command): void {
  const alerts = program
    .command('alerts')
    .description('Alert management');

  // List alerts
  alerts
    .command('list')
    .description('List alerts')
    .option('-s, --severity <severity>', 'Filter by severity (CRITICAL, WARNING, INFO)')
    .option('-u, --unread', 'Show only unacknowledged alerts')
    .option('--unresolved', 'Show only unresolved alerts')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const response = await withSpinner<{ alerts: Alert[] } | Alert[]>(
          'Fetching alerts...',
          async () => api.get<{ alerts: Alert[] } | Alert[]>('/api/alerts')
        );

        // Handle both wrapped and unwrapped responses
        const alerts = Array.isArray(response) ? response : response.alerts;

        let filtered = alerts;

        if (options.severity) {
          filtered = filtered.filter(a =>
            a.severity === options.severity.toUpperCase()
          );
        }
        if (options.unread) {
          filtered = filtered.filter(a => !a.acknowledgedAt);
        }
        if (options.unresolved) {
          filtered = filtered.filter(a => !a.resolvedAt);
        }

        filtered = filtered.slice(0, parseInt(options.limit));

        const items: AlertListItem[] = filtered.map(a => {
          const alertId = a.id;
          return {
            id: typeof alertId === 'string' ? parseInt(String(alertId).substring(0, 8), 16) : alertId as number,
            severity: a.severity,
            category: a.category,
            title: a.title,
            machine: a.machineName || '',
            acknowledged: a.acknowledgedAt ? chalk.green('Yes') : chalk.gray('No'),
            createdAt: format(new Date(a.createdAt), 'MM-dd HH:mm')
          };
        });

        output(items, alertTableConfig);
        console.log(chalk.gray(`\n${items.length} alert(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get alert details
  alerts
    .command('get <id>')
    .description('Get alert details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const alert = await withSpinner<Alert>(
          'Fetching alert...',
          async () => api.get<Alert>(`/api/alerts/${id}`)
        );

        output({
          id: alert.id,
          severity: alert.severity,
          category: alert.category,
          title: alert.title,
          message: alert.message,
          machineId: alert.machineId,
          machineName: alert.machineName,
          serviceId: alert.serviceId,
          serviceName: alert.serviceName,
          acknowledged: alert.acknowledged,
          acknowledgedAt: alert.acknowledgedAt
            ? format(new Date(alert.acknowledgedAt), 'yyyy-MM-dd HH:mm:ss')
            : null,
          acknowledgedBy: alert.acknowledgedBy,
          resolved: alert.resolved,
          resolvedAt: alert.resolvedAt
            ? format(new Date(alert.resolvedAt), 'yyyy-MM-dd HH:mm:ss')
            : null,
          createdAt: format(new Date(alert.createdAt), 'yyyy-MM-dd HH:mm:ss')
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Acknowledge alert
  alerts
    .command('ack <id>')
    .description('Acknowledge an alert')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Acknowledging alert...',
          async () => api.post(`/api/alerts/${id}/acknowledge`),
          'Alert acknowledged'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Acknowledge all alerts
  alerts
    .command('ack-all')
    .description('Acknowledge all unacknowledged alerts')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const result = await withSpinner<{ count: number }>(
          'Acknowledging all alerts...',
          async () => api.post<{ count: number }>('/api/alerts/acknowledge-all')
        );

        success(`${result.count} alert(s) acknowledged`);
      } catch (err) {
        handleError(err);
      }
    });

  // Show unread count
  alerts
    .command('unread')
    .description('Show unread alert count')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const alerts = await api.get<Alert[]>('/api/alerts');
        const unread = alerts.filter(a => !a.acknowledged);

        const bySeverity = {
          CRITICAL: unread.filter(a => a.severity === 'CRITICAL').length,
          WARNING: unread.filter(a => a.severity === 'WARNING').length,
          INFO: unread.filter(a => a.severity === 'INFO').length
        };

        console.log();
        console.log(chalk.bold('Unread Alerts'));
        console.log(`  Total:    ${unread.length}`);
        console.log(`  ${chalk.red('Critical')}: ${bySeverity.CRITICAL}`);
        console.log(`  ${chalk.yellow('Warning')}:  ${bySeverity.WARNING}`);
        console.log(`  ${chalk.blue('Info')}:     ${bySeverity.INFO}`);
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Clear resolved alerts
  alerts
    .command('clear')
    .description('Clear resolved alerts')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const result = await withSpinner<{ count: number }>(
          'Clearing resolved alerts...',
          async () => api.delete<{ count: number }>('/api/alerts/resolved')
        );

        success(`${result.count} resolved alert(s) cleared`);
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
