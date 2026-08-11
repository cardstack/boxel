import { module, test } from 'qunit';

import {
  CapsuleContextProjector,
  projectCapsuleContext,
} from '@cardstack/host/lib/capsule-context-projection';
import {
  SandboxFetchClient,
  SandboxFetchServer,
} from '@cardstack/host/lib/sandbox-fetch-transport';

import type { CardContext } from '@cardstack/base/card-api';

module('Unit | rp-entitlement (RP-21)', function () {
  test('RP-21.1, RP-21.2: the Capsule @context projection carries exactly the enumerated presentation keys — no store, loader, or data-bearing authority rides a boundary crossing', function (assert) {
    // A deliberately fat host context: every data-authority-shaped key an
    // attacker would want to ride along. The projection must pluck ONLY the
    // two presentation surfaces, regardless of what the host side holds.
    let tracker = () => {};
    let searchSurface = { name: 'search-results-surface' };
    let fatContext = {
      cardComponentModifier: tracker,
      searchResultsComponent: searchSurface,
      // ambient-authority shapes that must never cross:
      getCard: () => {},
      getCards: () => {},
      getCardCollection: () => {},
      store: { peek: () => {} },
      loader: { import: () => {} },
      commandContext: {},
      actions: { createCard: () => {}, deleteCard: () => {} },
      prerenderedCardSearchComponent: {},
    } as unknown as CardContext;

    let projected = projectCapsuleContext(fatContext) as Record<
      string,
      unknown
    >;
    assert.deepEqual(
      Object.keys(projected).sort(),
      ['cardComponentModifier', 'searchResultsComponent'],
      'exactly the enumerated presentation keys — nothing else, however fat the host context',
    );
    assert.strictEqual(projected.cardComponentModifier, tracker);
    assert.strictEqual(projected.searchResultsComponent, searchSurface);
    assert.true(
      Object.isFrozen(projected),
      'the projection is frozen — authored code cannot graft authority onto it',
    );

    assert.strictEqual(
      projectCapsuleContext(undefined),
      undefined,
      'no host context projects to no context — never a fabricated one',
    );
  });

  test('RP-21.1: Capsule context projection stays stable until a projected capability changes', function (assert) {
    let projector = new CapsuleContextProjector();
    let tracker = () => {};
    let searchSurface = { name: 'search-results-surface' };
    let first = projector.project({
      cardComponentModifier: tracker,
      searchResultsComponent: searchSurface,
    } as unknown as CardContext);
    let equivalentWrapper = projector.project({
      cardComponentModifier: tracker,
      searchResultsComponent: searchSurface,
      store: { unrelated: true },
    } as unknown as CardContext);

    assert.strictEqual(
      equivalentWrapper,
      first,
      'a fresh provider wrapper with the same projected capabilities reuses the facade',
    );
    assert.notStrictEqual(
      projector.project({
        cardComponentModifier: () => {},
        searchResultsComponent: searchSurface,
      } as unknown as CardContext),
      first,
      'changing a projected capability creates a fresh facade',
    );
  });

  test('RP-21.3: a read outside the entitled graph refuses with a self-naming reason — never silence, never plausible-but-empty output', async function (assert) {
    let channel = new MessageChannel();
    let hostFetches = 0;
    let server = new SandboxFetchServer(
      channel.port1,
      async () => {
        hostFetches++;
        return new Response('secret');
      },
      // Nothing is entitled: every read must refuse.
      () => false,
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      let caught: unknown;
      try {
        await client.fetch('https://realm.example/contacts.gts');
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error, 'the read rejected');
      let refusal = (caught as Error).message;
      assert.true(
        refusal.includes('outside its classified graph'),
        `the refusal names itself (saw: ${refusal})`,
      );
      assert.true(
        refusal.includes('contacts.gts'),
        'the refusal names the refused URL',
      );
      assert.strictEqual(
        hostFetches,
        0,
        'the refusal happened BEFORE any host-credentialed fetch — the gate is pre-authorization, not post-filtering',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
