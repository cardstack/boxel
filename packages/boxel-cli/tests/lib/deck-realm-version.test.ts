import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
import { cutDeckRealmVersion } from '../../src/lib/deck-realm-version.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

const REALM_URL = 'https://realm.example/acme/kit/';
const BUTTON_URL = `${REALM_URL}button/`;

class VersionRealm implements RealmAuthenticator {
  content: Record<string, string> = {
    'package.json': '{"name":"@acme/kit","version":"1.2.0"}',
    'importmap.json': '{"imports":{}}',
    'button/package.json': '{"name":"@acme/button","version":"2.0.0"}',
  };
  posts: { url: string; body: Record<string, unknown> }[] = [];

  get snapshot(): DeckBranchSnapshot {
    let files = Object.fromEntries(
      Object.entries(this.content).map(([path, bytes]) => [
        path,
        hashWorkspaceBytes(bytes),
      ]),
    );
    return {
      schema: DECK_BRANCH_OBSERVATION_SPEC,
      realmRRI: '@acme/kit/',
      branchId: '@acme/kit/:main',
      branchName: 'main',
      repositoryHash: hashWorkspaceBytes('repository:2'),
      treeHash: inventoryTreeHash(files),
      lockHash: hashWorkspaceBytes('lock'),
      refGeneration: 2,
      checkpointHash: null,
      files,
    };
  }

  async authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let request = new Request(input, init);
    let url = new URL(request.url);
    if (url.pathname.endsWith('/.deck/branch')) {
      return Response.json(this.snapshot);
    }
    if (url.pathname.endsWith('/.deck/tree-file')) {
      let value = this.content[url.searchParams.get('path')!];
      return value === undefined
        ? new Response('not found', { status: 404 })
        : new Response(value);
    }
    if (url.pathname.endsWith('/.deck/capabilities')) {
      return Response.json({
        deckCollaboration: true,
        realmRRI: '@acme/kit/',
        packageRRI: '@acme/kit/',
        packages: { '@acme/kit/': REALM_URL, '@acme/button/': BUTTON_URL },
      });
    }
    if (url.pathname.endsWith('/.deck/versions') && request.method === 'POST') {
      let body = (await request.json()) as Record<string, unknown>;
      this.posts.push({ url: url.href, body });
      let root = url.href.slice(0, url.href.indexOf('.deck/versions'));
      let packageRRI = root === BUTTON_URL ? '@acme/button/' : '@acme/kit/';
      let version = root === BUTTON_URL ? '2.0.0' : '1.2.0';
      return Response.json(
        {
          versionRRI: `${packageRRI.slice(0, -1)}@${version}/`,
          packageRRI,
          version,
          checkpointHash: hashWorkspaceBytes('checkpoint'),
          repositoryHash: this.snapshot.repositoryHash,
          treeHash: hashWorkspaceBytes(`tree:${packageRRI}`),
          indexHash: hashWorkspaceBytes('index'),
          lockHash: this.snapshot.lockHash,
          schema: 'boxel-deck-version-origin-v1',
        },
        { status: 201 },
      );
    }
    return new Response('not found', { status: 404 });
  }
}

async function workspace(realm: VersionRealm): Promise<string> {
  let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-version-'));
  let result = await pullDeckBranch({
    realmURL: REALM_URL,
    branchName: 'main',
    localDir,
    authenticator: realm,
  });
  if (result.error) throw new Error(result.error);
  return localDir;
}

describe('Deck Version cutting', () => {
  it("cuts the realm's own package from a realm URL", async () => {
    let realm = new VersionRealm();
    let cut = await cutDeckRealmVersion({
      realmURL: REALM_URL,
      branchName: 'main',
      authenticator: realm,
    });

    expect(cut.versionRRI).toBe('@acme/kit@1.2.0/');
    expect(realm.posts).toEqual([
      {
        url: `${REALM_URL}.deck/versions?branch=main`,
        body: { schema: 'boxel-deck-version-cut-v1' },
      },
    ]);
  });

  it('cuts a hosted package at the root the realm lists for it', async () => {
    let realm = new VersionRealm();
    let cut = await cutDeckRealmVersion({
      realmURL: REALM_URL,
      branchName: 'main',
      authenticator: realm,
      packageRRI: '@acme/button',
      version: '2.0.0',
    });

    expect(cut.versionRRI).toBe('@acme/button@2.0.0/');
    expect(realm.posts[0].url).toBe(`${BUTTON_URL}.deck/versions?branch=main`);
    expect(realm.posts[0].body.version).toBe('2.0.0');
  });

  it('names the exact head a clean workspace observed', async () => {
    let realm = new VersionRealm();
    let localDir = await workspace(realm);

    await cutDeckRealmVersion({
      realmURL: REALM_URL,
      branchName: 'main',
      authenticator: realm,
      localDir,
    });

    expect(realm.posts[0].body.expectedRepositoryHash).toBe(
      realm.snapshot.repositoryHash,
    );
  });

  it('cuts nothing from a workspace with unsaved work', async () => {
    let realm = new VersionRealm();
    let localDir = await workspace(realm);
    await writeFile(join(localDir, 'importmap.json'), '{"imports":{"x":"y"}}');

    await expect(
      cutDeckRealmVersion({
        realmURL: REALM_URL,
        branchName: 'main',
        authenticator: realm,
        localDir,
      }),
    ).rejects.toThrow(/clean workspace/);
    expect(realm.posts).toEqual([]);
  });
});
