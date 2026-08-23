import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  listDeckRealmReviews,
  mergeDeckRealmReview,
  openDeckWorkspaceReview,
  readDeckRealmReview,
} from '../../src/lib/deck-realm-reviews.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  saveDeckWorkspaceState,
  workspaceStateFromBranch,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';

function hash(label: string) {
  return hashWorkspaceBytes(label);
}

function branch(
  name: string,
  options: {
    treeHash: string;
    files: Record<string, string>;
    checkpoint: string;
  },
): DeckBranchSnapshot {
  return {
    schema: DECK_BRANCH_OBSERVATION_SPEC,
    realmRRI: '@cardstack/pretui/',
    branchId: `@cardstack/pretui/:${name}`,
    branchName: name,
    repositoryHash: hash(`repository:${name}`),
    treeHash: options.treeHash,
    lockHash: hash(`lock:${name}`),
    historyHead: `jj:${name}`,
    indexGenerationHash: hash(`index:${name}`),
    refGeneration: 3,
    checkpointHash: options.checkpoint,
    files: options.files,
  };
}

function review(source: DeckBranchSnapshot, target: DeckBranchSnapshot) {
  let snapshot = (value: DeckBranchSnapshot) => ({
    branch: value.branchName,
    checkpointHash: value.checkpointHash,
    repositoryHash: value.repositoryHash,
    treeHash: value.treeHash,
    lockHash: value.lockHash,
    historyHead: value.historyHead,
    indexGenerationHash: value.indexGenerationHash,
  });
  return {
    schema: 'boxel-deck-review-v1',
    number: 7,
    state: 'open',
    generation: 1,
    title: 'Visible focus',
    body: 'Make keyboard focus obvious.',
    author: { id: '@mina:boxel.test' },
    createdAt: '2026-08-23T16:00:00.000Z',
    base: snapshot(target),
    target: snapshot(target),
    source: snapshot(source),
    events: [],
  };
}

describe('Deck Realm Reviews', () => {
  it('opens a Review from one clean exact workspace Checkpoint', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-review-'));
    let content = 'export const focus = "visible";\n';
    await writeFile(join(localDir, 'focus-ring.gts'), content);
    let files = { 'focus-ring.gts': hashWorkspaceBytes(content) };
    let source = branch('mina/focus-ring', {
      files,
      treeHash: inventoryTreeHash(files),
      checkpoint: hash('source-checkpoint'),
    });
    let targetFiles = { 'focus-ring.gts': hash('old-focus') };
    let target = branch('main', {
      files: targetFiles,
      treeHash: inventoryTreeHash(targetFiles),
      checkpoint: hash('target-checkpoint'),
    });
    await saveDeckWorkspaceState(
      localDir,
      workspaceStateFromBranch('https://realm.example/pretui/', source),
    );
    let requests: Request[] = [];
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(input, init) {
        let request = new Request(input, init);
        requests.push(request);
        let url = new URL(request.url);
        if (url.pathname.endsWith('/.deck/branch')) {
          return Response.json(
            url.searchParams.get('name') === source.branchName
              ? source
              : target,
          );
        }
        return Response.json(review(source, target), { status: 201 });
      },
    };

    let opened = await openDeckWorkspaceReview({
      localDir,
      targetBranch: 'main',
      title: 'Visible focus',
      body: 'Make keyboard focus obvious.',
      authenticator,
    });

    expect(opened.number).toBe(7);
    expect(requests).toHaveLength(3);
    expect(await requests[2].json()).toEqual({
      schema: 'boxel-deck-review-open-v1',
      sourceBranch: 'mina/focus-ring',
      targetBranch: 'main',
      expected: {
        sourceCheckpointHash: source.checkpointHash,
        targetCheckpointHash: target.checkpointHash,
      },
      title: 'Visible focus',
      body: 'Make keyboard focus obvious.',
    });
  });

  it('reads one Review and lists the Review queue', async () => {
    let files = { 'focus-ring.gts': hash('focus') };
    let source = branch('mina/focus-ring', {
      files,
      treeHash: inventoryTreeHash(files),
      checkpoint: hash('source'),
    });
    let target = branch('main', {
      files,
      treeHash: inventoryTreeHash(files),
      checkpoint: hash('target'),
    });
    let value = review(source, target);
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(input) {
        return new URL(new Request(input).url).pathname.endsWith(
          '/.deck/reviews',
        )
          ? Response.json({
              schema: 'boxel-deck-review-list-v1',
              realmRRI: '@cardstack/pretui/',
              reviews: [value],
            })
          : Response.json(value);
      },
    };

    await expect(
      listDeckRealmReviews({
        realmURL: 'https://realm.example/pretui/',
        authenticator,
      }),
    ).resolves.toMatchObject({ reviews: [{ number: 7 }] });
    await expect(
      readDeckRealmReview({
        realmURL: 'https://realm.example/pretui/',
        number: 7,
        authenticator,
      }),
    ).resolves.toMatchObject({
      number: 7,
      source: { branch: 'mina/focus-ring' },
    });
  });

  it('conditionally merges the observed Review into the exact target Checkpoint', async () => {
    let files = { 'focus-ring.gts': hash('focus') };
    let source = branch('mina/focus-ring', {
      files,
      treeHash: inventoryTreeHash(files),
      checkpoint: hash('source'),
    });
    let target = branch('main', {
      files,
      treeHash: inventoryTreeHash(files),
      checkpoint: hash('target'),
    });
    let value = review(source, target);
    let requests: Request[] = [];
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(input, init) {
        let request = new Request(input, init);
        requests.push(request);
        if (request.method === 'POST') {
          return Response.json(
            {
              schema: 'boxel-deck-review-merge-result-v1',
              state: 'ready',
              review: { ...value, state: 'merged', generation: 3 },
              mergeCheckpointHash: hash('merge-checkpoint'),
              repositoryHash: hash('merge-repository'),
              treeHash: hash('merge-tree'),
              historyHead: 'jj:merge',
              indexGenerationHash: hash('merge-index'),
              targetBranch: 'main',
              refGeneration: 4,
            },
            { status: 201 },
          );
        }
        return new URL(request.url).pathname.endsWith('/.deck/branch')
          ? Response.json(target)
          : Response.json(value);
      },
    };

    await expect(
      mergeDeckRealmReview({
        realmURL: 'https://realm.example/pretui/',
        number: 7,
        message: 'Merge visible focus',
        authenticator,
      }),
    ).resolves.toMatchObject({
      state: 'ready',
      targetBranch: 'main',
      review: { state: 'merged' },
    });
    expect(await requests[2].json()).toEqual({
      schema: 'boxel-deck-review-merge-v1',
      expected: {
        reviewGeneration: 1,
        targetCheckpointHash: target.checkpointHash,
      },
      message: 'Merge visible focus',
    });
  });
});
