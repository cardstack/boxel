import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRealm } from '../../src/commands/realm/create.ts';
import { listRealms } from '../../src/commands/realm/list.ts';
import { removeRealm } from '../../src/commands/realm/remove.ts';
import { ensurePersonalRealmWithOAuth } from '../../src/lib/personal-realm.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';

const SERVER = 'https://realms.example.test';
const USER = '@example-user:example.test';
const MINE = `${SERVER}/example-user/workspace/`;
const SHARED = `${SERVER}/someone-else/shared/`;
const ARCHIVED = `${SERVER}/example-user/old/`;
const CREATED = `${SERVER}/example-user/new-realm/`;
const ACCESS = 'access-token-placeholder';

interface Recorded {
  method: string;
  path: string;
  authorization: string | null;
}

// A realm server answering as it does for an OAuth caller: it keeps the
// workspace list itself, adding a realm it creates and removing one it
// deletes. It answers which realms on the list the caller can still open:
// all but `unreachable`, with `ARCHIVED` archived.
function realmServer(
  options: {
    listStatus?: number;
    realms?: string[];
    unreachable?: string[];
    // Answers as a realm server that predates `reachableRealms`.
    withoutReachable?: boolean;
    createStatus?: number;
  } = {},
) {
  let realms = [...(options.realms ?? [MINE])];
  let requests: Recorded[] = [];
  let fetchFn = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      let url = new URL(String(input instanceof Request ? input.url : input));
      let method = init.method ?? 'GET';
      requests.push({
        method,
        path: url.pathname,
        authorization: new Headers(init.headers).get('Authorization'),
      });
      if (url.pathname === '/_user-realms') {
        if (options.listStatus && options.listStatus !== 200) {
          return new Response('{"errors":[]}', { status: options.listStatus });
        }
        let reachableRealms = realms
          .filter((url) => !options.unreachable?.includes(url))
          .map((url) => ({ url, archived: url === ARCHIVED }));
        return Response.json({
          data: {
            type: 'user-realms',
            id: USER,
            attributes: options.withoutReachable
              ? { realms }
              : { realms, reachableRealms },
          },
        });
      }
      if (url.pathname === '/_create-realm') {
        if (options.createStatus === 400) {
          realms.push(MINE);
          return new Response(`Realm '${MINE}' already exists on this server`, {
            status: 400,
          });
        }
        realms.push(CREATED);
        return Response.json({ data: { id: CREATED } }, { status: 201 });
      }
      if (url.pathname === '/_delete-realm') {
        realms = realms.filter((r) => r !== MINE);
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/_readiness-check')) {
        return new Response('{}', { status: 200 });
      }
      if (url.pathname === '/someone-else/shared/_info') {
        return Response.json({ data: { id: SHARED } });
      }
      // `_realm-auth` included: the Boxel API doesn't offer it.
      return new Response(null, { status: 404 });
    },
  );
  return { fetchFn, requests, realms: () => realms };
}

