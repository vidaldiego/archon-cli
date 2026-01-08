// Path: archon-cli/src/utils/errors.ts
// Error handling utilities

import chalk from 'chalk';
import { ApiError } from '../api/client.js';

/**
 * Handle and display errors
 */
export function handleError(err: unknown): never {
  if (isApiError(err)) {
    handleApiError(err);
  } else if (err instanceof Error) {
    console.error(chalk.red('Error:'), err.message);
    if (process.env.DEBUG) {
      console.error(chalk.gray(err.stack || ''));
    }
  } else {
    console.error(chalk.red('Error:'), String(err));
  }

  process.exit(1);
}

/**
 * Check if error is an API error
 */
function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    'message' in err
  );
}

/**
 * Handle API errors with helpful messages
 */
function handleApiError(err: ApiError): void {
  switch (err.status) {
    case 401:
      // Check if this is a token expiration issue
      if (err.message?.toLowerCase().includes('expired') ||
          err.message?.toLowerCase().includes('invalid token')) {
        console.error(chalk.red('Session expired.'));
        console.error(chalk.gray('Your authentication token has expired.'));
      } else {
        console.error(chalk.red('Authentication required.'));
      }
      console.error(chalk.gray('Run: archon auth login'));
      break;

    case 403:
      console.error(chalk.red('Permission denied.'));
      console.error(chalk.gray('This action requires admin or operator privileges.'));
      break;

    case 404:
      console.error(chalk.red('Not found:'), err.message);
      break;

    case 409:
      console.error(chalk.red('Conflict:'), err.message);
      break;

    case 422:
      console.error(chalk.red('Validation error:'), err.message);
      if (err.details) {
        console.error(chalk.gray(JSON.stringify(err.details, null, 2)));
      }
      break;

    case 500:
      console.error(chalk.red('Server error:'), err.message);
      console.error(chalk.gray('The server encountered an internal error. Please try again later.'));
      break;

    default:
      console.error(chalk.red(`Error (${err.status}):`), err.message);
      if (err.error) {
        console.error(chalk.gray(err.error));
      }
  }
}

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<void>>(
  fn: T
): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>) => {
    try {
      await fn(...args);
    } catch (err) {
      handleError(err);
    }
  };
}
