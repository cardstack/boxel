import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createDeckRealmBranch,
  listDeckRealmBranches,
  switchDeckRealmBranch,
} from '../../src/lib/deck-realm-branches.ts';
import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

function snapshot(
  branchName: string,
  content: Record<string, string>,
): DeckBranchSnapshot {
  let files = Object.fromEntries(
    Object.entries(content).map(([path, bytes]) => [
      path,
      hashWorkspaceBytes(bytes),
    ]),
  );
  return {
    schema: DECK_BRANCH_OBSERVATION_SPEC,
    realmRRI: '@cardstack/pretui/',
    branchId: `@cardstack/pretui/:${branchName}`,
    branchName,
    repositoryHash: hashWorkspaceBytes(`repository:${branchName}`),
    treeHash: inventoryTreeHash(files),
    lockHash: hashWorkspaceBytes('lock'),
    historyHead: `step-${branchName}`,
    indexGenerationHash: hashWorkspaceBytes(`index:${branchName}`),
    refGeneration: 1,
    checkpointHash: null,
    files,
  };
}

function remote(options: {
  branches?: unknown;
  create?: unknown;
  snapshots?: Record<string, DeckBranchSnapshot>;
  content?: Record<string, string>;
  requests?: { url: string; init?: RequestInit }[];
}): RealmAuthenticator {
  return {
    async authedRealmFetch(input, init) {
      let url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      options.requests?.push({ url: url.href, init });
      if (url.pathname.endsWith('/.deck/branches')) {
        return new Response(
          JSON.stringify(
            init?.method === 'POST' ? options.create : options.branches,
          ),
        );
      }
      if (url.pathname.endsWith('/.deck/branch')) {
        let branch = options.snapshots?.[url.searchParams.get('name') ?? ''];
        return branch
          ? new Response(JSON.stringify(branch))
          : new Response('not found', { status: 404 });
      }
      if (url.pathname.endsWith('/.deck/tree-file')) {
        let path = url.searchParams.get('path')!;
        let bytes = options.content?.[path];
        return bytes === undefined
          ? new Response('not found', { status: 404 })
          : new Response(bytes);
      }
      return new Response('not found', { status: 404 });
    },
  };
}

describe('Deck Realm branches', () => {
  it('lists and creates branches through the plural Realm endpoint', async () => {
    let branch = snapshot('ana/button-tone', { 'button.gts': 'violet' });
    let list = {
      schema: 'boxel-deck-branch-list-v1',
      realmRRI: '@cardstack/pretui/',
      branches: [
        {
          branchName: branch.branchName,
          repositoryHash: branch.repositoryHash,
          historyHead: branch.historyHead,
          indexGenerationHash: branch.indexGenerationHash,
          refGeneration: branch.refGeneration,
        },
      ],
    } as const;
    let created = {
      schema: 'boxel-deck-branch-create-result-v1',
      realmRRI: branch.realmRRI,
      branchName: branch.branchName,
      fromBranch: 'main',
      repositoryHash: branch.repositoryHash,
      treeHash: branch.treeHash,
      historyHead: branch.historyHead,
      indexGenerationHash: branch.indexGenerationHash,
      refGeneration: branch.refGeneration,
    } as const;
    let requests: { url: string; init?: RequestInit }[] = [];
    let authenticator = remote({ branches: list, create: created, requests });

    await expect(
      listDeckRealmBranches({
        realmURL: 'https://realm.example/pretui/',
        authenticator,
      }),
    ).resolves.toEqual(list);
    await expect(
      createDeckRealmBranch({
        realmURL: 'https://realm.example/pretui/',
        branchName: 'ana/button-tone',
        fromBranch: 'main',
        authenticator,
      }),
    ).resolves.toEqual(created);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/pretui/.deck/branches',
      '/pretui/.deck/branches',
    ]);
    expect(JSON.parse(requests[1].init?.body as string)).toEqual({
      schema: 'boxel-deck-branch-create-v1',
      branchName: 'ana/button-tone',
      fromBranch: 'main',
    });
  });

  it('switches a clean workspace by exact content and updates its branch base', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-branch-switch-'));
    let mainContent = {
      'button.gts': 'blue',
      'main-only.gts': 'remove me',
    };
    let branchContent = {
      'button.gts': 'violet',
      'branch-only.gts': 'new',
    };
    let main = snapshot('main', mainContent);
    let branch = snapshot('ana/button-tone', branchContent);
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: remote({
        snapshots: { main },
        content: mainContent,
      }),
    });

    let result = await switchDeckRealmBranch({
      localDir,
      branchName: branch.branchName,
      authenticator: remote({
        snapshots: { [branch.branchName]: branch },
        content: branchContent,
      }),
    });

    expect(result.written).toEqual(['branch-only.gts', 'button.gts']);
    expect(result.deleted).toEqual(['main-only.gts']);
    expect(await readFile(join(localDir, 'button.gts'), 'utf8')).toBe('violet');
    await expect(readFile(join(localDir, 'main-only.gts'))).rejects.toThrow(
      /ENOENT/,
    );
    expect(await loadDeckWorkspaceState(localDir)).toMatchObject({
      branchName: 'ana/button-tone',
      baseTreeHash: branch.treeHash,
    });
  });

  it('refuses to switch over unpushed local work', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-dirty-switch-'));
    let mainContent = { 'button.gts': 'blue' };
    let main = snapshot('main', mainContent);
    let authenticator = remote({ snapshots: { main }, content: mainContent });
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator,
    });
    await writeFile(join(localDir, 'button.gts'), 'unfinished local work');

    await expect(
      switchDeckRealmBranch({
        localDir,
        branchName: 'ana/button-tone',
        authenticator,
      }),
    ).rejects.toThrow(/unpushed changes on main/);
    expect(await readFile(join(localDir, 'button.gts'), 'utf8')).toBe(
      'unfinished local work',
    );
  });
});