describe('the workspace list on a profile signed in with OAuth', () => {
  let dir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-oauth-workspaces-'));
    pm = new ProfileManager(dir);
    pm.addOAuthProfile(
      USER,
      {
        issuer: SERVER,
        tokenEndpoint: `${SERVER}/_oauth-provider/token`,
        accessToken: ACCESS,
        refreshToken: 'refresh-token-placeholder',
        accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        connectionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: `${SERVER}/`,
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function serve(options?: Parameters<typeof realmServer>[0]) {
    let server = realmServer(options);
    vi.stubGlobal('fetch', server.fetchFn);
    return server;
  }

  it('reads the list from the realm server with the access token', async () => {
    let server = serve();

    await expect(pm.getUserRealms()).resolves.toEqual([MINE]);
    expect(server.requests).toEqual([
      {
        method: 'GET',
        path: '/_user-realms',
        authorization: `Bearer ${ACCESS}`,
      },
    ]);
  });

  it("never reads a list the server couldn't give as an empty one", async () => {
    serve({ listStatus: 503 });

    await expect(pm.getUserRealms()).rejects.toThrow(
      "The realm server couldn't read your workspace list: 503",
    );
  });

  it('refuses to edit the list itself, which the realm server keeps', async () => {
    await expect(pm.addToUserRealms(CREATED)).rejects.toThrow(
      /signed in with OAuth: the realm server keeps its workspace list/,
    );
    await expect(pm.removeFromUserRealms(MINE)).rejects.toThrow(
      /signed in with OAuth/,
    );
  });

  it('lists only the workspaces on the list, with one request', async () => {
    let server = serve();

    let result = await listRealms({
      profileManager: pm,
      includeArchived: true,
    });

    expect(result).toEqual({
      realms: [{ url: MINE, hidden: false, archived: false }],
    });
    expect(server.requests.map((r) => r.path)).toEqual(['/_user-realms']);
  });

  it('leaves out a workspace it can no longer open', async () => {
    // Its permission was revoked, or another client deleted it: the list
    // still names it.
    serve({ realms: [MINE, SHARED], unreachable: [SHARED] });

    let result = await listRealms({ profileManager: pm });

    expect(result).toEqual({
      realms: [{ url: MINE, hidden: false, archived: false }],
    });
  });

  it('says a realm server that predates reachableRealms is older', async () => {
    serve({ realms: [MINE], withoutReachable: true });

    let result = await listRealms({ profileManager: pm });

    expect(result.realms).toEqual([]);
    expect(result.error).toMatch(
      /didn't say which of your workspaces you can still open\. It is probably older than this version of boxel-cli/,
    );
  });

  it("doesn't list what the server can't say it can open", async () => {
    serve({ listStatus: 503 });

    let result = await listRealms({ profileManager: pm });

    expect(result.realms).toEqual([]);
    expect(result.error).toMatch(/couldn't read your workspace list: 503/);
  });

  it('lists a workspace that has been archived only as archived', async () => {
    // Archiving a realm leaves it in the workspace list.
    serve({ realms: [MINE, ARCHIVED] });

    let active = await listRealms({ profileManager: pm });
    let all = await listRealms({ profileManager: pm, includeArchived: true });

    expect(active).toEqual({
      realms: [{ url: MINE, hidden: false, archived: false }],
    });
    expect(all).toEqual({
      realms: [
        { url: ARCHIVED, hidden: false, archived: true },
        { url: MINE, hidden: false, archived: false },
      ],
    });
  });

  it('refuses --hidden and --all-accessible, which need a Matrix profile', async () => {
    let server = serve();

    for (let options of [{ hidden: true }, { allAccessible: true }]) {
      let result = await listRealms({ profileManager: pm, ...options });
      expect(result.realms).toEqual([]);
      expect(result.error).toMatch(
        /signed in with OAuth, so it lists only your workspaces/,
      );
    }
    expect(server.requests).toEqual([]);
  });

  it('creates a realm and leaves the list to the server, waiting for it with the access token', async () => {
    let server = serve();

    let result = await createRealm('new-realm', 'New Realm', {
      profileManager: pm,
      waitForReady: true,
    });

    expect(result).toEqual({ realmUrl: CREATED, created: true });
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /_create-realm',
      'GET /example-user/new-realm/_readiness-check',
    ]);
    expect(
      server.requests.every((r) => r.authorization === `Bearer ${ACCESS}`),
    ).toBe(true);
    expect(server.realms()).toContain(CREATED);
  });

  it('takes "already exists" for one of your realms as the server having re-linked it', async () => {
    serve({ realms: [], createStatus: 400 });

    let result = await createRealm('workspace', 'Workspace', {
      profileManager: pm,
    });

    expect(result).toEqual({ realmUrl: MINE, created: false });
  });

  it('removes a realm and leaves the unlink to the server', async () => {
    let server = serve();

    let result = await removeRealm({ realmUrl: MINE, profileManager: pm });

    expect(result).toMatchObject({
      removed: true,
      serverDeleted: true,
      unlinked: true,
    });
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_user-realms',
      'DELETE /_delete-realm',
    ]);
  });

  it("finds a URL's realm in the workspace list, then by asking realms", async () => {
    let server = serve();

    await expect(pm.realmUrlFor(`${MINE}Card/1`)).resolves.toBe(MINE);
    await expect(pm.realmUrlFor(`${SHARED}Card/1`)).resolves.toBe(SHARED);
    expect(server.requests.map((r) => r.path)).toEqual([
      '/_user-realms',
      '/_user-realms',
      '/someone-else/shared/Card/1/_info',
      '/someone-else/shared/Card/_info',
      '/someone-else/shared/_info',
    ]);
    await expect(
      pm.realmUrlFor(`${SERVER}/nowhere/Card/1`),
    ).resolves.toBeUndefined();
  });

  it("doesn't look for a realm on another site, which never gets the token", async () => {
    let server = serve();

    await expect(
      pm.realmUrlFor('https://elsewhere.example.test/a/b/Card/1'),
    ).resolves.toBeUndefined();
    expect(server.requests.map((r) => r.path)).toEqual(['/_user-realms']);
  });
});

describe('setting up a personal workspace after an OAuth sign-in', () => {
  const credentials = {
    accessToken: ACCESS,
    userId: USER,
    displayName: 'Example User',
  };

  it('does nothing for an account that has workspaces', async () => {
    let server = realmServer();

    await expect(
      ensurePersonalRealmWithOAuth(credentials, SERVER, server.fetchFn),
    ).resolves.toEqual({ outcome: 'has-realms' });
    expect(server.requests.map((r) => r.path)).toEqual(['/_user-realms']);
  });

  it('creates one, which the server adds to the list', async () => {
    let server = realmServer({ realms: [] });

    await expect(
      ensurePersonalRealmWithOAuth(credentials, SERVER, server.fetchFn),
    ).resolves.toEqual({ outcome: 'created', realmUrl: CREATED });
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_user-realms',
      'POST /_create-realm',
    ]);
    expect(server.requests[1].authorization).toBe(`Bearer ${ACCESS}`);
    expect(server.realms()).toEqual([CREATED]);
  });

  it('reports one the server re-linked as linked', async () => {
    let server = realmServer({ realms: [], createStatus: 400 });

    await expect(
      ensurePersonalRealmWithOAuth(credentials, SERVER, server.fetchFn),
    ).resolves.toEqual({ outcome: 'linked', realmUrl: MINE });
  });

  it("creates nothing when the list can't be read", async () => {
    let server = realmServer({ realms: [], listStatus: 404 });

    await expect(
      ensurePersonalRealmWithOAuth(credentials, SERVER, server.fetchFn),
    ).rejects.toThrow("couldn't read your workspace list: 404");
    expect(server.requests.map((r) => r.path)).toEqual(['/_user-realms']);
  });
});
