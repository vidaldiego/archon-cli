// Path: archon-cli/src/commands/auto-approval.ts
// AI Auto-Approval policy and proposal management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import {
  AutoApprovalPolicy,
  AutoApprovalPolicyUpdate,
  AutoApprovalStats,
  CircuitBreakerStatus,
  CircuitBreakerEntry,
  ExecutionLog,
  ExecutionLogsResponse,
  AIActionProposal,
  RiskLevel,
  AIActionType,
} from '../api/types.js';
import { output, error } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

const RISK_COLORS: Record<RiskLevel, (s: string) => string> = {
  LOW: chalk.green,
  MEDIUM: chalk.yellow,
  HIGH: chalk.hex('#FF8800'),
  CRITICAL: chalk.red,
};

const ACTION_TYPE_LABELS: Record<AIActionType, string> = {
  RESTART_SERVICE: 'Restart Service',
  CLEAR_CACHE: 'Clear Cache',
  ROTATE_LOGS: 'Rotate Logs',
  SCALE_RESOURCES: 'Scale Resources',
  APPLY_UPDATE: 'Apply Update',
  FAILOVER: 'Failover',
  REPLICATION_FIX: 'Replication Fix',
  CUSTOM: 'Custom',
};

export function registerAutoApprovalCommands(program: Command): void {
  const autoApproval = program
    .command('auto-approval')
    .alias('aa')
    .description('AI auto-approval policy and proposal management');

  // ═══════════════════════════════════════════════════════════════════════════
  // Policy Commands
  // ═══════════════════════════════════════════════════════════════════════════

  // Show policy
  autoApproval
    .command('policy')
    .description('Show auto-approval policy')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const policy = await withSpinner<AutoApprovalPolicy>(
          'Fetching policy...',
          async () => api.get<AutoApprovalPolicy>('/api/ai/actions/auto-approval/policy')
        );

        console.log();
        console.log(chalk.bold('AI Auto-Approval Policy'));
        console.log();
        console.log(`  Status:              ${policy.enabled ? chalk.green('● Enabled') : chalk.gray('○ Disabled')}`);
        console.log(`  Max Risk Level:      ${RISK_COLORS[policy.maxRiskLevel](policy.maxRiskLevel)}`);
        console.log(`  Min Confidence:      ${(policy.minConfidenceScore * 100).toFixed(0)}%`);
        console.log(`  Require Similar:     ${policy.requireSimilarSuccess ? `Yes (min ${policy.minSimilarCount})` : 'No'}`);
        console.log(`  Cooldown:            ${policy.cooldownMinutes} minutes`);
        console.log(`  Rate Limit:          ${policy.maxPerHour}/hour`);
        console.log();
        console.log(chalk.dim('  Allowed Actions:'));
        if (policy.allowedActionTypes === null) {
          console.log(chalk.dim('    All action types'));
        } else {
          for (const type of policy.allowedActionTypes) {
            console.log(chalk.dim(`    • ${ACTION_TYPE_LABELS[type] || type}`));
          }
        }
        console.log();
        console.log(chalk.dim('  Notifications:'));
        console.log(`    On auto-approval:  ${policy.notifyOnAutoApproval ? 'Yes' : 'No'}`);
        console.log(`    On execution:      ${policy.notifyOnAutoExecution ? 'Yes' : 'No'}`);
        console.log();

        if (policy.updatedAt) {
          console.log(chalk.gray(`  Last updated: ${format(new Date(policy.updatedAt), 'yyyy-MM-dd HH:mm')}`));
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // Enable/disable
  autoApproval
    .command('enable')
    .description('Enable auto-approval')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Enabling auto-approval...',
          async () => api.put('/api/ai/actions/auto-approval/policy', { enabled: true }),
          'Auto-approval enabled'
        );
      } catch (err) {
        handleError(err);
      }
    });

  autoApproval
    .command('disable')
    .description('Disable auto-approval')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Disabling auto-approval...',
          async () => api.put('/api/ai/actions/auto-approval/policy', { enabled: false }),
          'Auto-approval disabled'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Configure policy interactively
  autoApproval
    .command('configure')
    .description('Configure auto-approval policy interactively')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing policy for defaults
        const existing = await api.get<AutoApprovalPolicy>('/api/ai/actions/auto-approval/policy');

        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'enabled',
            message: 'Enable auto-approval?',
            default: existing.enabled,
          },
          {
            type: 'list',
            name: 'maxRiskLevel',
            message: 'Maximum risk level for auto-approval:',
            choices: [
              { name: chalk.green('LOW') + ' - Safe operations only', value: 'LOW' },
              { name: chalk.yellow('MEDIUM') + ' - Include moderate risk', value: 'MEDIUM' },
            ],
            default: existing.maxRiskLevel,
          },
          {
            type: 'number',
            name: 'minConfidenceScore',
            message: 'Minimum confidence score (0.0-1.0):',
            default: existing.minConfidenceScore,
            validate: (input: number) => (input >= 0 && input <= 1) || 'Must be between 0.0 and 1.0',
          },
          {
            type: 'confirm',
            name: 'requireSimilarSuccess',
            message: 'Require similar past successful decisions?',
            default: existing.requireSimilarSuccess,
          },
          {
            type: 'number',
            name: 'minSimilarCount',
            message: 'Minimum similar successful decisions:',
            default: existing.minSimilarCount,
            when: (ans) => ans.requireSimilarSuccess,
            validate: (input: number) => input >= 1 || 'Must be at least 1',
          },
          {
            type: 'number',
            name: 'cooldownMinutes',
            message: 'Cooldown between actions on same target (minutes):',
            default: existing.cooldownMinutes,
            validate: (input: number) => input >= 0 || 'Must be non-negative',
          },
          {
            type: 'number',
            name: 'maxPerHour',
            message: 'Maximum auto-executions per hour:',
            default: existing.maxPerHour,
            validate: (input: number) => input >= 1 || 'Must be at least 1',
          },
          {
            type: 'confirm',
            name: 'notifyOnAutoApproval',
            message: 'Send notification on auto-approval?',
            default: existing.notifyOnAutoApproval,
          },
          {
            type: 'confirm',
            name: 'notifyOnAutoExecution',
            message: 'Send notification on execution?',
            default: existing.notifyOnAutoExecution,
          },
        ]);

        const update: AutoApprovalPolicyUpdate = {
          enabled: answers.enabled,
          maxRiskLevel: answers.maxRiskLevel,
          minConfidenceScore: answers.minConfidenceScore,
          requireSimilarSuccess: answers.requireSimilarSuccess,
          minSimilarCount: answers.requireSimilarSuccess ? answers.minSimilarCount : existing.minSimilarCount,
          cooldownMinutes: answers.cooldownMinutes,
          maxPerHour: answers.maxPerHour,
          notifyOnAutoApproval: answers.notifyOnAutoApproval,
          notifyOnAutoExecution: answers.notifyOnAutoExecution,
        };

        await withSpinner(
          'Saving policy...',
          async () => api.put('/api/ai/actions/auto-approval/policy', update),
          'Policy saved'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Set policy options directly
  autoApproval
    .command('set')
    .description('Set policy options directly')
    .option('--max-risk <level>', 'Maximum risk level (LOW, MEDIUM)')
    .option('--min-confidence <score>', 'Minimum confidence (0.0-1.0)')
    .option('--cooldown <minutes>', 'Cooldown minutes')
    .option('--max-per-hour <count>', 'Max executions per hour')
    .option('--require-similar <bool>', 'Require similar success (true/false)')
    .option('--min-similar <count>', 'Min similar count')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const update: AutoApprovalPolicyUpdate = {};
        if (options.maxRisk) update.maxRiskLevel = options.maxRisk.toUpperCase() as RiskLevel;
        if (options.minConfidence) update.minConfidenceScore = parseFloat(options.minConfidence);
        if (options.cooldown) update.cooldownMinutes = parseInt(options.cooldown);
        if (options.maxPerHour) update.maxPerHour = parseInt(options.maxPerHour);
        if (options.requireSimilar !== undefined) update.requireSimilarSuccess = options.requireSimilar === 'true';
        if (options.minSimilar) update.minSimilarCount = parseInt(options.minSimilar);

        if (Object.keys(update).length === 0) {
          error('No options specified. Use --help to see available options.');
          return;
        }

        await withSpinner(
          'Updating policy...',
          async () => api.put('/api/ai/actions/auto-approval/policy', update),
          'Policy updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stats Command
  // ═══════════════════════════════════════════════════════════════════════════

  autoApproval
    .command('stats')
    .description('Show auto-approval statistics')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const stats = await withSpinner<AutoApprovalStats>(
          'Fetching stats...',
          async () => api.get<AutoApprovalStats>('/api/ai/actions/auto-approval/stats')
        );

        console.log();
        console.log(chalk.bold('Auto-Approval Statistics'));
        console.log();
        console.log(`  Auto-approved:         ${chalk.green(stats.autoApprovedCount.toString())}`);
        console.log(`  Auto-executed:         ${stats.autoExecutedCount}`);
        console.log(`  Successful:            ${chalk.green(stats.successCount.toString())}`);
        console.log(`  Failed:                ${chalk.red(stats.failureCount.toString())}`);
        console.log(`  Success rate:          ${(stats.successRate * 100).toFixed(1)}%`);
        console.log(`  Avg execution time:    ${stats.avgExecutionTimeMs > 0 ? (stats.avgExecutionTimeMs / 1000).toFixed(1) + 's' : '-'}`);
        console.log();
        console.log('  Current Status:');
        console.log(`    Circuit breakers open: ${stats.circuitBreakerOpenCount > 0 ? chalk.red(stats.circuitBreakerOpenCount.toString()) : chalk.green('0')}`);
        console.log(`    Cooldowns active:      ${stats.cooldownActiveCount > 0 ? chalk.yellow(stats.cooldownActiveCount.toString()) : '0'}`);
        console.log();
        if (stats.lastAutoApprovalAt) {
          console.log(chalk.gray(`  Last auto-approval: ${format(new Date(stats.lastAutoApprovalAt), 'yyyy-MM-dd HH:mm')}`));
        }
        if (stats.lastAutoExecutionAt) {
          console.log(chalk.gray(`  Last auto-execution: ${format(new Date(stats.lastAutoExecutionAt), 'yyyy-MM-dd HH:mm')}`));
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // Circuit Breaker Commands
  // ═══════════════════════════════════════════════════════════════════════════

  autoApproval
    .command('circuit-breakers')
    .alias('cb')
    .description('Show circuit breaker status')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const status = await withSpinner<CircuitBreakerStatus>(
          'Fetching circuit breaker status...',
          async () => api.get<CircuitBreakerStatus>('/api/ai/actions/circuit-breaker')
        );

        console.log();
        console.log(chalk.bold('Circuit Breaker Status'));
        console.log();

        if (status.totalCount === 0 && status.global === null) {
          console.log(chalk.gray('  No circuit breakers have been triggered.'));
          console.log();
          return;
        }

        console.log(`  Open:  ${status.openCount > 0 ? chalk.red(status.openCount.toString()) : chalk.green('0')}`);
        console.log(`  Total: ${status.totalCount}`);
        console.log();

        // Global
        if (status.global) {
          console.log(chalk.bold('  Global:'));
          printCircuitBreaker(status.global);
        }

        // Machines
        if (status.machines.length > 0) {
          console.log(chalk.bold('  Machines:'));
          for (const cb of status.machines) {
            printCircuitBreaker(cb);
          }
        }

        // Services
        if (status.services.length > 0) {
          console.log(chalk.bold('  Services:'));
          for (const cb of status.services) {
            printCircuitBreaker(cb);
          }
        }

        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  autoApproval
    .command('reset-breaker <type> [targetId]')
    .description('Reset a circuit breaker (type: GLOBAL, MACHINE, SERVICE)')
    .action(async (type: string, targetId?: string) => {
      try {
        const api = await getAuthenticatedClient();

        const targetType = type.toUpperCase();
        if (!['GLOBAL', 'MACHINE', 'SERVICE'].includes(targetType)) {
          error('Type must be GLOBAL, MACHINE, or SERVICE');
          return;
        }

        const id = targetId || 'global';

        await withSpinner(
          'Resetting circuit breaker...',
          async () => api.post(`/api/ai/actions/circuit-breaker/${targetType}/${id}/reset`, {}),
          `Circuit breaker reset: ${targetType}${targetId ? '/' + targetId : ''}`
        );
      } catch (err) {
        handleError(err);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // Execution Logs
  // ═══════════════════════════════════════════════════════════════════════════

  autoApproval
    .command('logs')
    .description('Show execution logs')
    .option('-l, --limit <n>', 'Limit results', '20')
    .option('-t, --type <type>', 'Filter by type (AUTO, MANUAL)')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = new URLSearchParams();
        params.append('limit', options.limit);
        if (options.type) params.append('executionType', options.type.toUpperCase());

        const response = await withSpinner<ExecutionLogsResponse>(
          'Fetching logs...',
          async () => api.get<ExecutionLogsResponse>(`/api/ai/actions/execution-logs?${params}`)
        );

        if (response.logs.length === 0) {
          console.log(chalk.gray('No execution logs found.'));
          return;
        }

        console.log();
        console.log(chalk.bold(`Execution Logs (${response.total} total)`));
        console.log();

        for (const log of response.logs) {
          const statusIcon = log.success === true ? chalk.green('✓') :
                            log.success === false ? chalk.red('✗') :
                            chalk.yellow('●');
          const typeLabel = log.executionType === 'AUTO' ? chalk.cyan('AUTO') : chalk.blue('MANUAL');
          const time = format(new Date(log.startedAt), 'yyyy-MM-dd HH:mm');
          const duration = log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '-';

          console.log(`  ${statusIcon} ${time} ${typeLabel} ${chalk.gray(log.proposalId.substring(0, 8))} (${duration})`);
          if (log.errorMessage) {
            console.log(chalk.red(`      ${log.errorMessage}`));
          }
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // Proposals
  // ═══════════════════════════════════════════════════════════════════════════

  autoApproval
    .command('proposals')
    .alias('list')
    .description('List AI action proposals')
    .option('-s, --status <status>', 'Filter by status (PENDING, APPROVED, REJECTED, EXECUTED, FAILED)')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const params = new URLSearchParams();
        params.append('limit', options.limit);
        if (options.status) params.append('status', options.status.toUpperCase());

        interface ProposalsResponse {
          proposals: AIActionProposal[];
          total: number;
        }

        const response = await withSpinner<ProposalsResponse>(
          'Fetching proposals...',
          async () => api.get<ProposalsResponse>(`/api/ai/actions/proposals?${params}`)
        );

        const proposals = response.proposals;

        if (proposals.length === 0) {
          console.log(chalk.gray('No proposals found.'));
          return;
        }

        console.log();
        console.log(chalk.bold('AI Action Proposals'));
        console.log();

        for (const proposal of proposals) {
          const statusIcon = getStatusIcon(proposal.status);
          const riskColor = RISK_COLORS[proposal.riskLevel];
          const confidence = `${(proposal.confidenceScore * 100).toFixed(0)}%`;
          const time = format(new Date(proposal.createdAt), 'yyyy-MM-dd HH:mm');
          const target = proposal.machineName || proposal.serviceName || 'N/A';

          console.log(`  ${statusIcon} ${chalk.bold(proposal.id.substring(0, 8))} ${proposal.actionTitle}`);
          console.log(`      Target: ${target} | Risk: ${riskColor(proposal.riskLevel)} | Confidence: ${confidence}`);
          console.log(`      Created: ${time}${proposal.autoApprovalEligible ? chalk.cyan(' [Auto-eligible]') : ''}`);
          if (proposal.ineligibilityReasons && proposal.ineligibilityReasons.length > 0) {
            console.log(chalk.gray(`      Ineligible: ${proposal.ineligibilityReasons.join(', ')}`));
          }
          console.log();
        }
      } catch (err) {
        handleError(err);
      }
    });

  autoApproval
    .command('show <id>')
    .description('Show proposal details')
    .action(async (id: string) => {
      try {
        const api = await getAuthenticatedClient();

        const proposal = await withSpinner<AIActionProposal>(
          'Fetching proposal...',
          async () => api.get<AIActionProposal>(`/api/ai/actions/proposals/${id}`)
        );

        console.log();
        console.log(chalk.bold('AI Action Proposal'));
        console.log();
        console.log(`  ID:              ${proposal.id}`);
        console.log(`  Status:          ${getStatusIcon(proposal.status)} ${proposal.status}`);
        console.log(`  Action:          ${proposal.actionTitle}`);
        console.log(`  Type:            ${ACTION_TYPE_LABELS[proposal.actionType] || proposal.actionType}`);
        console.log(`  Target:          ${proposal.machineName || proposal.serviceName || 'N/A'}`);
        console.log(`  Risk Level:      ${RISK_COLORS[proposal.riskLevel](proposal.riskLevel)}`);
        console.log(`  Confidence:      ${(proposal.confidenceScore * 100).toFixed(1)}%`);
        console.log(`  Auto-Eligible:   ${proposal.autoApprovalEligible ? chalk.green('Yes') : chalk.red('No')}`);
        console.log();
        console.log(chalk.dim('  Description:'));
        console.log(`    ${proposal.actionDescription}`);
        console.log();
        if (proposal.command) {
          console.log(chalk.dim('  Command:'));
          console.log(chalk.gray(`    ${proposal.command}`));
          console.log();
        }
        console.log(chalk.dim('  Reasoning:'));
        console.log(`    ${proposal.reasoning}`);
        console.log();
        if (proposal.ineligibilityReasons && proposal.ineligibilityReasons.length > 0) {
          console.log(chalk.dim('  Ineligibility Reasons:'));
          for (const reason of proposal.ineligibilityReasons) {
            console.log(chalk.yellow(`    • ${reason}`));
          }
          console.log();
        }
        console.log(chalk.dim('  Timeline:'));
        console.log(`    Created:   ${format(new Date(proposal.createdAt), 'yyyy-MM-dd HH:mm:ss')}`);
        console.log(`    Expires:   ${format(new Date(proposal.expiresAt), 'yyyy-MM-dd HH:mm:ss')}`);
        if (proposal.decidedAt) {
          console.log(`    Decided:   ${format(new Date(proposal.decidedAt), 'yyyy-MM-dd HH:mm:ss')} by ${proposal.decidedBy}`);
        }
        if (proposal.executedAt) {
          console.log(`    Executed:  ${format(new Date(proposal.executedAt), 'yyyy-MM-dd HH:mm:ss')}`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });

  autoApproval
    .command('approve <id>')
    .description('Approve a proposal')
    .option('-e, --execute', 'Execute immediately after approval')
    .action(async (id: string, options) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Approving proposal...',
          async () => api.post(`/api/ai/actions/proposals/${id}/approve`, { execute: options.execute || false }),
          options.execute ? 'Proposal approved and executed' : 'Proposal approved'
        );
      } catch (err) {
        handleError(err);
      }
    });

  autoApproval
    .command('reject <id>')
    .description('Reject a proposal')
    .option('-r, --reason <reason>', 'Rejection reason')
    .action(async (id: string, options) => {
      try {
        const api = await getAuthenticatedClient();

        let reason = options.reason;
        if (!reason) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'reason',
              message: 'Rejection reason:',
              validate: (input: string) => input.length > 0 || 'Reason is required',
            },
          ]);
          reason = answers.reason;
        }

        await withSpinner(
          'Rejecting proposal...',
          async () => api.post(`/api/ai/actions/proposals/${id}/reject`, { reason }),
          'Proposal rejected'
        );
      } catch (err) {
        handleError(err);
      }
    });

  autoApproval
    .command('execute <id>')
    .description('Execute an approved proposal')
    .action(async (id: string) => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Executing proposal...',
          async () => api.post(`/api/ai/actions/proposals/${id}/execute`, {}),
          'Execution started'
        );
      } catch (err) {
        handleError(err);
      }
    });
}

function printCircuitBreaker(cb: CircuitBreakerEntry): void {
  const stateIcon = cb.state === 'CLOSED' ? chalk.green('●') :
                   cb.state === 'OPEN' ? chalk.red('●') :
                   chalk.yellow('●');
  const label = cb.targetId ? `${cb.targetType}/${cb.targetId}` : cb.targetType;
  console.log(`    ${stateIcon} ${label} - ${cb.state} (failures: ${cb.failureCount})`);
  if (cb.lastFailureAt) {
    console.log(chalk.gray(`        Last failure: ${format(new Date(cb.lastFailureAt), 'yyyy-MM-dd HH:mm')}`));
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'PENDING': return chalk.yellow('○');
    case 'APPROVED': return chalk.blue('◐');
    case 'REJECTED': return chalk.red('✗');
    case 'EXECUTED': return chalk.green('✓');
    case 'FAILED': return chalk.red('✗');
    case 'EXPIRED': return chalk.gray('○');
    default: return chalk.gray('?');
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
