// Path: archon-cli/src/commands/exec.ts
// Ad-hoc command execution across machines

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { output, statusBadge, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';
import { getAuthenticatedClient } from '../utils/auth.js';

// Type definitions for execution API
interface MachineSelector {
  machineIds?: string[];
  tags?: Record<string, string>;
  identityId?: number;
  serviceId?: number;
  all?: boolean;
}

interface ExecuteRequest {
  selector: MachineSelector;
  command: string;
  become?: boolean;
  becomeMethod?: string;
  becomeUser?: string;
  parallel?: number;
  timeoutSeconds?: number;
  failFast?: boolean;
}

interface MachineExecutionResult {
  machineId: string;
  machineName: string;
  status: string;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  errorMessage: string | null;
  durationMs: number;
}

interface ExecutionSummary {
  total: number;
  success: number;
  failed: number;
  error: number;
  timeout: number;
  skipped: number;
}

interface ExecuteResponse {
  executionId: string;
  command: string;
  become: boolean;
  becomeUser: string | null;
  results: MachineExecutionResult[];
  summary: ExecutionSummary;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

interface MachinePreview {
  machineId: string;
  name: string;
  ip: string | null;
  identityId: number | null;
  identityName: string | null;
  hasSudoPassword: boolean;
}

interface PreviewResponse {
  count: number;
  machines: MachinePreview[];
}

interface ValidationResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
  targetCount: number;
}

interface ExecutionHistoryItem {
  executionId: string;
  command: string;
  become: boolean;
  totalMachines: number;
  successCount: number;
  failedCount: number;
  startedAt: number;
  durationMs: number;
}

interface HistoryResponse {
  executions: ExecutionHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

// Result list table config
const resultTableConfig: TableConfig<MachineExecutionResult[]> = {
  headers: ['Machine', 'Status', 'Exit', 'Duration', 'Output'],
  transform: (results) =>
    results.map(r => [
      r.machineName,
      r.status === 'SUCCESS' ? chalk.green(r.status) :
      r.status === 'FAILED' ? chalk.red(r.status) :
      r.status === 'SKIPPED' ? chalk.yellow(r.status) :
      chalk.red(r.status),
      r.exitCode !== null ? r.exitCode.toString() : '-',
      `${r.durationMs}ms`,
      (r.stdout || r.stderr || r.errorMessage || '-').substring(0, 50) +
        ((r.stdout || r.stderr || r.errorMessage || '').length > 50 ? '...' : '')
    ])
};

// History list table config
const historyTableConfig: TableConfig<ExecutionHistoryItem[]> = {
  headers: ['ID', 'Command', 'Sudo', 'Machines', 'Success', 'Failed', 'Time'],
  transform: (items) =>
    items.map(i => [
      i.executionId.substring(0, 12),
      i.command.substring(0, 40) + (i.command.length > 40 ? '...' : ''),
      i.become ? chalk.yellow('yes') : 'no',
      i.totalMachines.toString(),
      chalk.green(i.successCount.toString()),
      i.failedCount > 0 ? chalk.red(i.failedCount.toString()) : '0',
      new Date(i.startedAt).toLocaleString()
    ])
};

export function registerExecCommands(program: Command): void {
  const exec = program
    .command('exec')
    .description('Execute commands on machines');

  // Main exec command - run a command
  exec
    .command('run <command>')
    .description('Execute a command on selected machines')
    .option('-m, --machines <ids...>', 'Target specific machine IDs')
    .option('-t, --tag <tags...>', 'Target machines by tag (format: key=value)')
    .option('-s, --service <id>', 'Target machines in a service')
    .option('-i, --identity <id>', 'Target machines with specific identity')
    .option('-a, --all', 'Target all machines (dangerous)')
    .option('-b, --become', 'Run with privilege escalation (sudo)')
    .option('--become-method <method>', 'Escalation method: SUDO, SU, DOAS', 'SUDO')
    .option('--become-user <user>', 'Target user for escalation', 'root')
    .option('-p, --parallel <n>', 'Max parallel executions', '10')
    .option('--timeout <seconds>', 'Command timeout in seconds', '30')
    .option('--fail-fast', 'Stop on first failure')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (command: string, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Build selector
        const selector: MachineSelector = {};

        if (options.machines && options.machines.length > 0) {
          selector.machineIds = options.machines;
        }
        if (options.tag && options.tag.length > 0) {
          selector.tags = {};
          for (const t of options.tag) {
            const [key, value] = t.split('=');
            if (key && value) {
              selector.tags[key] = value;
            }
          }
        }
        if (options.service) {
          selector.serviceId = parseInt(options.service);
        }
        if (options.identity) {
          selector.identityId = parseInt(options.identity);
        }
        if (options.all) {
          selector.all = true;
        }

        // Check if any selector was provided
        if (!selector.machineIds && !selector.tags && !selector.serviceId && !selector.identityId && !selector.all) {
          console.error(chalk.red('Error: No target machines specified.'));
          console.error(chalk.gray('Use -m, -t, -s, -i, or -a to select machines.'));
          process.exit(1);
        }

        // Preview targets first
        const preview = await withSpinner<PreviewResponse>(
          'Finding target machines...',
          async () => api.post<PreviewResponse>('/api/execute/preview', selector)
        );

        if (preview.count === 0) {
          console.log(chalk.yellow('No machines match the selector.'));
          return;
        }

        // Show targets and ask for confirmation
        console.log();
        console.log(chalk.bold(`Target machines (${preview.count}):`));
        for (const m of preview.machines.slice(0, 10)) {
          const identityInfo = m.identityName ? chalk.gray(` [${m.identityName}]`) : chalk.red(' [no identity]');
          console.log(`  • ${m.name} ${chalk.gray(m.ip || 'no IP')}${identityInfo}`);
        }
        if (preview.count > 10) {
          console.log(chalk.gray(`  ... and ${preview.count - 10} more`));
        }
        console.log();
        console.log(chalk.bold('Command:'), command);
        if (options.become) {
          console.log(chalk.yellow(`Privilege escalation: ${options.becomeMethod} → ${options.becomeUser}`));
        }
        console.log();

        // Confirmation
        if (!options.yes) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: options.become
                ? `Execute command with sudo on ${preview.count} machine(s)?`
                : `Execute command on ${preview.count} machine(s)?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        // Build request
        const request: ExecuteRequest = {
          selector,
          command,
          become: options.become || false,
          becomeMethod: options.becomeMethod || 'SUDO',
          becomeUser: options.becomeUser || 'root',
          parallel: parseInt(options.parallel) || 10,
          timeoutSeconds: parseInt(options.timeout) || 30,
          failFast: options.failFast || false
        };

        // Execute
        const response = await withSpinner<ExecuteResponse>(
          `Executing on ${preview.count} machine(s)...`,
          async () => api.post<ExecuteResponse>('/api/execute', request)
        );

        // Display results
        console.log();
        console.log(chalk.bold('Results:'));

        // Group by status
        const byStatus: Record<string, MachineExecutionResult[]> = {};
        for (const r of response.results) {
          if (!byStatus[r.status]) byStatus[r.status] = [];
          byStatus[r.status].push(r);
        }

        // Show summary
        const { summary } = response;
        const parts: string[] = [];
        if (summary.success > 0) parts.push(chalk.green(`${summary.success} success`));
        if (summary.failed > 0) parts.push(chalk.red(`${summary.failed} failed`));
        if (summary.error > 0) parts.push(chalk.red(`${summary.error} error`));
        if (summary.timeout > 0) parts.push(chalk.yellow(`${summary.timeout} timeout`));
        if (summary.skipped > 0) parts.push(chalk.yellow(`${summary.skipped} skipped`));

        console.log(`  ${parts.join(' | ')} (${response.durationMs}ms total)`);
        console.log();

        // Show detailed results
        output(response.results, resultTableConfig);

        // Show full output for failures
        const failures = response.results.filter(r => r.status !== 'SUCCESS');
        if (failures.length > 0 && failures.length <= 5) {
          console.log();
          console.log(chalk.bold.red('Failure details:'));
          for (const f of failures) {
            console.log();
            console.log(chalk.yellow(`═══ ${f.machineName} (${f.status}) ═══`));
            if (f.errorMessage) {
              console.log(chalk.red(f.errorMessage));
            }
            if (f.stderr) {
              console.log(chalk.red(f.stderr));
            }
            if (f.stdout) {
              console.log(f.stdout);
            }
          }
        }

        // Execution ID for reference
        console.log();
        console.log(chalk.gray(`Execution ID: ${response.executionId}`));

        // Exit with error code if any failures
        if (summary.failed > 0 || summary.error > 0 || summary.timeout > 0) {
          process.exit(1);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Preview command
  exec
    .command('preview')
    .description('Preview which machines would be targeted')
    .option('-m, --machines <ids...>', 'Target specific machine IDs')
    .option('-t, --tag <tags...>', 'Target machines by tag (format: key=value)')
    .option('-s, --service <id>', 'Target machines in a service')
    .option('-i, --identity <id>', 'Target machines with specific identity')
    .option('-a, --all', 'Target all machines')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        // Build selector
        const selector: MachineSelector = {};

        if (options.machines && options.machines.length > 0) {
          selector.machineIds = options.machines;
        }
        if (options.tag && options.tag.length > 0) {
          selector.tags = {};
          for (const t of options.tag) {
            const [key, value] = t.split('=');
            if (key && value) {
              selector.tags[key] = value;
            }
          }
        }
        if (options.service) {
          selector.serviceId = parseInt(options.service);
        }
        if (options.identity) {
          selector.identityId = parseInt(options.identity);
        }
        if (options.all) {
          selector.all = true;
        }

        const preview = await withSpinner<PreviewResponse>(
          'Finding target machines...',
          async () => api.post<PreviewResponse>('/api/execute/preview', selector)
        );

        console.log();
        console.log(chalk.bold(`Matching machines (${preview.count}):`));

        for (const m of preview.machines) {
          const identityInfo = m.identityName
            ? chalk.green(m.identityName)
            : chalk.red('no identity');
          const sudoInfo = m.hasSudoPassword
            ? chalk.green('✓ sudo')
            : chalk.yellow('no sudo pwd');

          console.log(`  • ${m.name.padEnd(25)} ${chalk.gray((m.ip || 'no IP').padEnd(15))} ${identityInfo.padEnd(20)} ${sudoInfo}`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // History command
  exec
    .command('history')
    .description('Show execution history')
    .option('-l, --limit <n>', 'Number of entries', '20')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const history = await withSpinner<HistoryResponse>(
          'Fetching execution history...',
          async () => api.get<HistoryResponse>(`/api/execute/history?limit=${options.limit}`)
        );

        if (history.executions.length === 0) {
          console.log(chalk.gray('No execution history.'));
          return;
        }

        output(history.executions, historyTableConfig);
        console.log(chalk.gray(`\n${history.executions.length} execution(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get execution details
  exec
    .command('get <id>')
    .description('Get execution details')
    .action(async (id) => {
      try {
        const api = await getAuthenticatedClient();

        const execution = await withSpinner<ExecuteResponse>(
          'Fetching execution...',
          async () => api.get<ExecuteResponse>(`/api/execute/${id}`)
        );

        // Show summary
        console.log();
        console.log(chalk.bold('Execution Details:'));
        console.log(`  ID: ${execution.executionId}`);
        console.log(`  Command: ${execution.command}`);
        console.log(`  Sudo: ${execution.become ? 'yes' : 'no'}${execution.becomeUser ? ` (→ ${execution.becomeUser})` : ''}`);
        console.log(`  Duration: ${execution.durationMs}ms`);
        console.log(`  Started: ${new Date(execution.startedAt).toLocaleString()}`);
        console.log();

        // Show results
        console.log(chalk.bold('Results:'));
        const { summary } = execution;
        console.log(`  Success: ${chalk.green(summary.success)} | Failed: ${chalk.red(summary.failed)} | Error: ${chalk.red(summary.error)} | Timeout: ${chalk.yellow(summary.timeout)} | Skipped: ${chalk.yellow(summary.skipped)}`);
        console.log();

        output(execution.results, resultTableConfig);

        // Show output for all machines
        for (const r of execution.results) {
          console.log();
          const statusColor = r.status === 'SUCCESS' ? chalk.green : chalk.red;
          console.log(statusColor(`═══ ${r.machineName} (${r.status}, exit=${r.exitCode}) ═══`));
          if (r.stdout) {
            console.log(r.stdout);
          }
          if (r.stderr) {
            console.log(chalk.red(r.stderr));
          }
          if (r.errorMessage) {
            console.log(chalk.red(r.errorMessage));
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Stats command
  exec
    .command('stats')
    .description('Show execution statistics')
    .option('--hours <n>', 'Time period in hours', '24')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const stats = await withSpinner(
          'Fetching stats...',
          async () => api.get(`/api/execute/stats?hours=${options.hours}`)
        );

        output(stats);
      } catch (err) {
        handleError(err);
      }
    });
}
