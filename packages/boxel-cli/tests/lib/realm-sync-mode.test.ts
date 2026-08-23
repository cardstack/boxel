import { describe, expect, it } from 'vitest';

import {
  detectRealmSyncMode,
  readDeckBranchSnapshot,
} from '../../src/lib/realm-sync-mode.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';
import {
  hashWorkspaceBytes,
  inventoryTreeHash,
} from '../../src/lib/deck-workspace-state.ts';

function authenticator(
  response: (request: Request) => Response,
): RealmAuthenticator {
  return {
    async authedRealmFetch(input, init) {
      return response(new Request(input, init));
    },
  };
}

describe('realm synchronization mode', () => {
  it('uses mtime sync for a realm without Deck or jj', async () => {
    let mode = await detectRealmSyncMode(
      'https://realm.example/legacy/',
      authenticator((request) => {
        expect(request.url).toBe(
          'https://realm.example/legacy/.deck/capabilities',
        );
        return new Response('not found', { status: 404 });
      }),
    );

    expect(mode).toEqual({ mode: 'legacy', sync: 'mtime', history: 'none' });
  });

  it('selects content-addressed sync and jj History as one Deck mode', async () => {
    let mode = await detectRealmSyncMode(
      'https://realm.example/pretui/',
      authenticator(
        () =>
          new Response(
            JSON.stringify({
              deckCollaboration: true,
              realmRRI: '@cardstack/pretui/',
              protocol: 'deck-r0',
              sync: 'content-addressed',
              history: 'jj',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    expect(mode).toEqual({
      mode: 'deck',
      realmRRI: '@cardstack/pretui/',
      protocol: 'deck-r0',
      sync: 'content-addressed',
      history: 'jj',
    });
  });

  it('does not downgrade an auth failure to legacy mtime sync', async () => {
    await expect(
      detectRealmSyncMode(
        'https://realm.example/private-pretui/',
        authenticator(() => new Response('unauthorized', { status: 401 })),
      ),
    ).rejects.toThrow('Could not determine realm sync mode: 401');
  });

  it('refuses partial or unknown Deck capability shapes', async () => {
    await expect(
      detectRealmSyncMode(
        'https://realm.example/pretui/',
        authenticator(
          () =>
            new Response(
              JSON.stringify({
                deckCollaboration: true,
                realmRRI: '@cardstack/pretui/',
                sync: 'content-addressed',
              }),
            ),
        ),
      ),
    ).rejects.toThrow('unsupported Deck capability');
  });

  it('reads and verifies an exact branch inventory', async () => {
    let files = { 'controls/known-date.gts': hashWorkspaceBytes('v1') };
    let snapshot = await readDeckBranchSnapshot(
      'https://realm.example/pretui/',
      'mina/known-date',
      authenticator((request) => {
        expect(request.url).toBe(
          'https://realm.example/pretui/.deck/branch?name=mina%2Fknown-date',
        );
        return new Response(
          JSON.stringify({
            schema: 'boxel-deck-branch-observation-v1',
            realmRRI: '@cardstack/pretui/',
            branchId: '@cardstack/pretui/:mina/known-date',
            branchName: 'mina/known-date',
            repositoryHash: hashWorkspaceBytes('repository'),
            treeHash: inventoryTreeHash(files),
            lockHash: hashWorkspaceBytes('lock'),
            refGeneration: 4,
            checkpointHash: hashWorkspaceBytes('checkpoint'),
            files,
          }),
        );
      }),
    );

    expect(snapshot.files).toEqual(files);
    expect(snapshot.refGeneration).toBe(4);
  });

  it('rejects a branch inventory whose tree hash does not match its files', async () => {
    await expect(
      readDeckBranchSnapshot(
        'https://realm.example/pretui/',
        'main',
        authenticator(
          () =>
            new Response(
              JSON.stringify({
                schema: 'boxel-deck-branch-observation-v1',
                realmRRI: '@cardstack/pretui/',
                branchId: '@cardstack/pretui/:main',
                branchName: 'main',
                repositoryHash: hashWorkspaceBytes('repository'),
                treeHash: hashWorkspaceBytes('wrong tree'),
                lockHash: hashWorkspaceBytes('lock'),
                refGeneration: 1,
                checkpointHash: null,
                files: { 'index.js': hashWorkspaceBytes('v1') },
              }),
            ),
        ),
      ),
    ).rejects.toThrow('invalid Deck branch observation');
  });
});
