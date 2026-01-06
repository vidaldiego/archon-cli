// Path: archon-cli/src/commands/settings.ts
// Settings management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { SmtpConfig, NotificationPreferences } from '../api/types.js';
import { output, success, error } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

export function registerSettingsCommands(program: Command): void {
  const settings = program
    .command('settings')
    .description('Settings management');

  // SMTP subcommands
  const smtp = settings
    .command('smtp')
    .description('SMTP configuration');

  smtp
    .command('get')
    .description('Get SMTP configuration')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const config = await withSpinner<SmtpConfig>(
          'Fetching SMTP config...',
          async () => api.get<SmtpConfig>('/api/settings/smtp')
        );

        output({
          configured: config.configured,
          host: config.host || '-',
          port: config.port || '-',
          username: config.username || '-',
          fromEmail: config.fromEmail || '-',
          fromName: config.fromName || '-',
          useTls: config.useTls
        });
      } catch (err) {
        handleError(err);
      }
    });

  smtp
    .command('set')
    .description('Configure SMTP settings')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing config for defaults
        const existing = await api.get<SmtpConfig>('/api/settings/smtp');

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'host',
            message: 'SMTP host:',
            default: existing.host
          },
          {
            type: 'number',
            name: 'port',
            message: 'SMTP port:',
            default: existing.port || 587
          },
          {
            type: 'input',
            name: 'username',
            message: 'SMTP username:',
            default: existing.username
          },
          {
            type: 'password',
            name: 'password',
            message: 'SMTP password:',
            mask: '*'
          },
          {
            type: 'input',
            name: 'fromEmail',
            message: 'From email:',
            default: existing.fromEmail
          },
          {
            type: 'input',
            name: 'fromName',
            message: 'From name:',
            default: existing.fromName || 'ARCHON'
          },
          {
            type: 'confirm',
            name: 'useTls',
            message: 'Use TLS?',
            default: existing.useTls !== false
          }
        ]);

        await withSpinner(
          'Saving SMTP config...',
          async () => api.put('/api/settings/smtp', answers),
          'SMTP configuration saved'
        );
      } catch (err) {
        handleError(err);
      }
    });

  smtp
    .command('delete')
    .description('Delete SMTP configuration')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        await withSpinner(
          'Deleting SMTP config...',
          async () => api.delete('/api/settings/smtp'),
          'SMTP configuration deleted'
        );
      } catch (err) {
        handleError(err);
      }
    });

  smtp
    .command('test')
    .description('Send a test email')
    .option('-t, --to <email>', 'Recipient email address')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        let recipientEmail = options.to;

        if (!recipientEmail) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'recipientEmail',
              message: 'Send test email to:',
              validate: (input: string) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(input) || 'Invalid email address';
              }
            }
          ]);
          recipientEmail = answers.recipientEmail;
        }

        await withSpinner(
          'Sending test email...',
          async () => api.post('/api/settings/smtp/test', { recipientEmail }),
          'Test email sent'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Notifications subcommands
  const notifications = settings
    .command('notifications')
    .description('Notification preferences');

  notifications
    .command('get')
    .description('Get notification preferences')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const prefs = await withSpinner<NotificationPreferences>(
          'Fetching notification preferences...',
          async () => api.get<NotificationPreferences>('/api/settings/notifications')
        );

        output(prefs);
      } catch (err) {
        handleError(err);
      }
    });

  notifications
    .command('set')
    .description('Update notification preferences')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing prefs for defaults
        const existing = await api.get<NotificationPreferences>('/api/settings/notifications');

        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'healthAlerts',
            message: 'Receive health alerts?',
            default: existing.healthAlerts
          },
          {
            type: 'confirm',
            name: 'updateNotifications',
            message: 'Receive update notifications?',
            default: existing.updateNotifications
          },
          {
            type: 'confirm',
            name: 'digestEmails',
            message: 'Receive digest emails?',
            default: existing.digestEmails
          },
          {
            type: 'list',
            name: 'digestFrequency',
            message: 'Digest frequency:',
            choices: [
              { name: 'Immediate', value: 'IMMEDIATE' },
              { name: 'Hourly', value: 'HOURLY' },
              { name: 'Daily', value: 'DAILY' }
            ],
            default: existing.digestFrequency,
            when: (answers: { digestEmails: boolean }) => answers.digestEmails
          }
        ]);

        await withSpinner(
          'Saving notification preferences...',
          async () => api.put('/api/settings/notifications', answers),
          'Notification preferences saved'
        );
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
