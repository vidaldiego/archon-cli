// Path: archon-cli/src/commands/ssh.ts
// Interactive SSH session via Archon backend

import { Command } from 'commander';
import chalk from 'chalk';
import WebSocket from 'ws';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { error } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface Machine {
  machineId: string;
  name: string;
  primaryIp?: string;
  identityId?: number;
  identityName?: string;
}

interface SshSessionResponse {
  sessionId: string;
  machineId: string;
  machineName: string;
  websocketUrl: string;
  expiresAt: number;
}

export function registerSshCommands(program: Command): void {
  program
    .command('ssh <machine>')
    .description('Open interactive SSH session to a machine (by name, ID, or IP)')
    .option('-u, --user <username>', 'Override SSH username')
    .option('-i, --identity <id>', 'Use specific identity ID')
    .action(async (machineArg: string, options) => {
      try {
        const profileName = getActiveProfileName();
        const profile = getActiveProfile();
        const token = await getValidToken(profileName, profile.url);

        if (!token) {
          error('Not authenticated. Run: archon auth login');
          process.exit(1);
        }

        const api = createApiClient(profile.url, token);

        // Find machine by ID, name, or IP address
        const machines = await withSpinner<Machine[]>(
          'Finding machine...',
          async () => api.get<Machine[]>('/api/machines')
        );

        const machine = machines.find(m =>
          m.machineId === machineArg ||
          m.name === machineArg ||
          m.name.toLowerCase() === machineArg.toLowerCase() ||
          m.primaryIp === machineArg
        );

        if (!machine) {
          error(`Machine '${machineArg}' not found`);
          console.log(chalk.gray('\nAvailable machines:'));
          for (const m of machines.slice(0, 10)) {
            console.log(chalk.gray(`  ${m.name} (${m.primaryIp || 'no IP'})`));
          }
          if (machines.length > 10) {
            console.log(chalk.gray(`  ... and ${machines.length - 10} more`));
          }
          process.exit(1);
        }

        // Check if machine has an identity
        const identityId = options.identity ? parseInt(options.identity) : machine.identityId;
        if (!identityId) {
          error(`Machine '${machine.name}' has no SSH identity assigned`);
          console.log(chalk.gray('Assign an identity first: archon machines assign-identity'));
          process.exit(1);
        }

        // Request SSH session from backend
        const sessionRequest: Record<string, unknown> = {
          machineId: machine.machineId
        };
        if (options.identity) {
          sessionRequest.identityId = parseInt(options.identity);
        }
        if (options.user) {
          sessionRequest.username = options.user;
        }

        console.log(chalk.gray(`Connecting to ${machine.name} (${machine.primaryIp || 'no IP'})...`));

        const session = await withSpinner<SshSessionResponse>(
          'Establishing SSH session...',
          async () => api.post<SshSessionResponse>('/api/ssh/session', sessionRequest)
        );

        // Connect via WebSocket
        const baseWsUrl = session.websocketUrl.startsWith('/')
          ? `${profile.url.replace('http', 'ws')}${session.websocketUrl}`
          : session.websocketUrl;

        // Add token and terminal size as query params
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        const wsUrl = `${baseWsUrl}?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;

        console.log(chalk.green(`Connected to ${session.machineName}`));
        console.log(chalk.gray('Press Ctrl+D or type "exit" to close the session\n'));

        await startInteractiveSession(wsUrl, token);

      } catch (err) {
        handleError(err);
      }
    });

  // List active sessions
  program
    .command('ssh-sessions')
    .description('List active SSH sessions')
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

        const sessions = await withSpinner<SshSessionResponse[]>(
          'Fetching sessions...',
          async () => api.get<SshSessionResponse[]>('/api/ssh/sessions')
        );

        if (sessions.length === 0) {
          console.log(chalk.gray('No active SSH sessions'));
          return;
        }

        console.log(chalk.bold('\nActive SSH Sessions:'));
        for (const s of sessions) {
          const expires = new Date(s.expiresAt);
          console.log(`  ${s.sessionId.substring(0, 8)} - ${s.machineName} (expires: ${expires.toLocaleTimeString()})`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}

async function startInteractiveSession(wsUrl: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    let isConnected = false;

    // Set raw mode for terminal input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    ws.on('open', () => {
      isConnected = true;

      // Send terminal size
      const size = {
        type: 'resize',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24
      };
      ws.send(JSON.stringify(size));

      // Handle terminal resize
      process.stdout.on('resize', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: process.stdout.columns || 80,
            rows: process.stdout.rows || 24
          }));
        }
      });
    });

    // Pipe stdin to websocket
    process.stdin.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data: data.toString('base64')
        }));
      }
    });

    // Pipe websocket output to stdout
    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'output' && msg.data) {
          const output = Buffer.from(msg.data, 'base64');
          process.stdout.write(output);
        } else if (msg.type === 'error') {
          console.error(chalk.red(`\nError: ${msg.message}`));
        } else if (msg.type === 'exit') {
          console.log(chalk.gray(`\nSession ended (exit code: ${msg.code})`));
          cleanup();
          resolve();
        }
      } catch {
        // If not JSON, treat as raw output
        process.stdout.write(data.toString());
      }
    });

    ws.on('error', (err) => {
      cleanup();
      if (!isConnected) {
        console.error(chalk.red('\nFailed to connect to SSH session'));
        console.error(chalk.gray('The backend may not support WebSocket SSH sessions'));
      } else {
        console.error(chalk.red(`\nConnection error: ${err.message}`));
      }
      reject(err);
    });

    ws.on('close', (code, reason) => {
      cleanup();
      if (isConnected) {
        console.log(chalk.gray('\nConnection closed'));
      }
      resolve();
    });

    function cleanup() {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      ws.close();
    }

    // Handle process termination
    process.on('SIGINT', () => {
      console.log(chalk.gray('\n\nClosing session...'));
      cleanup();
      resolve();
    });

    process.on('SIGTERM', () => {
      cleanup();
      resolve();
    });
  });
}
