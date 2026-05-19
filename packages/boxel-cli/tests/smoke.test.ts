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

  it('silences chatty console.log output in a real command path under --quiet', () => {
    // End-to-end: run a command that, on success, emits a `console.log`
    // line ("✓ Profile created: …" — see profile.ts). With `--quiet`
    // that line must be silenced, and the command's side-effect (the
    // profile.json file) must still happen. This proves the interceptor
    // is wired through the full CLI startup path, not just the unit
    // tests in cli-log.test.ts.
    let tmpHome = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-quiet-'));
    try {
      let stdout = execFileSync(
        process.execPath,
        [cliEntry, '--quiet', 'profile', 'add', '-u', '@alice:stack.cards'],
        {
          encoding: 'utf8',
          env: {
            // Strip BOXEL_* from inherited env so a developer's shell
            // can't perturb the result.
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([k]) => !k.startsWith('BOXEL_'),
              ),
            ),
            HOME: tmpHome,
            BOXEL_PASSWORD: 'hunter2',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      // The success message ("✓ Profile created: …") goes through
      // console.log; under --quiet the interceptor must swallow it.
      expect(stdout).toBe('');

      // Side-effect must still have happened.
      expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
        true,
      );
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('emits the same console.log output normally without --quiet', () => {
    // Negative control for the test above: without --quiet, the same
    // command emits the success line to stdout. Without this, the
    // --quiet test could trivially pass against a build that printed
    // nothing in either mode.
    let tmpHome = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-noisy-'));
    try {
      let stdout = execFileSync(
        process.execPath,
        [cliEntry, 'profile', 'add', '-u', '@alice:stack.cards'],
        {
          encoding: 'utf8',
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([k]) => !k.startsWith('BOXEL_'),
              ),
            ),
            HOME: tmpHome,
            BOXEL_PASSWORD: 'hunter2',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      expect(stdout).toMatch(/Profile created/);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

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

  const readProfiles = () =>
    JSON.parse(
      fs.readFileSync(join(tmpHome, '.boxel-cli', 'profiles.json'), 'utf8'),
    );

  it('creates a profile for a standard domain without URL flags', () => {
    run(['-u', '@alice:stack.cards']);

    const config = readProfiles();
    expect(config.profiles['@alice:stack.cards']).toMatchObject({
      matrixUrl: 'https://matrix-staging.stack.cards',
      realmServerUrl: 'https://realms-staging.stack.cards/',
    });
  });

  it('creates a profile for a non-standard domain with URL flags', () => {
    run([
      '-u',
      '@alice:my.server',
      '-m',
      'https://matrix.my.server',
      '-r',
      'https://realms.my.server/',
    ]);

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
      password: 'hunter2',
    });
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

  it('trims whitespace from URL flag values', () => {
    run([
      '-u',
      '@alice:my.server',
      '-m',
      '  https://matrix.my.server  ',
      '-r',
      '  https://realms.my.server/  ',
    ]);

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
    });
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

  it('derives URLs from the BOXEL_ENVIRONMENT slug', () => {
    run(['-u', '@alice:cs-10998-foo.localhost'], {
      BOXEL_ENVIRONMENT: 'cs-10998-foo',
    });

    const config = readProfiles();
    expect(config.profiles['@alice:cs-10998-foo.localhost']).toMatchObject({
      matrixUrl: 'http://matrix.cs-10998-foo.localhost',
      realmServerUrl: 'http://realm-server.cs-10998-foo.localhost/',
    });
  });

  it('slugifies BOXEL_ENVIRONMENT like env-slug.sh (case, /, special chars)', () => {
    // 'My/Branch_Name!' → lowercase 'my/branch_name!' → '/' becomes '-' →
    // '_' and '!' are stripped (not in [a-z0-9-]) → 'my-branchname'.
    run(['-u', '@alice:my-branchname.localhost'], {
      BOXEL_ENVIRONMENT: 'My/Branch_Name!',
    });

    const config = readProfiles();
    expect(config.profiles['@alice:my-branchname.localhost']).toMatchObject({
      matrixUrl: 'http://matrix.my-branchname.localhost',
      realmServerUrl: 'http://realm-server.my-branchname.localhost/',
    });
  });

  it('lets --matrix-url and --realm-server-url override BOXEL_ENVIRONMENT', () => {
    run(
      [
        '-u',
        '@alice:my.server',
        '-m',
        'https://matrix.my.server',
        '-r',
        'https://realms.my.server/',
      ],
      { BOXEL_ENVIRONMENT: 'cs-10998-foo' },
    );

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
    });
  });

  it('ignores an invalid BOXEL_ENVIRONMENT when both URL flags are supplied', () => {
    // If both URLs are explicit, BOXEL_ENVIRONMENT is never consulted,
    // so even a value that would normally exit 1 (slugifies to empty)
    // must not block the command.
    run(
      [
        '-u',
        '@alice:my.server',
        '-m',
        'https://matrix.my.server',
        '-r',
        'https://realms.my.server/',
      ],
      { BOXEL_ENVIRONMENT: '!!!' },
    );

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
    });
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

  it('updates stored URLs when re-adding an existing profile with new URL flags', () => {
    run([
      '-u',
      '@alice:my.server',
      '-m',
      'https://matrix.old.server',
      '-r',
      'https://realms.old.server/',
    ]);

    run([
      '-u',
      '@alice:my.server',
      '-m',
      'https://matrix.new.server',
      '-r',
      'https://realms.new.server/',
    ]);

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.new.server',
      realmServerUrl: 'https://realms.new.server/',
    });
  });

  it('ignores BOXEL_ENVIRONMENT when the Matrix ID has a known standard domain', () => {
    // The Matrix ID's domain is authoritative for known standards
    // (stack.cards / boxel.ai / localhost). Even an *invalid* env value
    // (which would otherwise exit 1) must not affect this path — the
    // resulting profile points at staging, not at env-derived URLs.
    run(['-u', '@alice:stack.cards'], { BOXEL_ENVIRONMENT: '!!!' });

    const config = readProfiles();
    expect(config.profiles['@alice:stack.cards']).toMatchObject({
      matrixUrl: 'https://matrix-staging.stack.cards',
      realmServerUrl: 'https://realms-staging.stack.cards/',
    });
  });
});
