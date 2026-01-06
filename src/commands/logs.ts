// Path: archon-cli/src/commands/logs.ts
// Log viewing commands

import { Command } from 'commander';
import chalk from 'chalk';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { error } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  exception?: string;
}

interface ServiceLogs {
  machineId: string;
  machineName: string;
  logs: string;
}

export function registerLogCommands(program: Command): void {
  const logs = program
    .command('logs')
    .description('View logs');

  // Archon backend logs
  logs
    .command('archon')
    .description('View ARCHON backend logs')
    .option('-l, --lines <n>', 'Number of lines', '100')
    .option('--level <level>', 'Filter by level (DEBUG, INFO, WARN, ERROR)')
    .option('-f, --follow', 'Follow log output')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = new URLSearchParams();
        params.set('lines', options.lines);
        if (options.level) params.set('level', options.level.toUpperCase());

        if (options.follow) {
          console.log(chalk.gray('Following logs... (Press Ctrl+C to stop)'));

          let lastTimestamp = '';

          const poll = async () => {
            try {
              const entries = await api.get<LogEntry[]>(`/api/logs/archon?${params.toString()}`);

              for (const entry of entries) {
                if (entry.timestamp > lastTimestamp) {
                  printLogEntry(entry);
                  lastTimestamp = entry.timestamp;
                }
              }

              setTimeout(poll, 2000);
            } catch {
              // Ignore errors during polling
              setTimeout(poll, 5000);
            }
          };

          poll();
        } else {
          const entries = await withSpinner<LogEntry[]>(
            'Fetching logs...',
            async () => api.get<LogEntry[]>(`/api/logs/archon?${params.toString()}`)
          );

          for (const entry of entries) {
            printLogEntry(entry);
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Service logs
  logs
    .command('service <serviceId> <machineId>')
    .description('View service logs from a machine')
    .option('-l, --lines <n>', 'Number of lines', '100')
    .option('--since <time>', 'Show logs since time (e.g., "1h", "30m", "2024-01-01")')
    .action(async (serviceId, machineId, options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = new URLSearchParams();
        params.set('lines', options.lines);
        if (options.since) params.set('since', options.since);

        const result = await withSpinner<ServiceLogs>(
          'Fetching logs...',
          async () => api.get<ServiceLogs>(
            `/api/services/${serviceId}/logs/${machineId}?${params.toString()}`
          )
        );

        console.log(chalk.bold(`Logs from ${result.machineName}`));
        console.log();
        console.log(result.logs);
      } catch (err) {
        handleError(err);
      }
    });

  // Machine system logs
  logs
    .command('machine <machineId>')
    .description('View system logs from a machine')
    .option('-l, --lines <n>', 'Number of lines', '100')
    .option('--unit <unit>', 'Systemd unit name')
    .option('--since <time>', 'Show logs since time')
    .action(async (machineId, options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = new URLSearchParams();
        params.set('lines', options.lines);
        if (options.unit) params.set('unit', options.unit);
        if (options.since) params.set('since', options.since);

        const result = await withSpinner<{ logs: string }>(
          'Fetching logs...',
          async () => api.get<{ logs: string }>(
            `/api/machines/${machineId}/logs?${params.toString()}`
          )
        );

        console.log(result.logs);
      } catch (err) {
        handleError(err);
      }
    });
}

function printLogEntry(entry: LogEntry): void {
  const level = formatLevel(entry.level);
  const time = entry.timestamp.substring(11, 19); // HH:mm:ss
  const logger = chalk.gray(entry.logger.split('.').pop() || entry.logger);

  console.log(`${chalk.gray(time)} ${level} ${logger} ${entry.message}`);

  if (entry.exception) {
    console.log(chalk.red(entry.exception));
  }
}

function formatLevel(level: string): string {
  switch (level.toUpperCase()) {
    case 'ERROR':
      return chalk.red.bold('ERROR');
    case 'WARN':
      return chalk.yellow('WARN ');
    case 'INFO':
      return chalk.blue('INFO ');
    case 'DEBUG':
      return chalk.gray('DEBUG');
    case 'TRACE':
      return chalk.gray('TRACE');
    default:
      return level.padEnd(5);
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
