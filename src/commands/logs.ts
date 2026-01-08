// Path: archon-cli/src/commands/logs.ts
// Log viewing commands with WebSocket streaming support

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import WebSocket from 'ws';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { error, info, statusBadge } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';
import { Service } from '../api/types.js';

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  exception?: string;
}

interface LogResult {
  success: boolean;
  entries: LogEntry[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

interface ServiceLogPath {
  name: string;
  path: string;
  description: string;
}

interface MachineLogPaths {
  machineId: string;
  machineName: string;
  logs: ServiceLogPath[];
}

interface ServiceLogPaths {
  serviceId: number;
  machines: MachineLogPaths[];
}

interface LogStreamEvent {
  type: 'CONNECTED' | 'LOG' | 'ERROR' | 'DISCONNECTED';
  channel: string;
  message?: string;
  entry?: LogEntry;
  machineId?: string;
  machineName?: string;
  logPath?: string;
  timestamp: number;
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
    .option('-f, --follow', 'Follow log output (uses WebSocket streaming)')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = new URLSearchParams();
        params.set('lines', options.lines);
        if (options.level) params.set('level', options.level.toUpperCase());

        if (options.follow) {
          await streamArchonLogs(options.level?.toUpperCase());
        } else {
          const result = await withSpinner<LogResult>(
            'Fetching logs...',
            async () => api.get<LogResult>(`/api/logs/archon?${params.toString()}`)
          );

          if (!result.success) {
            error(result.error || 'Failed to fetch logs');
            process.exit(1);
          }

          for (const entry of result.entries) {
            printLogEntry(entry);
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Interactive service log streaming - select from list
  logs
    .command('stream')
    .description('Interactively select a service and stream its logs')
    .option('--level <level>', 'Filter by level (DEBUG, INFO, WARN, ERROR)')
    .action(async (options) => {
      try {
        await interactiveLogStream(options.level?.toUpperCase());
      } catch (err) {
        handleError(err);
      }
    });

  // Service logs - list available log paths
  logs
    .command('service-paths <service>')
    .alias('paths')
    .description('List available log paths for a service (by ID or name)')
    .action(async (serviceArg: string) => {
      try {
        const api = await getAuthenticatedClient();

        // Resolve service by ID or name
        const serviceId = await resolveServiceId(api, serviceArg);
        if (!serviceId) {
          process.exit(1);
        }

        const result = await withSpinner<ServiceLogPaths>(
          'Fetching log paths...',
          async () => api.get<ServiceLogPaths>(`/api/services/${serviceId}/logs`)
        );

        if (result.machines.length === 0) {
          info('No log paths available for this service');
          return;
        }

        console.log(chalk.bold('\nAvailable log paths:\n'));

        for (const machine of result.machines) {
          console.log(chalk.cyan(`${machine.machineName}`));
          for (const log of machine.logs) {
            console.log(`  ${chalk.white(log.name.padEnd(15))} ${chalk.gray(log.path)}`);
            if (log.description) {
              console.log(`  ${' '.repeat(15)} ${chalk.dim(log.description)}`);
            }
          }
          console.log();
        }

        console.log(chalk.gray(`Use: archon logs service ${serviceId} <machineId> --path <path>`));
        console.log(chalk.gray(`Or:  archon logs service ${serviceId} <machineId> --path <path> -f`));
      } catch (err) {
        handleError(err);
      }
    });

  // Service logs - view/stream logs from a machine
  logs
    .command('service <service> [machineId]')
    .description('View service logs from a machine (service can be ID or name)')
    .option('-l, --lines <n>', 'Number of lines', '100')
    .option('-p, --path <path>', 'Log file path (use "logs paths <service>" to list)')
    .option('--level <level>', 'Filter by level (DEBUG, INFO, WARN, ERROR)')
    .option('-f, --follow', 'Follow log output (uses WebSocket streaming)')
    .option('--search <text>', 'Search for text in logs')
    .action(async (serviceArg: string, machineIdArg: string | undefined, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Resolve service by ID or name
        const serviceId = await resolveServiceId(api, serviceArg);
        if (!serviceId) {
          process.exit(1);
        }

        // Fetch log paths to get machine list
        const pathResult = await withSpinner<ServiceLogPaths>(
          'Fetching log paths...',
          async () => api.get<ServiceLogPaths>(`/api/services/${serviceId}/logs`)
        );

        if (pathResult.machines.length === 0) {
          error('No log paths available for this service');
          process.exit(1);
        }

        // If no machine ID specified, let user select interactively
        let machineId = machineIdArg;
        let selectedMachine: MachineLogPaths | undefined;

        if (!machineId) {
          // Interactive machine selection
          const machineChoices = pathResult.machines.map(m => ({
            name: `${m.machineName} (${m.logs.length} log${m.logs.length !== 1 ? 's' : ''})`,
            value: m.machineId
          }));

          const { selectedMachineId } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedMachineId',
            message: 'Select a machine:',
            choices: machineChoices
          }]);

          machineId = selectedMachineId;
        }

        selectedMachine = pathResult.machines.find(m => m.machineId === machineId);
        if (!selectedMachine || selectedMachine.logs.length === 0) {
          error(`No log paths available for machine '${machineId}'`);
          process.exit(1);
        }

        // If no path specified, let user select interactively
        let logPath = options.path;
        if (!logPath) {
          if (selectedMachine.logs.length === 1) {
            // Auto-select if only one log path
            logPath = selectedMachine.logs[0].path;
            console.log(chalk.gray(`Auto-selected log: ${selectedMachine.logs[0].name}`));
          } else {
            const pathChoices = selectedMachine.logs.map(l => ({
              name: `${l.name.padEnd(15)} ${chalk.gray(l.path)}`,
              value: l.path
            }));

            const { selectedPath } = await inquirer.prompt([{
              type: 'list',
              name: 'selectedPath',
              message: 'Select a log file:',
              choices: pathChoices
            }]);

            logPath = selectedPath;
          }
        }

        if (options.follow) {
          await streamServiceLogs(serviceId, machineId!, logPath, options.level?.toUpperCase());
        } else {
          const params = new URLSearchParams();
          params.set('path', logPath);
          params.set('lines', options.lines);
          if (options.search) params.set('search', options.search);

          const result = await withSpinner<LogResult>(
            'Fetching logs...',
            async () => api.get<LogResult>(
              `/api/services/${serviceId}/logs/${machineId}?${params.toString()}`
            )
          );

          if (!result.success) {
            error(result.error || 'Failed to fetch logs');
            process.exit(1);
          }

          for (const entry of result.entries) {
            printLogEntry(entry);
          }
        }
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

/**
 * Resolve a service argument to its ID.
 * Accepts service ID (e.g., "mysql-cluster") or display name (e.g., "MySQL Cluster").
 */
async function resolveServiceId(api: ReturnType<typeof createApiClient>, serviceArg: string): Promise<string | null> {
  // Fetch all services to find by ID or name
  const response = await withSpinner<{ services: Service[] }>(
    'Looking up service...',
    async () => api.get<{ services: Service[] }>('/api/services')
  );

  const services = response.services;

  // Try exact ID match first
  let service = services.find(s => s.id === serviceArg);

  // Try case-insensitive ID match
  if (!service) {
    service = services.find(s => s.id.toLowerCase() === serviceArg.toLowerCase());
  }

  // Try display name match (case-insensitive)
  if (!service) {
    service = services.find(s =>
      s.displayName.toLowerCase() === serviceArg.toLowerCase()
    );
  }

  // Try partial match on display name
  if (!service) {
    const matches = services.filter(s =>
      s.displayName.toLowerCase().includes(serviceArg.toLowerCase()) ||
      s.id.toLowerCase().includes(serviceArg.toLowerCase())
    );

    if (matches.length === 1) {
      service = matches[0];
    } else if (matches.length > 1) {
      error(`Ambiguous service name '${serviceArg}'. Did you mean:`);
      for (const m of matches) {
        console.log(chalk.gray(`  ${m.id} (${m.displayName})`));
      }
      return null;
    }
  }

  if (!service) {
    error(`Service '${serviceArg}' not found`);
    console.log(chalk.gray('\nAvailable services:'));
    for (const s of services.slice(0, 10)) {
      console.log(chalk.gray(`  ${s.id} (${s.displayName})`));
    }
    if (services.length > 10) {
      console.log(chalk.gray(`  ... and ${services.length - 10} more`));
    }
    return null;
  }

  return service.id;
}

/**
 * Interactive log streaming - select service, machine, and log path.
 */
async function interactiveLogStream(level?: string): Promise<void> {
  const api = await getAuthenticatedClient();

  // Step 1: Fetch and display services
  const response = await withSpinner<{ services: Service[] }>(
    'Fetching services...',
    async () => api.get<{ services: Service[] }>('/api/services')
  );

  const services = response.services;

  if (services.length === 0) {
    error('No services found');
    process.exit(1);
  }

  // Build service choices with health status
  const serviceChoices = services.map(s => ({
    name: `${s.displayName.padEnd(25)} ${statusBadge(s.healthSummary.overallStatus).padEnd(15)} ${chalk.gray(s.type.displayName || s.type.id)}`,
    value: s.id,
    short: s.displayName
  }));

  // Add Archon logs option at the top
  serviceChoices.unshift({
    name: `${chalk.cyan('ARCHON Backend').padEnd(25)} ${chalk.gray('Backend application logs')}`,
    value: '__archon__',
    short: 'ARCHON Backend'
  });

  const { selectedServiceId } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedServiceId',
    message: 'Select a service to stream logs:',
    choices: serviceChoices,
    pageSize: 15
  }]);

  // Handle Archon logs
  if (selectedServiceId === '__archon__') {
    await streamArchonLogs(level);
    return;
  }

  // Step 2: Fetch log paths for selected service
  const pathResult = await withSpinner<ServiceLogPaths>(
    'Fetching log paths...',
    async () => api.get<ServiceLogPaths>(`/api/services/${selectedServiceId}/logs`)
  );

  if (pathResult.machines.length === 0) {
    error('No log paths available for this service');
    process.exit(1);
  }

  // Step 3: Select machine
  let machineId: string;
  let selectedMachine: MachineLogPaths;

  if (pathResult.machines.length === 1) {
    selectedMachine = pathResult.machines[0];
    machineId = selectedMachine.machineId;
    console.log(chalk.gray(`Auto-selected machine: ${selectedMachine.machineName}`));
  } else {
    const machineChoices = pathResult.machines.map(m => ({
      name: `${m.machineName} (${m.logs.length} log${m.logs.length !== 1 ? 's' : ''})`,
      value: m.machineId
    }));

    const { selectedMachineId } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedMachineId',
      message: 'Select a machine:',
      choices: machineChoices
    }]);

    machineId = selectedMachineId;
    selectedMachine = pathResult.machines.find(m => m.machineId === machineId)!;
  }

  // Step 4: Select log path
  let logPath: string;

  if (selectedMachine.logs.length === 1) {
    logPath = selectedMachine.logs[0].path;
    console.log(chalk.gray(`Auto-selected log: ${selectedMachine.logs[0].name}`));
  } else {
    const pathChoices = selectedMachine.logs.map(l => ({
      name: `${l.name.padEnd(15)} ${chalk.gray(l.path)}`,
      value: l.path
    }));

    const { selectedPath } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedPath',
      message: 'Select a log file:',
      choices: pathChoices
    }]);

    logPath = selectedPath;
  }

  // Start streaming
  await streamServiceLogs(selectedServiceId, machineId, logPath, level);
}

