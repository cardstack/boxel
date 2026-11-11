import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { ProfileManager } from '../src/lib/profile-manager.ts';
import { runBoxel } from './helpers/run-boxel.ts';

describe('boxel-cli', () => {
  it('prints help output', async () => {
    let res = await runBoxel(['--help']);
    expect(res.ok).toBe(true);
    expect(res.stdout).toMatch(/Usage:/);
    expect(res.stdout).toMatch(/Options:/);
  });

  it('prints version', async () => {
    let res = await runBoxel(['--version']);
    expect(res.ok).toBe(true);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('exposes a global --quiet flag in --help', async () => {
    let res = await runBoxel(['--help']);
    expect(res.stdout).toMatch(/-q, --quiet/);
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

  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    runBoxel(['profile', 'add', ...args], {
      home: tmpHome,
      env: { BOXEL_PASSWORD: 'hunter2', ...extraEnv },
    });

  it('exits 1 when --matrix-url is not a parseable URL', async () => {
    let res = await run([
      '-u',
      '@alice:my.server',
      '-m',
      'matrix-url',
      '-r',
      'https://realms.my.server/',
    ]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/--matrix-url "matrix-url" is not a valid URL/);
  });

  it('exits 1 when --realm-server-url uses a non-http(s) scheme', async () => {
    let res = await run([
      '-u',
      '@alice:my.server',
      '-m',
      'https://matrix.my.server',
      '-r',
      'file:///etc/passwd',
    ]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(
      /--realm-server-url "file:\/\/\/etc\/passwd" must use http:\/\/ or https:\/\//,
    );
  });

  it('does not let a leaked BOXEL_ENVIRONMENT change the outcome', async () => {
    // The suite (and CI) strips BOXEL_* from the inherited env before
    // spawning the CLI — see run-boxel.ts — so a developer's shell that
    // exports BOXEL_ENVIRONMENT can't shift behavior away from CI. Passing
    // it explicitly here would opt it back in; we don't, and assert the
    // same "Unknown domain" error a clean environment produces.
    let res = await run(['-u', '@alice:my.server']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/Unknown domain/);
  });

  it('exits 1 with a clear error for a non-standard domain without URL flags', async () => {
    let res = await run(['-u', '@alice:my.server']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/Unknown domain/);
    expect(res.stderr).toMatch(/--matrix-url/);
    expect(res.stderr).toMatch(/--realm-server-url/);
    expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
      false,
    );
  });

  it('exits 1 when BOXEL_ENVIRONMENT slugifies to empty (and is actually consulted)', async () => {
    // Use a non-standard domain so BOXEL_ENVIRONMENT is consulted; a
    // standard domain like @alice:stack.cards bypasses the env var entirely.
    let res = await run(['-u', '@alice:my.server'], {
      BOXEL_ENVIRONMENT: '!!!',
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/BOXEL_ENVIRONMENT="!!!"/);
    expect(res.stderr).toMatch(/no slug characters/);
    expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
      false,
    );
  });
});

// `--profile` (and `BOXEL_PROFILE`) pick the profile one invocation acts as.
// These cover what is decided before any request: which profile is named,
// and that a bad one stops the command without touching the profiles file.
// Acting as the selected profile against a realm server is covered in
// tests/integration/realm-create.test.ts.
describe('boxel --profile', () => {
  const ALICE = '@alice:localhost';
  const BOB = '@bob:localhost';
  let tmpHome: string;
  let profilesFile: string;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-smoke-'));
    profilesFile = join(tmpHome, '.boxel-cli', 'profiles.json');
    let pm = new ProfileManager(join(tmpHome, '.boxel-cli'));
    for (let id of [ALICE, BOB]) {
      await pm.addProfileWithAuth(id, {
        accessToken: `token-for-${id}`,
        userId: id,
        deviceId: 'DEVICE',
        matrixUrl: 'http://localhost:8008',
      });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('refuses a profile that is not saved, naming the saved ones', async () => {
    let before = fs.readFileSync(profilesFile, 'utf-8');

    let res = await runBoxel(
      ['realm', 'list', '--profile', '@carol:localhost'],
      {
        home: tmpHome,
      },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(
      `No profile named "@carol:localhost". Saved profiles: ${ALICE}, ${BOB}.`,
    );
    expect(fs.readFileSync(profilesFile, 'utf-8')).toBe(before);
  });

  it('is accepted before the command as well as after it', async () => {
    let res = await runBoxel(
      ['--profile', '@carol:localhost', 'realm', 'list'],
      { home: tmpHome },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('No profile named "@carol:localhost"');
  });

  it('reads BOXEL_PROFILE, and says so when it names no saved profile', async () => {
    let res = await runBoxel(['realm', 'list'], {
      home: tmpHome,
      env: { BOXEL_PROFILE: '@carol:localhost' },
    });

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('No profile named "@carol:localhost"');
    expect(res.stderr).toContain('BOXEL_PROFILE is set to "@carol:localhost"');
  });

  it('prefers --profile over BOXEL_PROFILE', async () => {
    let res = await runBoxel(
      ['realm', 'list', '--profile', '@carol:localhost'],
      { home: tmpHome, env: { BOXEL_PROFILE: BOB } },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('No profile named "@carol:localhost"');
    expect(res.stderr).not.toContain('BOXEL_PROFILE');
  });

  it('is refused by `boxel profile`, which manages the active profile', async () => {
    let res = await runBoxel(['profile', 'list', '--profile', BOB], {
      home: tmpHome,
    });

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('boxel profile switch <id>');
  });

  it('leaves `boxel profile list` showing the active profile under BOXEL_PROFILE', async () => {
    let res = await runBoxel(['profile', 'list', '--json'], {
      home: tmpHome,
      env: { BOXEL_PROFILE: BOB },
    });

    expect(res.ok).toBe(true);
    expect(JSON.parse(res.stdout).activeProfile).toBe(ALICE);
  });
});
