// Path: archon-cli/src/utils/spinner.ts
// Spinner utilities for async operations

import ora, { Ora } from 'ora';
import { getOutputOptions } from '../output/index.js';

/**
 * Create a spinner that respects quiet mode and JSON output
 */
export function createSpinner(text: string): Ora {
  const options = getOutputOptions();

  // Don't show spinner for JSON output or quiet mode
  if (options.format === 'json' || options.quiet) {
    // Return a no-op spinner
    return {
      start: () => ora(),
      stop: () => ora(),
      succeed: () => ora(),
      fail: () => ora(),
      warn: () => ora(),
      info: () => ora(),
      stopAndPersist: () => ora(),
      clear: () => ora(),
      render: () => ora(),
      frame: () => '',
      text: '',
      color: 'cyan',
      indent: 0,
      interval: 100,
      spinner: { frames: [], interval: 100 },
      isSpinning: false,
      prefixText: ''
    } as unknown as Ora;
  }

  return ora({
    text,
    color: 'cyan'
  });
}

/**
 * Run an async function with a spinner
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  successText?: string
): Promise<T> {
  const spinner = createSpinner(text).start();

  try {
    const result = await fn();
    spinner.succeed(successText || text);
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