/**
 * Stream Archon backend logs via WebSocket.
 */
async function streamArchonLogs(level?: string): Promise<void> {
  const profileName = getActiveProfileName();
  const profile = getActiveProfile();
  const token = await getValidToken(profileName, profile.url, profile.insecure);

  if (!token) {
    error('Not authenticated. Run: archon auth login');
    process.exit(1);
  }

  // Build WebSocket URL
  const wsBase = profile.url.replace(/^http/, 'ws');
  const params = new URLSearchParams();
  params.set('type', 'archon');
  params.set('token', token);
  if (level) params.set('level', level);

  const wsUrl = `${wsBase}/ws/logs?${params.toString()}`;

  console.log(chalk.gray('Streaming logs... (Press Ctrl+C to stop)\n'));

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      rejectUnauthorized: !profile.insecure
    });

    let isConnected = false;
    let pingInterval: NodeJS.Timeout | null = null;

    ws.on('open', () => {
      isConnected = true;
      // Send periodic pings to keep connection alive
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 30000);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as LogStreamEvent;

        switch (event.type) {
          case 'CONNECTED':
            console.log(chalk.green(`Connected to log stream: ${event.message || 'Archon logs'}`));
            console.log();
            break;

          case 'LOG':
            if (event.entry) {
              printLogEntry(event.entry);
            }
            break;

          case 'ERROR':
            console.error(chalk.red(`Stream error: ${event.message}`));
            break;

          case 'DISCONNECTED':
            console.log(chalk.gray(`\nStream ended: ${event.message || 'disconnected'}`));
            cleanup();
            resolve();
            break;
        }
      } catch {
        // Ignore parse errors (e.g., pong responses)
      }
    });

    ws.on('error', (err) => {
      cleanup();
      if (!isConnected) {
        console.error(chalk.red('\nFailed to connect to log stream'));
        console.error(chalk.gray('The backend may not support WebSocket log streaming'));
      } else {
        console.error(chalk.red(`\nConnection error: ${err.message}`));
      }
      reject(err);
    });

    ws.on('close', () => {
      cleanup();
      if (isConnected) {
        console.log(chalk.gray('\nLog stream closed'));
      }
      resolve();
    });

    function cleanup() {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('stop');
        ws.close();
      }
    }

    // Handle process termination
    process.on('SIGINT', () => {
      console.log(chalk.gray('\n\nStopping log stream...'));
      cleanup();
      resolve();
    });

    process.on('SIGTERM', () => {
      cleanup();
      resolve();
    });
  });
}

