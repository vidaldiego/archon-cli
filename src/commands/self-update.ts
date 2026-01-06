// Path: archon-cli/src/commands/self-update.ts
// Self-update command

import { Command } from 'commander';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { getCurrentVersion } from '../utils/version.js';
import { success, error } from '../output/index.js';

const PACKAGE_NAME = '@zincapp/archon-cli';

interface NpmVersionInfo {
  version: string;
  versions: string[];
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const data = await response.json() as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

function compareVersions(current: string, latest: string): number {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return 1;  // latest is newer
    if (c > l) return -1; // current is newer
  }
  return 0; // same version
}

export function registerSelfUpdateCommand(program: Command): void {
  program
    .command('self-update')
    .alias('upgrade')
    .description('Update archon CLI to the latest version')
    .option('--check', 'Only check for updates, do not install')
    .action(async (options) => {
      const currentVersion = getCurrentVersion();
      console.log(chalk.gray(`Current version: ${currentVersion}`));
      console.log(chalk.gray('Checking for updates...'));

      const latestVersion = await getLatestVersion();

      if (!latestVersion) {
        error('Failed to check for updates. Please try again later.');
        process.exit(1);
      }

      const comparison = compareVersions(currentVersion, latestVersion);

      if (comparison <= 0) {
        success(`You are already on the latest version (${currentVersion})`);
        return;
      }

      console.log(chalk.yellow(`\nUpdate available: ${currentVersion} → ${latestVersion}`));

      if (options.check) {
        console.log(chalk.gray(`\nRun 'archon self-update' to install the update`));
        return;
      }

      console.log(chalk.gray('\nInstalling update...'));

      try {
        // Detect package manager and install location
        const npmRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
        const usesSudo = npmRoot.startsWith('/usr/local') || npmRoot.startsWith('/usr/lib');

        const installCmd = usesSudo
          ? `sudo npm install -g ${PACKAGE_NAME}@latest`
          : `npm install -g ${PACKAGE_NAME}@latest`;

        console.log(chalk.gray(`Running: ${installCmd}`));

        execSync(installCmd, {
          stdio: 'inherit',
          encoding: 'utf-8'
        });

        console.log();
        success(`Successfully updated to v${latestVersion}`);
      } catch (err) {
        console.log();
        error('Failed to install update');
        console.log(chalk.gray(`\nTry manually: npm install -g ${PACKAGE_NAME}@latest`));
        process.exit(1);
      }
    });
}
