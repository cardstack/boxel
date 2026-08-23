import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readDeckHistory,
  restoreDeckHistory,
} from '../../src/lib/deck-realm-history.ts';
import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

const REALM_URL = 'https://realm.example/pretui/';

function branch(
  content: Record<string, string>,
  generation: number,
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
    branchId: '@cardstack/pretui/:main',
    branchName: 'main',
    repositoryHash: hashWorkspaceBytes(`repository:${generation}`),
    treeHash: inventoryTreeHash(files),
    lockHash: hashWorkspaceBytes('lock'),
    historyHead: `step${generation}`,
    indexGenerationHash: hashWorkspaceBytes(`index:${generation}`),
    refGeneration: generation,
    checkpointHash: null,
    files,
  };
}

class HistoryRealm implements RealmAuthenticator {
  content: Record<string, string> = {
    'importmap.json': '{"imports":{}}',
    'theme/tokens.json': 'theme v2',
  };
  snapshot = branch(this.content, 2);
  restorePosts = 0;

  async authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let request = new Request(input, init);
    let url = new URL(request.url);
    if (url.pathname.endsWith('/.deck/branch')) {
      return new Response(JSON.stringify(this.snapshot));
    }
    if (url.pathname.endsWith('/.deck/tree-file')) {
      let value = this.content[url.searchParams.get('path')!];
      return value === undefined
        ? new Response('not found', { status: 404 })
        : new Response(value);
    }
    if (url.pathname.endsWith('/.deck/history') && request.method === 'GET') {
      return Response.json({
        branch: 'main',
        historyHead: 'step2',
        entries: [
          {
            changeId: 'step2',
            commitId: hashWorkspaceBytes('commit:2'),
            timestamp: '2026-08-23T08:02:00.000Z',
            description: 'save: theme/tokens.json',
            filesSummary: ['theme/tokens.json'],
            author: 'Mina',
          },
          {
            changeId: 'step1',
            commitId: hashWorkspaceBytes('commit:1'),
            timestamp: '2026-08-23T08:01:00.000Z',
            description: 'History baseline',
            filesSummary: ['importmap.json', 'theme/tokens.json'],
          },
        ],
      });
    }
    if (url.pathname.endsWith('/.deck/history') && request.method === 'POST') {
      this.restorePosts++;
      let body = (await request.json()) as {
        revisionId: string;
        expected: { refGeneration: number };
      };
      if (
        body.revisionId !== 'step1' ||
        body.expected.refGeneration !== this.snapshot.refGeneration
      ) {
        return new Response('moved', { status: 409 });
      }
      this.content = {
        'importmap.json': '{"imports":{}}',
        'theme/tokens.json': 'theme v1',
      };
      this.snapshot = branch(this.content, 3);
      return Response.json({
        schema: 'boxel-deck-history-restore-result-v1',
        restored: 'step1',
        historyHead: 'step3',
        refGeneration: 3,
      });
    }
    return new Response('not found', { status: 404 });
  }
}

async function workspace(realm: HistoryRealm): Promise<string> {
  let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-history-'));
  let result = await pullDeckBranch({
    realmURL: REALM_URL,
    branchName: 'main',
    localDir,
    authenticator: realm,
  });
  if (result.error) throw new Error(result.error);
  return localDir;
}

describe('Deck branch History', () => {
  it('reads attributed automatic Steps from the canonical realm', async () => {
    let realm = new HistoryRealm();
    let history = await readDeckHistory({
      realmURL: REALM_URL,
      branchName: 'main',
      authenticator: realm,
      limit: 10,
    });

    expect(history.historyHead).toBe('step2');
    expect(history.entries.map(({ changeId }) => changeId)).toEqual([
      'step2',
      'step1',
    ]);
    expect(history.entries[0].author).toBe('Mina');
  });

  it('restores forward and refreshes the exact clean local workspace', async () => {
    let realm = new HistoryRealm();
    let localDir = await workspace(realm);

    let restored = await restoreDeckHistory({
      realmURL: REALM_URL,
      branchName: 'main',
      revisionId: 'step1',
      authenticator: realm,
      localDir,
    });

    expect(restored).toEqual({
      restored: 'step1',
      historyHead: 'step3',
      refGeneration: 3,
    });
    expect(await readFile(join(localDir, 'theme/tokens.json'), 'utf8')).toBe(
      'theme v1',
    );
    expect(
      (await loadDeckWorkspaceState(localDir))?.observedRefGeneration,
    ).toBe(3);
  });

  it('does not mutate the realm when the local workspace has unsaved work', async () => {
    let realm = new HistoryRealm();
    let localDir = await workspace(realm);
    await writeFile(join(localDir, 'theme/tokens.json'), 'my unsaved theme');

    await expect(
      restoreDeckHistory({
        realmURL: REALM_URL,
        branchName: 'main',
        revisionId: 'step1',
        authenticator: realm,
        localDir,
      }),
    ).rejects.toThrow(/clean local workspace/);
    expect(realm.restorePosts).toBe(0);
    expect(realm.content['theme/tokens.json']).toBe('theme v2');
  });
});
