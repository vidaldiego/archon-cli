// Path: archon-cli/tests/e2e.test.ts
// E2E tests for archon-cli against local server
// Run: ARCHON_URL=http://localhost:4080 npm test

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';

const CLI = './bin/archon';
const ENV = {
  ARCHON_URL: process.env.ARCHON_URL || 'http://localhost:4080',
  ARCHON_USER: process.env.ARCHON_USER || 'admin',
  ARCHON_PASS: process.env.ARCHON_PASS || 'Archon@2024',
  PATH: process.env.PATH,
};

function run(args: string, expectError = false): string {
  try {
    const result = execSync(`${CLI} ${args}`, {
      env: ENV,
      encoding: 'utf-8',
      timeout: 30000,
    });
    return result;
  } catch (error: any) {
    if (expectError) {
      return error.stdout || error.stderr || error.message;
    }
    throw new Error(`Command failed: ${CLI} ${args}\n${error.stderr || error.message}`);
  }
}

describe('archon-cli E2E', () => {
  beforeAll(() => {
    // Verify server is reachable
    try {
      run('raw GET /api/health');
    } catch {
      throw new Error(`Cannot reach server at ${ENV.ARCHON_URL}. Start backend first.`);
    }
  });

  describe('profile', () => {
    it('list profiles', () => {
      const output = run('profile list');
      expect(output).toContain('production');
    });

    it('show profile', () => {
      const output = run('profile show production');
      expect(output).toContain('archon.zincapp.com');
    });
  });

  describe('auth', () => {
    it('status shows authenticated', () => {
      const output = run('auth status');
      expect(output.toLowerCase()).toMatch(/authenticated|logged in|valid|token/i);
    });
  });

  describe('dashboard', () => {
    it('shows stats', () => {
      const output = run('dashboard');
      expect(output).toContain('Machines');
    });
  });

  describe('health', () => {
    it('shows backend health', () => {
      const output = run('health');
      expect(output.toLowerCase()).toMatch(/healthy|ok|up|status/i);
    });
  });

  describe('machines', () => {
    it('list machines', () => {
      const output = run('machines list');
      expect(output).toBeDefined();
    });
  });

  describe('services', () => {
    it('list services', () => {
      const output = run('services list');
      expect(output).toBeDefined();
    });
  });

  describe('service-types', () => {
    it('list service types', () => {
      const output = run('service-types');
      expect(output).toBeDefined();
    });
  });

  describe('updates', () => {
    it('list updates', () => {
      const output = run('updates list');
      expect(output).toBeDefined();
    });
  });

  describe('alerts', () => {
    it('list alerts', () => {
      const output = run('alerts list');
      expect(output).toBeDefined();
    });
  });

  describe('users', () => {
    it('list users', () => {
      const output = run('users list');
      expect(output).toBeDefined();
    });
  });

  describe('identities', () => {
    it('list identities', () => {
      const output = run('identities list');
      expect(output).toBeDefined();
    });
  });

  describe('auto-update', () => {
    it('show policy', () => {
      const output = run('auto-update policy');
      expect(output).toBeDefined();
    });

    it('list schedules', () => {
      const output = run('auto-update schedules');
      expect(output).toBeDefined();
    });
  });

  describe('auto-approval', () => {
    it('show policy', () => {
      const output = run('auto-approval policy');
      expect(output).toBeDefined();
    });

    it('list proposals', () => {
      const output = run('auto-approval proposals');
      expect(output).toBeDefined();
    });

    it('show stats', () => {
      const output = run('auto-approval stats');
      expect(output).toBeDefined();
    });
  });

  describe('ssh-keys', () => {
    it('list pending key changes', () => {
      const output = run('ssh-keys changes');
      expect(output).toBeDefined();
    });
  });

  describe('vcenters', () => {
    it('list vcenters', () => {
      const output = run('vcenters list');
      expect(output).toBeDefined();
    });
  });

  describe('logs', () => {
    it('show help', () => {
      const output = run('logs --help');
      expect(output).toContain('logs');
    });
  });

  describe('jobs', () => {
    it('show jobs stats', () => {
      const output = run('jobs stats');
      expect(output).toBeDefined();
    });

    it('show jobs timeline', () => {
      const output = run('jobs timeline');
      expect(output).toBeDefined();
    });
  });

  describe('raw', () => {
    it('GET /api/health', () => {
      const output = run('raw GET /api/health');
      expect(output).toBeDefined();
    });

    it('GET /api/dashboard returns data', () => {
      const output = run('raw GET /api/dashboard');
      expect(output).toContain('totalMachines');
    });
  });

  describe('exec', () => {
    it('show help', () => {
      const output = run('exec --help');
      expect(output).toContain('Execute');
    });
  });
});
