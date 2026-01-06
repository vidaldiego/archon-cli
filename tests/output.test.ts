// Tests for output/index.ts - Output formatters

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock chalk to return plain strings for testing
vi.mock('chalk', () => ({
  default: {
    green: (s: string) => `[green]${s}[/green]`,
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
    red: (s: string) => `[red]${s}[/red]`,
    blue: (s: string) => `[blue]${s}[/blue]`,
    gray: (s: string) => `[gray]${s}[/gray]`,
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
    white: (s: string) => `[white]${s}[/white]`,
    bold: (s: string) => `[bold]${s}[/bold]`,
    level: 3
  }
}));

const {
  setOutputOptions,
  getOutputOptions,
  output,
  outputJson,
  outputText,
  success,
  error,
  warn,
  info,
  statusBadge,
  roleBadge
} = await import('../src/output/index.js');

describe('Output Module', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset to defaults
    setOutputOptions({ format: 'table', color: true, quiet: false });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Output Options', () => {
    describe('setOutputOptions / getOutputOptions', () => {
      it('should set and get output options', () => {
        setOutputOptions({ format: 'json', quiet: true });

        const options = getOutputOptions();

        expect(options.format).toBe('json');
        expect(options.quiet).toBe(true);
      });

      it('should merge with existing options', () => {
        setOutputOptions({ format: 'json' });
        setOutputOptions({ quiet: true });

        const options = getOutputOptions();

        expect(options.format).toBe('json');
        expect(options.quiet).toBe(true);
      });
    });
  });

  describe('Output Functions', () => {
    describe('outputJson', () => {
      it('should output JSON formatted data', () => {
        const data = { name: 'test', value: 123 };

        outputJson(data);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          JSON.stringify(data, null, 2)
        );
      });

      it('should handle arrays', () => {
        const data = [{ id: 1 }, { id: 2 }];

        outputJson(data);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          JSON.stringify(data, null, 2)
        );
      });
    });

    describe('outputText', () => {
      it('should output string directly', () => {
        outputText('Hello World');

        expect(consoleLogSpy).toHaveBeenCalledWith('Hello World');
      });

      it('should output object as key-value pairs', () => {
        const data = { name: 'test', value: 123 };

        outputText(data);

        expect(consoleLogSpy).toHaveBeenCalled();
      });

      it('should output arrays with item labels', () => {
        const data = [{ name: 'first' }, { name: 'second' }];

        outputText(data);

        expect(consoleLogSpy).toHaveBeenCalled();
      });
    });

    describe('output', () => {
      it('should output JSON when format is json', () => {
        setOutputOptions({ format: 'json' });
        const data = { test: true };

        output(data);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          JSON.stringify(data, null, 2)
        );
      });

      it('should output text when format is text', () => {
        setOutputOptions({ format: 'text' });

        output('test string');

        expect(consoleLogSpy).toHaveBeenCalledWith('test string');
      });

      it('should not output when quiet is true', () => {
        setOutputOptions({ quiet: true });

        output({ test: true });

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('Message Functions', () => {
    describe('success', () => {
      it('should output success message with checkmark', () => {
        success('Operation completed');

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Operation completed')
        );
      });

      it('should not output when quiet is true', () => {
        setOutputOptions({ quiet: true });

        success('Operation completed');

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });

    describe('error', () => {
      it('should output error message with x mark', () => {
        error('Something failed');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Something failed')
        );
      });

      it('should always output even when quiet', () => {
        setOutputOptions({ quiet: true });

        error('Something failed');

        expect(consoleErrorSpy).toHaveBeenCalled();
      });
    });

    describe('warn', () => {
      it('should output warning message', () => {
        warn('This is a warning');

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('This is a warning')
        );
      });

      it('should not output when quiet is true', () => {
        setOutputOptions({ quiet: true });

        warn('This is a warning');

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });

    describe('info', () => {
      it('should output info message', () => {
        info('Information');

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Information')
        );
      });

      it('should not output when quiet is true', () => {
        setOutputOptions({ quiet: true });

        info('Information');

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('Badge Functions', () => {
    describe('statusBadge', () => {
      it('should return green for OK status', () => {
        const badge = statusBadge('OK');
        expect(badge).toContain('green');
      });

      it('should return green for HEALTHY status', () => {
        const badge = statusBadge('HEALTHY');
        expect(badge).toContain('green');
      });

      it('should return green for COMPLETED status', () => {
        const badge = statusBadge('COMPLETED');
        expect(badge).toContain('green');
      });

      it('should return yellow for WARN status', () => {
        const badge = statusBadge('WARN');
        expect(badge).toContain('yellow');
      });

      it('should return yellow for PENDING status', () => {
        const badge = statusBadge('PENDING');
        expect(badge).toContain('yellow');
      });

      it('should return red for CRIT status', () => {
        const badge = statusBadge('CRIT');
        expect(badge).toContain('red');
      });

      it('should return red for FAILED status', () => {
        const badge = statusBadge('FAILED');
        expect(badge).toContain('red');
      });

      it('should return blue for RUNNING status', () => {
        const badge = statusBadge('RUNNING');
        expect(badge).toContain('blue');
      });

      it('should return gray for UNKNOWN status', () => {
        const badge = statusBadge('UNKNOWN');
        expect(badge).toContain('gray');
      });

      it('should handle lowercase status', () => {
        const badge = statusBadge('ok');
        expect(badge).toContain('green');
      });

      it('should return unformatted for unknown status', () => {
        const badge = statusBadge('CUSTOM');
        expect(badge).toBe('CUSTOM');
      });
    });

    describe('roleBadge', () => {
      it('should return red for ADMIN role', () => {
        const badge = roleBadge('ADMIN');
        expect(badge).toContain('red');
      });

      it('should return yellow for OPERATOR role', () => {
        const badge = roleBadge('OPERATOR');
        expect(badge).toContain('yellow');
      });

      it('should return gray for VIEWER role', () => {
        const badge = roleBadge('VIEWER');
        expect(badge).toContain('gray');
      });

      it('should return green for PRIMARY role', () => {
        const badge = roleBadge('PRIMARY');
        expect(badge).toContain('green');
      });

      it('should return green for MASTER role', () => {
        const badge = roleBadge('MASTER');
        expect(badge).toContain('green');
      });

      it('should return blue for SECONDARY role', () => {
        const badge = roleBadge('SECONDARY');
        expect(badge).toContain('blue');
      });

      it('should return blue for REPLICA role', () => {
        const badge = roleBadge('REPLICA');
        expect(badge).toContain('blue');
      });

      it('should handle lowercase role', () => {
        const badge = roleBadge('admin');
        expect(badge).toContain('red');
      });

      it('should return unformatted for unknown role', () => {
        const badge = roleBadge('CUSTOM');
        expect(badge).toBe('CUSTOM');
      });
    });
  });
});
