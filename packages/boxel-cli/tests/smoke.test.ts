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
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
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

    expect(
      fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json')),
    ).toBe(false);
  });

  it('derives URLs from BOXEL_ENVIRONMENT when no URL flags are given', () => {
    run(['-u', '@alice:my.server'], { BOXEL_ENVIRONMENT: 'production' });

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.boxel.ai',
      realmServerUrl: 'https://app.boxel.ai/',
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
      { BOXEL_ENVIRONMENT: 'production' },
    );

    const config = readProfiles();
    expect(config.profiles['@alice:my.server']).toMatchObject({
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
    });
  });

  it('exits 1 on an unknown BOXEL_ENVIRONMENT value', () => {
    try {
      run(['-u', '@alice:stack.cards'], { BOXEL_ENVIRONMENT: 'bogus' });
      throw new Error('expected command to exit non-zero');
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(1);
      expect(e.stderr).toMatch(/Unknown BOXEL_ENVIRONMENT/);
      expect(e.stderr).toMatch(/staging/);
      expect(e.stderr).toMatch(/production/);
      expect(e.stderr).toMatch(/local/);
    }

    expect(
      fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json')),
    ).toBe(false);
  });
});
