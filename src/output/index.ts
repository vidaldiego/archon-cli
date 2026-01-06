// Path: archon-cli/src/output/index.ts
// Output formatter router

import chalk from 'chalk';
import Table from 'cli-table3';

export type OutputFormat = 'json' | 'table' | 'text';

export interface OutputOptions {
  format: OutputFormat;
  color: boolean;
  quiet: boolean;
}

export interface TableConfig<T> {
  headers: string[];
  transform: (data: T) => (string | number)[][];
  colWidths?: number[];
}

// Global output options
let globalOptions: OutputOptions = {
  format: 'table',
  color: true,
  quiet: false
};

/**
 * Set global output options
 */
export function setOutputOptions(options: Partial<OutputOptions>): void {
  globalOptions = { ...globalOptions, ...options };

  // Disable chalk colors if requested
  if (!globalOptions.color) {
    chalk.level = 0;
  }
}

/**
 * Get current output options
 */
export function getOutputOptions(): OutputOptions {
  return globalOptions;
}

/**
 * Output data in the configured format
 */
export function output<T>(data: T, tableConfig?: TableConfig<T>): void {
  if (globalOptions.quiet) {
    return;
  }

  switch (globalOptions.format) {
    case 'json':
      outputJson(data);
      break;
    case 'table':
      if (tableConfig) {
        outputTable(data, tableConfig);
      } else {
        outputJson(data);
      }
      break;
    case 'text':
      outputText(data);
      break;
  }
}

/**
 * Output as JSON
 */
export function outputJson<T>(data: T): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Output as formatted table
 */
export function outputTable<T>(data: T, config: TableConfig<T>): void {
  const rows = config.transform(data);

  if (rows.length === 0) {
    console.log(chalk.gray('No data.'));
    return;
  }

  const tableOptions: {
    head: string[];
    style: { head: never[]; border: string[] };
    colWidths?: number[];
  } = {
    head: config.headers.map(h => chalk.cyan(h)),
    style: {
      head: [],
      border: ['gray']
    }
  };

  // Only add colWidths if it's defined
  if (config.colWidths) {
    tableOptions.colWidths = config.colWidths;
  }

  const table = new Table(tableOptions) as { push: (row: string[]) => void; toString: () => string };

  for (const row of rows) {
    const stringRow = row.map(cell => String(cell ?? ''));
    table.push(stringRow);
  }

  console.log(table.toString());
}

/**
 * Output as plain text
 */
export function outputText<T>(data: T): void {
  if (typeof data === 'string') {
    console.log(data);
  } else if (Array.isArray(data)) {
    data.forEach((item, index) => {
      console.log(`--- Item ${index + 1} ---`);
      outputTextObject(item);
      console.log();
    });
  } else if (typeof data === 'object' && data !== null) {
    outputTextObject(data);
  } else {
    console.log(String(data));
  }
}

/**
 * Output an object as text key-value pairs
 */
function outputTextObject(obj: unknown): void {
  if (typeof obj !== 'object' || obj === null) {
    console.log(String(obj));
    return;
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    console.log('(empty)');
    return;
  }

  const maxKeyLength = Math.max(...keys.map(k => k.length));

  for (const [key, value] of Object.entries(record)) {
    const paddedKey = key.padEnd(maxKeyLength);
    const formattedValue = typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
    console.log(`${chalk.gray(paddedKey)}  ${formattedValue}`);
  }
}

/**
 * Output a success message
 */
export function success(message: string): void {
  if (!globalOptions.quiet) {
    console.log(chalk.green('✓') + ' ' + message);
  }
}

/**
 * Output an error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗') + ' ' + message);
}

/**
 * Output a warning message
 */
export function warn(message: string): void {
  if (!globalOptions.quiet) {
    console.log(chalk.yellow('⚠') + ' ' + message);
  }
}

/**
 * Output an info message
 */
export function info(message: string): void {
  if (!globalOptions.quiet) {
    console.log(chalk.blue('ℹ') + ' ' + message);
  }
}

// Status badge helpers
export function statusBadge(status: string): string {
  switch (status.toUpperCase()) {
    case 'OK':
    case 'HEALTHY':
    case 'COMPLETED':
    case 'SUCCEEDED':
      return chalk.green(status);
    case 'WARN':
    case 'WARNING':
    case 'PENDING':
      return chalk.yellow(status);
    case 'CRIT':
    case 'CRITICAL':
    case 'FAILED':
    case 'ERROR':
      return chalk.red(status);
    case 'RUNNING':
    case 'IN_PROGRESS':
      return chalk.blue(status);
    case 'UNKNOWN':
    case 'SKIPPED':
      return chalk.gray(status);
    default:
      return status;
  }
}

export function roleBadge(role: string): string {
  switch (role.toUpperCase()) {
    case 'ADMIN':
      return chalk.red(role);
    case 'OPERATOR':
      return chalk.yellow(role);
    case 'VIEWER':
      return chalk.gray(role);
    case 'PRIMARY':
    case 'MASTER':
      return chalk.green(role);
    case 'SECONDARY':
    case 'REPLICA':
      return chalk.blue(role);
    default:
      return role;
  }
}
