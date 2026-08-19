import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// The test realm server in helpers/integration.ts signs realm JWTs with
// `realmSecretSeed = "shhh! it's a secret"`. Driving the CLI with that seed in
// `BOXEL_REALM_SECRET_SEED` exercises the administrative seed-auth path: the
// CLI mints a JWT locally (default `realm_server` username) and never performs
// a Matrix login. The test realm permits read/write to any authenticated user
// (`'*': ['read','write']`), so the download succeeds whenever the JWT is
// signed with the right seed.
const TEST_REALM_SECRET_SEED = `shhh! it's a secret`;

let realmUrl: string;
let localDirs: string[] = [];
let homes: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-pull-seed-int-'));
  localDirs.push(dir);
  return dir;
}

// A throwaway empty home (no profile seeded) so the CLI can only authenticate
// from the seed, never a Matrix profile.
function makeEmptyHome(): string {
  let { home } = createTestHome();
  homes.push(home);
  return home;
}

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'hello.gts': 'export const hello = "world";\n',
      'nested/card.gts': 'export const nested = true;\n',
    },
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (let home of homes) {
    fs.rmSync(home, { recursive: true, force: true });
  }
  await stopTestRealmServer();
});

describe('realm pull with seed-based auth (integration)', () => {
  it('pulls files authenticating via a locally-minted JWT (no Matrix login)', async () => {
    let localDir = makeLocalDir();
    // Empty profile: no Matrix login credentials exist at all. The CLI must
    // authenticate purely from the seed supplied via the environment.
    let home = makeEmptyHome();

    let res = await runBoxel(['realm', 'pull', realmUrl, localDir], {
      home,
      env: { BOXEL_REALM_SECRET_SEED: TEST_REALM_SECRET_SEED },
    });
    expect(res.ok, res.stderr).toBe(true);

    let helloPath = path.join(localDir, 'hello.gts');
    let nestedPath = path.join(localDir, 'nested', 'card.gts');
    expect(fs.existsSync(helloPath)).toBe(true);
    expect(fs.existsSync(nestedPath)).toBe(true);
    expect(fs.readFileSync(helloPath, 'utf8')).toContain('hello = "world"');
  });

  it('fails cleanly with the "No active profile" error when neither a seed nor a profile is configured', async () => {
    let localDir = makeLocalDir();
    let home = makeEmptyHome();

    let res = await runBoxel(['realm', 'pull', realmUrl, localDir], { home });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('No active profile');
  });

  it('resolves the realm secret seed through the CLI resolver without requiring a profile', async () => {
    // Exercises the seed-driven path end-to-end: the CLI resolves
    // BOXEL_REALM_SECRET_SEED, builds a SeedAuthenticator using the default
    // `realm_server` username, attempts no Matrix login, and surfaces no
    // "No active profile" error even with an empty profile dir.
    let localDir = makeLocalDir();
    let home = makeEmptyHome();

    let res = await runBoxel(['realm', 'pull', realmUrl, localDir], {
      home,
      env: { BOXEL_REALM_SECRET_SEED: TEST_REALM_SECRET_SEED },
    });
    expect(res.ok, res.stderr).toBe(true);
    expect(fs.existsSync(path.join(localDir, 'hello.gts'))).toBe(true);
  });
});
