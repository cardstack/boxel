import { module, test } from 'qunit';

import { REALM_VIEW_CONTEXT_SPEC } from '@cardstack/runtime-common';

import {
  DeckCollaborationUnavailableError,
  RealmViewController,
  RealmViewSelectionSupersededError,
} from '@cardstack/host/lib/realm-view-controller';
import {
  clearRealmViewSelection,
  selectedRealmView,
  selectedRealmViewForURL,
} from '@cardstack/host/lib/realm-view-selection';

const realmURL = 'https://realms.example/cardstack/pretui/';
const realmRRI = '@cardstack/pretui/';
const repositoryHash = 'a'.repeat(64);
const treeHash = 'b'.repeat(64);
const lockHash = 'c'.repeat(64);
const indexGenerationHash = 'd'.repeat(64);

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function capabilities() {
  return {
    deckCollaboration: true,
    realmRRI,
    protocol: 'deck-r0',
    sync: 'content-addressed',
    history: 'jj',
  };
}

function branch(branchName = 'ana/compact-status') {
  return {
    schema: 'boxel-deck-branch-observation-v2',
    realmRRI,
    branchName,
    repositoryHash,
    treeHash,
    lockHash,
    historyHead: 'jj-step-8',
    indexGenerationHash,
  };
}

module('Unit | Realm view controller', function (hooks) {
  hooks.afterEach(function () {
    clearRealmViewSelection();
  });

  test('a disabled Host does not probe the Realm', async function (assert) {
    let requests = 0;
    let controller = new RealmViewController({
      enabled: false,
      fetch: async () => {
        requests++;
        return response(capabilities());
      },
      rebuildHostGraph: async () => undefined,
    });

    await assert.rejects(
      controller.selectBranch(realmURL, 'ana/compact-status'),
      DeckCollaborationUnavailableError,
    );
    assert.strictEqual(requests, 0, 'feature-off is not capability probing');
  });

  test('resolves a branch to one exact view before rebuilding the Host graph', async function (assert) {
    let requests: string[] = [];
    let selectedDuringRebuild: string | undefined;
    let controller = new RealmViewController({
      enabled: true,
      fetch: async (request) => {
        requests.push(request.url);
        return request.url.includes('.deck/capabilities')
          ? response(capabilities())
          : response(branch());
      },
      rebuildHostGraph: async () => {
        selectedDuringRebuild = selectedRealmView()?.view;
      },
    });

    let exact = await controller.selectBranch(realmURL, 'ana/compact-status');

    assert.deepEqual(exact, {
      context: {
        schema: REALM_VIEW_CONTEXT_SPEC,
        realmRRI,
        branch: 'ana/compact-status',
        repositoryHash,
        treeHash,
        lockHash,
        historyHead: 'jj-step-8',
      },
      indexGenerationHash,
    });
    assert.strictEqual(selectedDuringRebuild, indexGenerationHash);
    assert.deepEqual(requests, [
      `${realmURL}.deck/capabilities`,
      `${realmURL}.deck/branch?name=ana%2Fcompact-status`,
    ]);
    assert.strictEqual(
      selectedRealmViewForURL(`${realmURL}button.gts`)?.view,
      indexGenerationHash,
    );
    assert.strictEqual(
      selectedRealmViewForURL('https://realms.example/cardstack/base/card-api'),
      undefined,
      'dependencies remain on their ordinary live view',
    );
  });

  test('404 capability means unavailable while malformed capability fails closed', async function (assert) {
    let unsupported = new RealmViewController({
      enabled: true,
      fetch: async () => new Response('Not found', { status: 404 }),
      rebuildHostGraph: async () => undefined,
    });
    await assert.rejects(
      unsupported.selectBranch(realmURL, 'main'),
      DeckCollaborationUnavailableError,
    );

    let malformed = new RealmViewController({
      enabled: true,
      fetch: async () => response({ deckCollaboration: true }),
      rebuildHostGraph: async () => undefined,
    });
    await assert.rejects(
      malformed.selectBranch(realmURL, 'main'),
      /Deck capabilities are malformed/,
    );
    assert.strictEqual(selectedRealmView(), undefined);
  });

  test('a failed graph rebuild restores the previous exact selection', async function (assert) {
    let rebuilds = 0;
    let controller = new RealmViewController({
      enabled: true,
      fetch: async (request) =>
        request.url.includes('.deck/capabilities')
          ? response(capabilities())
          : response(branch()),
      rebuildHostGraph: async () => {
        rebuilds++;
        if (rebuilds === 1) throw new Error('store reload failed');
      },
    });

    await assert.rejects(
      controller.selectBranch(realmURL, 'ana/compact-status'),
      /store reload failed/,
    );
    assert.strictEqual(selectedRealmView(), undefined);
    assert.strictEqual(rebuilds, 2, 'the live graph is restored after failure');
  });

  test('select live clears the exact selection and rebuilds once', async function (assert) {
    let rebuilds = 0;
    let controller = new RealmViewController({
      enabled: true,
      fetch: async (request) =>
        request.url.includes('.deck/capabilities')
          ? response(capabilities())
          : response(branch()),
      rebuildHostGraph: async () => {
        rebuilds++;
      },
    });
    await controller.selectBranch(realmURL, 'ana/compact-status');
    await controller.selectLive();

    assert.strictEqual(selectedRealmView(), undefined);
    assert.strictEqual(rebuilds, 2);
  });

  test('a session boundary cancels an in-flight selection before installation', async function (assert) {
    let releaseCapabilities!: () => void;
    let capabilitiesReady = new Promise<void>((resolve) => {
      releaseCapabilities = resolve;
    });
    let rebuilds = 0;
    let controller = new RealmViewController({
      enabled: true,
      fetch: async (request) => {
        if (request.url.includes('.deck/capabilities')) {
          await capabilitiesReady;
          return response(capabilities());
        }
        return response(branch());
      },
      rebuildHostGraph: async () => {
        rebuilds++;
      },
    });

    let selection = controller.selectBranch(realmURL, 'ana/compact-status');
    controller.invalidate();
    releaseCapabilities();

    await assert.rejects(selection, RealmViewSelectionSupersededError);
    assert.strictEqual(selectedRealmView(), undefined);
    assert.strictEqual(rebuilds, 0);
  });
});
