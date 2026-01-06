// Path: archon-cli/src/index.ts
// Main entry point for ARCHON CLI

import { Command } from 'commander';
import chalk from 'chalk';
import { setOutputOptions, OutputFormat } from './output/index.js';
import { setActiveProfile, getActiveProfileName, getActiveProfile } from './config/index.js';
import { getCurrentVersion, startUpdateCheck, showUpdateNotice } from './utils/version.js';

// Import command registrations
import { registerProfileCommands } from './commands/profile.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerDashboardCommands } from './commands/dashboard.js';
import { registerMachineCommands } from './commands/machines.js';
import { registerServiceCommands } from './commands/services.js';
import { registerUpdateCommands } from './commands/updates.js';
import { registerAlertCommands } from './commands/alerts.js';
import { registerSettingsCommands } from './commands/settings.js';
import { registerUserCommands } from './commands/users.js';
import { registerIdentityCommands } from './commands/identities.js';
import { registerAutoUpdateCommands } from './commands/auto-update.js';
import { registerAutoApprovalCommands } from './commands/auto-approval.js';
import { registerSshKeyCommands } from './commands/ssh-keys.js';
import { registerVCenterCommands } from './commands/vcenters.js';
import { registerKnowledgeCommands } from './commands/knowledge.js';
import { registerLogCommands } from './commands/logs.js';
import { registerJobCommands } from './commands/jobs.js';
import { registerRawCommand } from './commands/raw.js';
import { registerExecCommands } from './commands/exec.js';
import { registerSelfUpdateCommand } from './commands/self-update.js';
import { registerSshCommands } from './commands/ssh.js';

const program = new Command();
const version = getCurrentVersion();

// Start background update check early
startUpdateCheck();

program
  .name('archon')
  .description('ARCHON Infrastructure Management CLI')
  .version(version)
  .option('-p, --profile <name>', 'Use specific profile')
  .option('--json', 'Output as JSON')
  .option('--table', 'Output as table (default for lists)')
  .option('--text', 'Output as plain text')
  .option('--no-color', 'Disable colored output')
  .option('-q, --quiet', 'Minimal output')
  .option('--debug', 'Show debug info')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    // Handle profile selection (env var takes precedence over flag)
    const profileName = process.env.ARCHON_PROFILE || opts.profile;
    if (profileName) {
      try {
        setActiveProfile(profileName);
      } catch (err) {
        console.error(chalk.red(`Profile '${profileName}' not found.`));
        console.error(chalk.gray('Run: archon profile list'));
        process.exit(1);
      }
    }

    // Handle output format
    let format: OutputFormat = 'table';
    if (opts.json) format = 'json';
    else if (opts.text) format = 'text';

    setOutputOptions({
      format,
      color: opts.color !== false,
      quiet: opts.quiet || false
    });

    // Show version header with profile info (unless quiet mode)
    if (!opts.quiet) {
      const activeProfile = getActiveProfileName();
      const profile = getActiveProfile();
      const profileDisplay = profile.name || activeProfile;
      console.error(chalk.gray(`archon v${version} • ${profileDisplay} (${profile.url})`));
    }

    // Debug info
    if (opts.debug) {
      console.error(chalk.gray(`Output: ${format}`));
    }
  })
  .hook('postAction', async () => {
    // Show update notice after command completes
    await showUpdateNotice();
  });

// Register all commands
registerProfileCommands(program);
registerAuthCommands(program);
registerDashboardCommands(program);
registerMachineCommands(program);
registerServiceCommands(program);
registerUpdateCommands(program);
registerAlertCommands(program);
registerSettingsCommands(program);
registerUserCommands(program);
registerIdentityCommands(program);
registerAutoUpdateCommands(program);
registerAutoApprovalCommands(program);
registerSshKeyCommands(program);
registerVCenterCommands(program);
registerKnowledgeCommands(program);
registerLogCommands(program);
registerJobCommands(program);
registerExecCommands(program);
registerRawCommand(program);
registerSelfUpdateCommand(program);
registerSshCommands(program);

// Parse arguments
program.parse();
