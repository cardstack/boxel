import '../helpers/setup-realm-server';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { resolve, join } from 'path';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  startTestRealmServer,
  stopTestRealmServer,
  TEST_REALM_SERVER_URL,
  TEST_USERNAME,
  TEST_PASSWORD,
  matrixURL,
} from '../helpers/integration';

const cliEntry = resolve(__dirname, '../../dist/index.js');
const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const matrixId = `@${TEST_USERNAME}:localhost`;

beforeAll(async () => {
  // startTestRealmServer registers TEST_USERNAME in Synapse by default,
  // which is what `boxel profile add -p ${TEST_PASSWORD}` will log in as.
  await startTestRealmServer();
});

afterAll(async () => {
  await stopTestRealmServer();
});

// These tests subprocess the built CLI binary (packages/boxel-cli/dist) and
// exercise the happy-path `profile add` flow that CS-10725 made
// network-bound. They moved here from tests/smoke.test.ts so they can hit
// the dockerised Synapse + realm-server rather than the public internet.
describe('boxel profile add (integration, subprocess)', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-profile-add-int-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const sanitizedParentEnv = () =>
    Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('BOXEL_')),
    );

  // Wraps execFileSync with the shared HOME + BOXEL_PASSWORD env and any
  // caller-supplied flags. Tests opt in to BOXEL_ENVIRONMENT etc. via
  // extraEnv. All invocations point at the in-process Synapse + realm
  // server unless the test overrides --matrix-url / --realm-server-url.
  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    execFileSync(process.execPath, [cliEntry, 'profile', 'add', ...args], {
      encoding: 'utf8',
      env: {
        ...sanitizedParentEnv(),
        HOME: tmpHome,
        BOXEL_PASSWORD: TEST_PASSWORD,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const readProfiles = () =>
    JSON.parse(
      fs.readFileSync(join(tmpHome, '.boxel-cli', 'profiles.json'), 'utf8'),
    );

  it('--quiet silences the success line and still writes the profile', () => {
    // End-to-end check that `--quiet` (a global flag, so it comes before
    // `profile`) swallows the "Profile created" line while the on-disk
    // side-effect still happens.
    const stdout = execFileSync(
      process.execPath,
      [
        cliEntry,
        '--quiet',
        'profile',
        'add',
        '-u',
        matrixId,
        '-m',
        matrixURL.href,
        '-r',
        realmServerUrl,
      ],
      {
        encoding: 'utf8',
        env: {
          ...sanitizedParentEnv(),
          HOME: tmpHome,
          BOXEL_PASSWORD: TEST_PASSWORD,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(stdout).toBe('');
    expect(fs.existsSync(join(tmpHome, '.boxel-cli', 'profiles.json'))).toBe(
      true,
    );
  });

  it('emits the "Profile created" line normally without --quiet', () => {
    const stdout = run([
      '-u',
      matrixId,
      '-m',
      matrixURL.href,
      '-r',
      realmServerUrl,
    ]);
    expect(stdout).toMatch(/Profile created/);
  });

  it('writes matrixAccessToken (not password) for a non-standard domain with URL flags', () => {
    run(['-u', matrixId, '-m', matrixURL.href, '-r', realmServerUrl]);

    const config = readProfiles();
    const profile = config.profiles[matrixId];
    expect(profile).toMatchObject({
      matrixUrl: matrixURL.href,
      realmServerUrl,
      matrixUserId: matrixId,
    });
    expect(profile.matrixAccessToken).toEqual(expect.any(String));
    expect(profile.matrixAccessToken.length).toBeGreaterThan(0);
    expect(profile.matrixDeviceId).toEqual(expect.any(String));
    expect(profile.password).toBeUndefined();
  });

  it('trims whitespace from URL flag values', () => {
    run([
      '-u',
      matrixId,
      '-m',
      `  ${matrixURL.href}  `,
      '-r',
      `  ${realmServerUrl}  `,
    ]);

    const config = readProfiles();
    expect(config.profiles[matrixId]).toMatchObject({
      matrixUrl: matrixURL.href,
      realmServerUrl,
    });
  });

  it('lets --matrix-url and --realm-server-url override BOXEL_ENVIRONMENT', () => {
    // BOXEL_ENVIRONMENT would normally derive
    // http://matrix.cs-10998-foo.localhost — explicit flags must win.
    run(['-u', matrixId, '-m', matrixURL.href, '-r', realmServerUrl], {
      BOXEL_ENVIRONMENT: 'cs-10998-foo',
    });

    const config = readProfiles();
    expect(config.profiles[matrixId]).toMatchObject({
      matrixUrl: matrixURL.href,
      realmServerUrl,
    });
  });

  it('ignores an invalid BOXEL_ENVIRONMENT when both URL flags are supplied', () => {
    // If both URLs are explicit, BOXEL_ENVIRONMENT is never consulted —
    // even a value that would normally exit 1 (slugifies to empty) must
    // not block the command.
    run(['-u', matrixId, '-m', matrixURL.href, '-r', realmServerUrl], {
      BOXEL_ENVIRONMENT: '!!!',
    });

    const config = readProfiles();
    expect(config.profiles[matrixId]).toMatchObject({
      matrixUrl: matrixURL.href,
      realmServerUrl,
    });
  });

  it('refreshes the stored access token when re-adding an existing profile', () => {
    // Pre-CS-10725 this test verified that re-running `profile add` with
    // different URLs updated the stored URLs. After CS-10725 we can no
    // longer freely substitute fake URLs (both runs need to actually log
    // in), so the test instead verifies the new, more important property:
    // re-running addProfile against the same URLs produces a fresh
    // matrixAccessToken and matrixDeviceId.
    run(['-u', matrixId, '-m', matrixURL.href, '-r', realmServerUrl]);
    const first = readProfiles().profiles[matrixId];

    run(['-u', matrixId, '-m', matrixURL.href, '-r', realmServerUrl]);
    const second = readProfiles().profiles[matrixId];

    expect(second.matrixAccessToken).not.toBe(first.matrixAccessToken);
    expect(second.matrixDeviceId).not.toBe(first.matrixDeviceId);
    expect(second.password).toBeUndefined();
  });
});
