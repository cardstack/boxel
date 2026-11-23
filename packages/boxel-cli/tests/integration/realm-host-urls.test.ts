import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  createTestRealmViaCli,
  getTestDbAdapter,
  uniqueRealmName,
  realmSecretSeed,
  TEST_USERNAME,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// Drives `boxel realm mount`, `boxel realm unmount` and `boxel realm
// host-urls` as subprocesses against a test realm server. The server's Boxel
// Space and site domains are both `localhost`, so a site name is
// `http://<name>.localhost/`.
//
// This harness uses a noop prerenderer, so the anonymous home page check that
// a mount runs can't pass. The tests that need a host URL insert its row
// directly, and the mount tests assert on the refusals and on the site name
// claim, which the server makes before that check.

const OWNER_USER_ID = `@${TEST_USERNAME}:localhost`;

interface HostURLJson {
  id: string;
  realmURL: string;
  url: string;
  kind: string;
  isCanonical: boolean;
}

interface HostURLListJson {
  hostURLs: HostURLJson[];
  boxelSpaceURL?: string;
}

interface ErrorJson {
  error: string;
  status?: number;
}

let home: string;
let cleanupProfile: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

async function realmId(realmURL: string): Promise<string> {
  let rows = (await getTestDbAdapter()!.execute(
    `SELECT id FROM realm_registry WHERE url = $1`,
    { bind: [realmURL] },
  )) as { id: string }[];
  expect(rows.length, `registry row for ${realmURL}`).toBe(1);
  return rows[0].id;
}

// Adds a host URL row for the realm, as a mount that passed every check would.
async function insertHostURL(
  realmURL: string,
  host: string,
  isCanonical: boolean,
): Promise<string> {
  await getTestDbAdapter()!.execute(
    `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by)
     VALUES ($1, 'site-name', $2, '/', $3, $4)`,
    { bind: [await realmId(realmURL), host, isCanonical, OWNER_USER_ID] },
  );
  return `http://${host}/`;
}

function uniqueSiteHost(): string {
  return `site-${uniqueRealmName()}.localhost`;
}

