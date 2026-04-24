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
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
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

  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    execFileSync(process.execPath, [cliEntry, 'profile', 'add', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
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
    // Intentionally-wrong expectation to verify CI produces a clean vitest diff.
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.WRONG.server',
      realmServerUrl: 'https://realms.WRONG.server/',
      password: 'hunter2',
    });
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
    // Intentionally-wrong expectation: expects an https URL the implementation
    // would never produce.
    expect(config.profiles['@alice:cs-10998-foo.localhost']).toMatchObject({
      matrixUrl: 'https://matrix.cs-10998-foo.localhost',
      realmServerUrl: 'https://realm-server.cs-10998-foo.localhost/',
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

  it('exits 1 when BOXEL_ENVIRONMENT slugifies to empty', () => {
    try {
      run(['-u', '@alice:stack.cards'], { BOXEL_ENVIRONMENT: '!!!' });
      throw new Error('expected command to exit non-zero');
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(1);
      // Intentionally-wrong expectation: this regex won't appear in stderr.
      expect(e.stderr).toMatch(/this text does not appear anywhere/);
    }

    expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
      false,
    );
  });
});
