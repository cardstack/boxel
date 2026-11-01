import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PREFIX_REALMS_ENDPOINT,
  clearPrefixRealmNetworkCache,
} from '@cardstack/runtime-common/prefix-realm-network';
import {
  resolveRealmIdentifier,
  resolveRealmNetwork,
} from '../../src/lib/resolve-realm-identifier.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';

function emptyProfileManager(): {
  profileManager: ProfileManager;
  cleanup: () => void;
} {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-rri-test-'));
  return {
    profileManager: new ProfileManager(dir),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// The map a realm server serves. The catalog is deliberately served away from
// `<server>/catalog/`, so a resolution that guessed from the prefix's spelling
// would come out wrong.
const SERVED = {
  '@cardstack/base/': 'https://realms.example.test/base/',
  '@cardstack/catalog/': 'https://catalog.example.test/',
  '@cardstack/skills/': 'https://realms.example.test/skills/',
};

/** A fetch answering `/_prefix-realms` on any server with `served`. */
function prefixMapFetch(
  served: Record<string, string> = SERVED,
  calls: string[] = [],
): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    let url =
      input instanceof Request ? input.url : new URL(String(input)).href;
    calls.push(url);
    if (!url.endsWith(`/${PREFIX_REALMS_ENDPOINT}`)) {
      return new Response('not found', { status: 404 });
    }
    return Response.json({
      data: Object.entries(served).map(([id, realmURL]) => ({
        type: 'prefix-realm',
        id,
        attributes: { realmURL },
      })),
    });
  }) as typeof globalThis.fetch;
}

describe('resolveRealmIdentifier', () => {
  const server = 'https://realms.example.test/';

  beforeEach(() => {
    clearPrefixRealmNetworkCache();
  });

  it('passes plain URLs through without asking the server', async () => {
    let calls: string[] = [];
    let result = await resolveRealmIdentifier(
      'http://localhost:4201/user/realm/',
      { realmServerUrl: server, fetch: prefixMapFetch(SERVED, calls) },
    );
    expect(result).toEqual({
      ok: true,
      url: 'http://localhost:4201/user/realm/',
    });
    expect(calls).toEqual([]);
  });

  it('resolves a prefix to where the server says the realm is served', async () => {
    let result = await resolveRealmIdentifier('@cardstack/catalog/', {
      realmServerUrl: server,
      fetch: prefixMapFetch(),
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://catalog.example.test/',
    });
  });

  it('resolves a full file identifier, preserving the path', async () => {
    let result = await resolveRealmIdentifier(
      '@cardstack/catalog/nested/card.gts',
      { realmServerUrl: server, fetch: prefixMapFetch() },
    );
    expect(result).toEqual({
      ok: true,
      url: 'https://catalog.example.test/nested/card.gts',
    });
  });

  it('reads the map from the realm server URL, with or without a trailing slash', async () => {
    let calls: string[] = [];
    let result = await resolveRealmIdentifier('@cardstack/skills/', {
      realmServerUrl: 'https://realms.example.test',
      fetch: prefixMapFetch(SERVED, calls),
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://realms.example.test/skills/',
    });
    expect(calls).toEqual([
      `https://realms.example.test/${PREFIX_REALMS_ENDPOINT}`,
    ]);
  });

  it('reads the map once per server for the process', async () => {
    let calls: string[] = [];
    let fetch = prefixMapFetch(SERVED, calls);
    await resolveRealmIdentifier('@cardstack/catalog/', {
      realmServerUrl: server,
      fetch,
    });
    await resolveRealmIdentifier('@cardstack/skills/x.gts', {
      realmServerUrl: server,
      fetch,
    });
    expect(calls).toHaveLength(1);
  });

  it('rejects a prefix the server does not serve', async () => {
    let result = await resolveRealmIdentifier('@other/realm/', {
      realmServerUrl: server,
      fetch: prefixMapFetch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no registered realm prefix matches');
      expect(result.error).toContain('@cardstack/catalog/');
    }
  });

  it('rejects a scope with no realm name', async () => {
    let result = await resolveRealmIdentifier('@cardstack/', {
      realmServerUrl: server,
      fetch: prefixMapFetch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no registered realm prefix matches');
    }
  });

  it('reports a server whose map cannot be read, and asks again next time', async () => {
    let attempts = 0;
    let failing = (async () => {
      attempts++;
      return new Response('down', { status: 503 });
    }) as typeof globalThis.fetch;
    let result = await resolveRealmIdentifier('@cardstack/catalog/', {
      realmServerUrl: server,
      fetch: failing,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`/${PREFIX_REALMS_ENDPOINT}`);
      expect(result.error).toContain('503');
    }

    let recovered = await resolveRealmIdentifier('@cardstack/catalog/', {
      realmServerUrl: server,
      fetch: prefixMapFetch(),
    });
    expect(attempts).toBe(1);
    expect(recovered).toEqual({
      ok: true,
      url: 'https://catalog.example.test/',
    });
  });

  it('rejects a document that is not a prefix realm map', async () => {
    let result = await resolveRealmIdentifier('@cardstack/catalog/', {
      realmServerUrl: server,
      fetch: (async () => Response.json({ hello: 'world' })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('did not answer with a prefix realm');
    }
  });

  describe('realm-server URL sources', () => {
    let savedEnv = process.env.REALM_SERVER_URL;
    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env.REALM_SERVER_URL;
      } else {
        process.env.REALM_SERVER_URL = savedEnv;
      }
    });

    it('falls back to REALM_SERVER_URL when there is no active profile', async () => {
      process.env.REALM_SERVER_URL = 'https://env.example.test/';
      let calls: string[] = [];
      let { profileManager, cleanup } = emptyProfileManager();
      let result = await resolveRealmIdentifier('@cardstack/catalog/', {
        profileManager,
        fetch: prefixMapFetch(SERVED, calls),
      });
      cleanup();
      expect(calls).toEqual([
        `https://env.example.test/${PREFIX_REALMS_ENDPOINT}`,
      ]);
      expect(result).toEqual({
        ok: true,
        url: 'https://catalog.example.test/',
      });
    });

    it('errors when no realm-server URL source is available', async () => {
      delete process.env.REALM_SERVER_URL;
      let { profileManager, cleanup } = emptyProfileManager();
      let result = await resolveRealmIdentifier('@cardstack/catalog/', {
        profileManager,
      });
      cleanup();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('boxel profile add');
      }
    });
  });
});

describe('resolveRealmNetwork', () => {
  beforeEach(() => {
    clearPrefixRealmNetworkCache();
  });

  it('hands back a network carrying the served map', async () => {
    let resolved = await resolveRealmNetwork({
      realmServerUrl: 'https://realms.example.test/',
      fetch: prefixMapFetch(),
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.network.prefixRealmURLs()).toEqual(SERVED);
      expect(
        resolved.network.realmForReference('@cardstack/catalog/a/b.gts'),
      ).toBe('https://catalog.example.test/');
      expect(
        resolved.network.pathBelowNamespace('@cardstack/catalog/a/b.gts'),
      ).toBe('a/b.gts');
    }
  });
});
