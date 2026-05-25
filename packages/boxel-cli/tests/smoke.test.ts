import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { resolve, join } from 'path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

const cliEntry = resolve(__dirname, '../dist/index.js');

describe('boxel-cli', () => {
  it('prints help output', () => {
    const output = execFileSync(process.execPath, [cliEntry, '--help'], {
      encoding: 'utf8',
    });
    expect(output).toMatch(/Usage:/);
    expect(output).toMatch(/Options:/);
  });

  it('prints version', () => {
    const output = execFileSync(process.execPath, [cliEntry, '--version'], {
      encoding: 'utf8',
    });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('exposes a global --quiet flag in --help', () => {
    const output = execFileSync(process.execPath, [cliEntry, '--help'], {
      encoding: 'utf8',
    });
    expect(output).toMatch(/-q, --quiet/);
  });
});

// Smoke tests below only exercise paths that fail before any Matrix call —
// argument validation, env-var sanitization, and "unknown domain" guards.
// Happy-path `profile add` flows (which now require a real matrixLogin
// after CS-10725) live in tests/integration/profile-add.test.ts, where a
// real Synapse + realm-server is available.
describe('boxel profile add (non-interactive)', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-smoke-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // Strip BOXEL_* from the inherited env so a developer's shell (e.g. one
  // with BOXEL_ENVIRONMENT set for mise-tasks) can't change test behavior.
  // Tests that exercise these vars opt in via extraEnv.
  const sanitizedParentEnv = () =>
    Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('BOXEL_')),
    );

  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    execFileSync(process.execPath, [cliEntry, 'profile', 'add', ...args], {
      encoding: 'utf8',
      env: {
        ...sanitizedParentEnv(),
        HOME: tmpHome,
        BOXEL_PASSWORD: 'hunter2',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('exits 1 when --matrix-url is not a parseable URL', () => {
    try {
      run([
        '-u',
        '@alice:my.server',
        '-m',
        'matrix-url',
        '-r',
        'https://realms.my.server/',
      ]);
      throw new Error('expected command to exit non-zero');
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(1);
      expect(e.stderr).toMatch(/--matrix-url "matrix-url" is not a valid URL/);
    }
  });

  it('exits 1 when --realm-server-url uses a non-http(s) scheme', () => {
    try {
      run([
        '-u',
        '@alice:my.server',
        '-m',
        'https://matrix.my.server',
        '-r',
        'file:///etc/passwd',
      ]);
      throw new Error('expected command to exit non-zero');
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(1);
      expect(e.stderr).toMatch(
        /--realm-server-url "file:\/\/\/etc\/passwd" must use http:\/\/ or https:\/\//,
      );
    }
  });

  it("does not let the parent process's BOXEL_ENVIRONMENT leak into the child", () => {
    // A developer running the suite with BOXEL_ENVIRONMENT set in their
    // shell should see the same behavior as CI. We simulate that by
    // setting it on this process's env, then assert the child still
    // exits with the "Unknown domain" error rather than silently
    // deriving URLs from the leaked value.
    const previous = process.env.BOXEL_ENVIRONMENT;
    process.env.BOXEL_ENVIRONMENT = 'leaked-from-shell';
    try {
      try {
        run(['-u', '@alice:my.server']);
        throw new Error('expected command to exit non-zero');
      } catch (err) {
        const e = err as { status?: number; stderr?: string };
        expect(e.status).toBe(1);
        expect(e.stderr).toMatch(/Unknown domain/);
      }
    } finally {
      if (previous === undefined) {
        delete process.env.BOXEL_ENVIRONMENT;
      } else {
        process.env.BOXEL_ENVIRONMENT = previous;
      }
    }
  });

  it('exits 1 with a clear error for a non-standard domain without URL flags', () => {
    try {
      run(['-u', '@alice:my.server']);
      throw new Error('expected command to exit non-zero');
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(1);
      expect(e.stderr).toMatch(/Unknown domain/);
      expect(e.stderr).toMatch(/--matrix-url/);
      expect(e.stderr).toMatch(/--realm-server-url/);
    }

    expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
      false,
    );
  });

  it('exits 1 when BOXEL_ENVIRONMENT slugifies to empty (and is actually consulted)', () => {
    // Use a non-standard domain so BOXEL_ENVIRONMENT is consulted; a
    // standard domain like @alice:stack.cards bypasses the env var entirely.
    try {
      run(['-u', '@alice:my.server'], { BOXEL_ENVIRONMENT: '!!!' });
      throw new Error('expected command to exit non-zero');
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(1);
      expect(e.stderr).toMatch(/BOXEL_ENVIRONMENT="!!!"/);
      expect(e.stderr).toMatch(/no slug characters/);
    }

    expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
      false,
    );
  });
});
