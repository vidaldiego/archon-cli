// Path: archon-cli/src/commands/profile.ts
// Profile management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  getProfiles,
  setProfile,
  deleteProfile,
  setDefaultProfile,
  getActiveProfileName,
  Profile
} from '../config/index.js';
import { deleteTokens } from '../config/tokens.js';
import { output, success, error, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';

interface ProfileListItem {
  name: string;
  displayName: string;
  url: string;
  insecure: boolean;
  active: boolean;
}

const profileTableConfig: TableConfig<ProfileListItem[]> = {
  headers: ['', 'Name', 'Display Name', 'URL', 'Insecure'],
  transform: (profiles) =>
    profiles.map(p => [
      p.active ? chalk.green('●') : ' ',
      p.name,
      p.displayName,
      p.url,
      p.insecure ? chalk.yellow('Yes') : '-'
    ])
};

export function registerProfileCommands(program: Command): void {
  const profile = program
    .command('profile')
    .description('Manage connection profiles');

  // List profiles
  profile
    .command('list')
    .description('List all profiles')
    .action(() => {
      try {
        const profiles = getProfiles();
        const activeProfile = getActiveProfileName();

        const items: ProfileListItem[] = Object.entries(profiles).map(([name, p]) => ({
          name,
          displayName: p.name,
          url: p.url,
          insecure: p.insecure || false,
          active: name === activeProfile
        }));

        output(items, profileTableConfig);
      } catch (err) {
        handleError(err);
      }
    });

  // Create profile (new command name, with --use option)
  profile
    .command('create <name>')
    .description('Create a new profile')
    .option('-u, --url <url>', 'API URL (required)')
    .option('-n, --display-name <name>', 'Display name')
    .option('-k, --insecure', 'Allow insecure TLS connections')
    .option('--use', 'Set as active profile after creation')
    .action(async (name, options) => {
      try {
        const profiles = getProfiles();

        if (profiles[name]) {
          error(`Profile '${name}' already exists. Use 'archon profile update' to modify it.`);
          process.exit(1);
        }

        let url = options.url;
        let displayName = options.displayName;

        // Interactive mode if URL not provided
        if (!url) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'url',
              message: 'API URL:',
              validate: (input: string) => {
                if (!input) return 'URL is required';
                if (!input.startsWith('http://') && !input.startsWith('https://')) {
                  return 'URL must start with http:// or https://';
                }
                return true;
              }
            },
            {
              type: 'input',
              name: 'displayName',
              message: 'Display name:',
              default: name.charAt(0).toUpperCase() + name.slice(1),
              when: !displayName
            }
          ]);

          url = answers.url;
          displayName = displayName || answers.displayName;
        }

        if (!displayName) {
          displayName = name.charAt(0).toUpperCase() + name.slice(1);
        }

        const newProfile: Profile = {
          name: displayName,
          url,
          insecure: options.insecure || false
        };

        setProfile(name, newProfile);
        success(`Profile '${name}' created.`);

        // Set as active if --use flag provided
        if (options.use) {
          setDefaultProfile(name);
          success(`Now using profile '${name}'.`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Add profile (alias for create, for backwards compatibility)
  profile
    .command('add <name>')
    .description('Add a new profile (alias for create)')
    .option('-u, --url <url>', 'API URL')
    .option('-n, --display-name <name>', 'Display name')
    .option('-k, --insecure', 'Allow insecure TLS connections')
    .option('--use', 'Set as active profile after creation')
    .action(async (name, options) => {
      // Delegate to create command logic
      try {
        const profiles = getProfiles();

        if (profiles[name]) {
          error(`Profile '${name}' already exists. Use 'archon profile update' to modify it.`);
          process.exit(1);
        }

        let url = options.url;
        let displayName = options.displayName;

        if (!url) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'url',
              message: 'API URL:',
              validate: (input: string) => {
                if (!input) return 'URL is required';
                if (!input.startsWith('http://') && !input.startsWith('https://')) {
                  return 'URL must start with http:// or https://';
                }
                return true;
              }
            },
            {
              type: 'input',
              name: 'displayName',
              message: 'Display name:',
              default: name.charAt(0).toUpperCase() + name.slice(1),
              when: !displayName
            }
          ]);

          url = answers.url;
          displayName = displayName || answers.displayName;
        }

        if (!displayName) {
          displayName = name.charAt(0).toUpperCase() + name.slice(1);
        }

        const newProfile: Profile = {
          name: displayName,
          url,
          insecure: options.insecure || false
        };

        setProfile(name, newProfile);
        success(`Profile '${name}' created.`);

        if (options.use) {
          setDefaultProfile(name);
          success(`Now using profile '${name}'.`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Show profile
  profile
    .command('show [name]')
    .description('Show profile details')
    .action((name) => {
      try {
        const profileName = name || getActiveProfileName();
        const profiles = getProfiles();
        const p = profiles[profileName];

        if (!p) {
          error(`Profile '${profileName}' not found.`);
          process.exit(1);
        }

        output({
          name: profileName,
          displayName: p.name,
          url: p.url,
          insecure: p.insecure || false,
          active: profileName === getActiveProfileName()
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Use profile (set as default)
  profile
    .command('use <name>')
    .description('Set the default profile')
    .action((name) => {
      try {
        setDefaultProfile(name);
        success(`Now using profile '${name}'.`);
      } catch (err) {
        handleError(err);
      }
    });

  // Delete profile
  profile
    .command('delete <name>')
    .description('Delete a profile')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name, options) => {
      try {
        const profiles = getProfiles();

        if (!profiles[name]) {
          error(`Profile '${name}' not found.`);
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete profile '${name}' and its saved credentials?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        // Delete tokens for this profile
        deleteTokens(name);

        // Delete the profile
        if (deleteProfile(name)) {
          success(`Profile '${name}' deleted.`);
        } else {
          error(`Failed to delete profile '${name}'.`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Update profile
  profile
    .command('update <name>')
    .description('Update a profile')
    .option('-u, --url <url>', 'API URL')
    .option('-n, --display-name <name>', 'Display name')
    .option('-k, --insecure', 'Allow insecure TLS connections')
    .option('--no-insecure', 'Require secure TLS connections')
    .action((name, options) => {
      try {
        const profiles = getProfiles();
        const existing = profiles[name];

        if (!existing) {
          error(`Profile '${name}' not found.`);
          process.exit(1);
        }

        const updated: Profile = {
          name: options.displayName || existing.name,
          url: options.url || existing.url,
          insecure: options.insecure !== undefined ? options.insecure : existing.insecure
        };

        setProfile(name, updated);
        success(`Profile '${name}' updated.`);
      } catch (err) {
        handleError(err);
      }
    });
}