describe('realm host-urls (integration)', () => {
  it('lists the host URLs and the Boxel Space URL', async () => {
    let { realmUrl, name } = await createTestRealmViaCli(home);
    let first = await insertHostURL(realmUrl, uniqueSiteHost(), true);
    let second = await insertHostURL(realmUrl, uniqueSiteHost(), false);

    let res = await runBoxel(['realm', 'host-urls', realmUrl, '--json'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    let list = res.json<HostURLListJson>();
    expect(
      list.hostURLs.map(({ url, kind, isCanonical }) => ({
        url,
        kind,
        isCanonical,
      })),
    ).toEqual([
      { url: first, kind: 'site-name', isCanonical: true },
      { url: second, kind: 'site-name', isCanonical: false },
    ]);
    expect(list.boxelSpaceURL).toMatch(
      new RegExp(`^http://[^/]+\\.localhost/${name}/$`),
    );
  });

  it('marks another host URL canonical', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    await insertHostURL(realmUrl, uniqueSiteHost(), true);
    let second = await insertHostURL(realmUrl, uniqueSiteHost(), false);

    let res = await runBoxel(
      ['realm', 'host-urls', realmUrl, '--set-canonical', second, '--json'],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let list = res.json<HostURLListJson>();
    expect(
      list.hostURLs.filter((h) => h.isCanonical).map((h) => h.url),
    ).toEqual([second]);
  });

  it('refuses a user who does not administer the realm', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-seed-'));
    try {
      let res = await runBoxel(
        [
          'realm',
          'host-urls',
          realmUrl,
          '--realm-secret-seed',
          '--as-user',
          '@not-an-admin:localhost',
          '--json',
        ],
        {
          home: emptyHome,
          env: {
            BOXEL_REALM_SECRET_SEED: realmSecretSeed,
            MATRIX_SERVER_NAME: 'localhost',
          },
        },
      );
      expect(res.exitCode).toBe(1);
      let result = res.json<ErrorJson>();
      expect(result.status).toBe(403);
      expect(result.error).toContain('does not have enough permission');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('lists the host URLs with seed-mode auth for the realm owner', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let mounted = await insertHostURL(realmUrl, uniqueSiteHost(), true);
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-seed-'));
    try {
      let res = await runBoxel(
        ['realm', 'host-urls', realmUrl, '--realm-secret-seed', '--json'],
        {
          home: emptyHome,
          env: {
            BOXEL_REALM_SECRET_SEED: realmSecretSeed,
            MATRIX_SERVER_NAME: 'localhost',
          },
        },
      );
      expect(res.ok, res.stderr).toBe(true);
      expect(res.json<HostURLListJson>().hostURLs.map((h) => h.url)).toEqual([
        mounted,
      ]);
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});

describe('realm unmount (integration)', () => {
  it('unmounts a host URL', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let canonical = await insertHostURL(realmUrl, uniqueSiteHost(), true);
    let other = await insertHostURL(realmUrl, uniqueSiteHost(), false);

    let res = await runBoxel(['realm', 'unmount', realmUrl, other, '--json'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.json<{ unmounted: boolean }>().unmounted).toBe(true);

    let list = await runBoxel(['realm', 'host-urls', realmUrl, '--json'], {
      home,
    });
    expect(list.json<HostURLListJson>().hostURLs.map((h) => h.url)).toEqual([
      canonical,
    ]);
  });

  it('prints the refusal to unmount the canonical host URL while others remain', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let canonical = await insertHostURL(realmUrl, uniqueSiteHost(), true);
    await insertHostURL(realmUrl, uniqueSiteHost(), false);

    let res = await runBoxel(['realm', 'unmount', realmUrl, canonical], {
      home,
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(
      'This host URL is canonical. Mark another host URL canonical before you remove this one.',
    );
  });

  it('fails for a host URL the realm is not mounted at, unless told to tolerate it', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let missing = `http://${uniqueSiteHost()}/`;

    let refused = await runBoxel(['realm', 'unmount', realmUrl, missing], {
      home,
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('The realm is not mounted at');

    let tolerated = await runBoxel(
      ['realm', 'unmount', realmUrl, missing, '--tolerate-missing', '--json'],
      { home },
    );
    expect(tolerated.ok, tolerated.stderr).toBe(true);
    expect(tolerated.json<{ notFound?: boolean }>().notFound).toBe(true);
  });
});

describe('realm mount (integration)', () => {
  it('prints the refusal for a host that is not on a host URL domain', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);

    let res = await runBoxel(
      ['realm', 'mount', realmUrl, 'http://shop.example.test/', '--json'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    let result = res.json<ErrorJson>();
    expect(result.status).toBe(422);
    expect(result.error).toContain(
      'The host shop.example.test is not a domain a host URL can be on',
    );
  });

  it('refuses a host URL together with --space', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let res = await runBoxel(
      ['realm', 'mount', realmUrl, `http://${uniqueSiteHost()}/`, '--space'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Give a <host-url> or --space, not both.');
  });

  it('claims a site name before the mount, and only once', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let host = uniqueSiteHost();
    let siteURL = `http://${host}/`;

    let first = await runBoxel(['realm', 'mount', realmUrl, siteURL], {
      home,
    });
    expect(first.stderr).toContain(`Claimed the site name ${host}`);
    let claims = (await getTestDbAdapter()!.execute(
      `SELECT hostname, realm_id FROM claimed_domains_for_sites WHERE hostname = $1 AND removed_at IS NULL`,
      { bind: [host] },
    )) as { hostname: string; realm_id: string }[];
    expect(claims).toEqual([
      { hostname: host, realm_id: await realmId(realmUrl) },
    ]);

    // The name is claimed for this realm now, so a second mount doesn't
    // claim it again.
    let second = await runBoxel(['realm', 'mount', realmUrl, siteURL], {
      home,
    });
    expect(second.stderr).not.toContain('Claimed the site name');
    expect(second.stderr).not.toContain('already claimed');
  });

  it('prints the refusal for a site name claimed for another realm', async () => {
    let { realmUrl: claimingRealm } = await createTestRealmViaCli(home);
    let { realmUrl: otherRealm } = await createTestRealmViaCli(home);
    let host = uniqueSiteHost();
    let siteURL = `http://${host}/`;

    await runBoxel(['realm', 'mount', claimingRealm, siteURL], { home });

    let res = await runBoxel(['realm', 'mount', otherRealm, siteURL], {
      home,
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Hostname is already claimed');
  });
});