/**
 * Stream service logs via WebSocket.
 */
async function streamServiceLogs(
  serviceId: string,
  machineId: string,
  logPath: string,
  level?: string
): Promise<void> {
  const profileName = getActiveProfileName();
  const profile = getActiveProfile();
  const token = await getValidToken(profileName, profile.url, profile.insecure);

  if (!token) {
    error('Not authenticated. Run: archon auth login');
    process.exit(1);
  }

  // Build WebSocket URL
  const wsBase = profile.url.replace(/^http/, 'ws');
  const params = new URLSearchParams();
  params.set('type', 'service');
  params.set('serviceId', serviceId);
  params.set('machineId', machineId);
  params.set('path', logPath);
  params.set('token', token);
  if (level) params.set('level', level);

  const wsUrl = `${wsBase}/ws/logs?${params.toString()}`;

  console.log(chalk.gray('Streaming logs... (Press Ctrl+C to stop)\n'));

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      rejectUnauthorized: !profile.insecure
    });

    let isConnected = false;
    let pingInterval: NodeJS.Timeout | null = null;

    ws.on('open', () => {
      isConnected = true;
      // Send periodic pings to keep connection alive
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 30000);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as LogStreamEvent;

        switch (event.type) {
          case 'CONNECTED':
            console.log(chalk.green(`Connected to log stream: ${event.machineName || machineId}`));
            if (event.logPath) {
              console.log(chalk.gray(`Path: ${event.logPath}`));
            }
            console.log();
            break;

          case 'LOG':
            if (event.entry) {
              printLogEntry(event.entry);
            }
            break;

          case 'ERROR':
            console.error(chalk.red(`Stream error: ${event.message}`));
            break;

          case 'DISCONNECTED':
            console.log(chalk.gray(`\nStream ended: ${event.message || 'disconnected'}`));
            cleanup();
            resolve();
            break;
        }
      } catch {
        // Ignore parse errors (e.g., pong responses)
      }
    });

    ws.on('error', (err) => {
      cleanup();
      if (!isConnected) {
        console.error(chalk.red('\nFailed to connect to log stream'));
        console.error(chalk.gray('The backend may not support WebSocket log streaming for this service'));
      } else {
        console.error(chalk.red(`\nConnection error: ${err.message}`));
      }
      reject(err);
    });

    ws.on('close', () => {
      cleanup();
      if (isConnected) {
        console.log(chalk.gray('\nLog stream closed'));
      }
      resolve();
    });

    function cleanup() {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('stop');
        ws.close();
      }
    }

    // Handle process termination
    process.on('SIGINT', () => {
      console.log(chalk.gray('\n\nStopping log stream...'));
      cleanup();
      resolve();
    });

    process.on('SIGTERM', () => {
      cleanup();
      resolve();
    });
  });
}

function printLogEntry(entry: LogEntry): void {
  const level = formatLevel(entry.level);
  const time = formatTimestamp(entry.timestamp);
  const logger = chalk.gray(entry.logger.split('.').pop() || entry.logger);

  console.log(`${chalk.gray(time)} ${level} ${logger} ${entry.message}`);

  if (entry.exception) {
    console.log(chalk.red(entry.exception));
  }
}

function formatTimestamp(timestamp: string): string {
  // Handle ISO timestamps
  if (timestamp.includes('T')) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false });
  }
  // Handle "YYYY-MM-DD HH:mm:ss.SSS" format
  if (timestamp.length >= 19) {
    return timestamp.substring(11, 19);
  }
  return timestamp;
}

function formatLevel(level: string): string {
  switch (level.toUpperCase()) {
    case 'ERROR':
      return chalk.red.bold('ERROR');
    case 'WARN':
    case 'WARNING':
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

  const token = await getValidToken(profileName, profile.url, profile.insecure);
  if (!token) {
    error('Not authenticated. Run: archon auth login');
    process.exit(1);
  }

  return createApiClient(profile.url, token, profile.insecure);
}
