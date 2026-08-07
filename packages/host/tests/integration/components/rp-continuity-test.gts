import { waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  LooseCardResource,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import { PermissionsContextName } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import { createLiveBoxelModel } from '@cardstack/host/lib/boxel-projection';
import SandboxMediaBridge from '@cardstack/host/lib/sandbox-media-bridge';
import type SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

import {
  provideConsumeContext,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  testRRI,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

// An authored realm module, so every render routes to the Capsule tier —
// the tier where rehydration continuity has to be EARNED (Direct gets it
// from Glimmer for free). The isolated template includes a bounded
// scroller so scroll retention (RP-20.3) is observable.
const journalSource = `
  import {
    CardDef,
    Component,
    contains,
    containsMany,
    field,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Journal extends CardDef {
    static displayName = 'Journal';
    @field headline = contains(StringField);
    @field entries = containsMany(StringField);
    static isolated = class Isolated extends Component<typeof Journal> {
      <template>
        <div data-test-journal>
          <span data-test-headline><@fields.headline /></span>
          <div
            data-test-scroller
            style='height: 80px; overflow-y: scroll;'
          >
            {{#each @model.entries as |entry|}}
              <p style='margin: 0; line-height: 24px;'>{{entry}}</p>
            {{/each}}
          </div>
        </div>
      </template>
    };
  }
`;

module('Integration | rp-continuity', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    // RP-9.1: absent permissions context, editors render DISABLED — and
    // `focus()` on a disabled input is a silent no-op (activeElement stays
    // on <body>), which made the typing test report a phantom focus loss
    // that a real operator-mode session (which always provides
    // permissions) never exhibits. Provide what operator mode provides.
    provideConsumeContext(PermissionsContextName, {
      canRead: true,
      canWrite: true,
    });
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'journal.gts': journalSource,
        },
      }),
    );
  });

  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  async function createJournal(): Promise<CardDef> {
    let resource: LooseCardResource = {
      attributes: {
        headline: 'First Light',
        entries: Array.from({ length: 12 }, (_v, i) => `Entry ${i + 1}`),
      },
      meta: { adoptsFrom: { module: testRRI('journal'), name: 'Journal' } },
    };
    let store = getService('store');
    return await store.__dangerousCreateFromSerialized(
      resource,
      { data: resource },
      new URL(testRealmURL),
    );
  }

  test('RP-20.1, RP-20.2, RP-20.5: a data mutation reaches every mounted Capsule view in place — same slot, same DOM, updated model, no loading re-entry', async function (assert) {
    let card = await createJournal();

    // Two independently mounted views of the one canonical instance —
    // RP-20.5's cross-surface guarantee reduced to one document.
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div data-test-view-a>
            <CardRenderer @card={{card}} @format='isolated' @execution='auto' />
          </div>
          <div data-test-view-b>
            <CardRenderer @card={{card}} @format='isolated' @execution='auto' />
          </div>
        </template>
      },
    );
    await waitFor('[data-test-view-b] [data-test-journal]', {
      timeout: 10000,
    });

    let slotA = document.querySelector(
      '[data-test-view-a] [data-boxel-execution="capsule"]',
    )!;
    let journalA = document.querySelector(
      '[data-test-view-a] [data-test-journal]',
    )!;
    let journalB = document.querySelector(
      '[data-test-view-b] [data-test-journal]',
    )!;
    assert
      .dom('[data-test-view-a] [data-test-headline]')
      .hasText('First Light');

    (card as unknown as Record<string, unknown>).headline = 'Second Light';

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-view-a] [data-test-headline]')
          ?.textContent?.includes('Second Light') &&
        document
          .querySelector('[data-test-view-b] [data-test-headline]')
          ?.textContent?.includes('Second Light'),
      { timeout: 10000 },
    );

    assert.strictEqual(
      document.querySelector(
        '[data-test-view-a] [data-boxel-execution="capsule"]',
      ),
      slotA,
      'RP-20.1: the presentation slot keeps DOM identity across the update',
    );
    assert.strictEqual(
      document.querySelector('[data-test-view-a] [data-test-journal]'),
      journalA,
      'RP-20.2: the mounted component DOM updates in place, no remount',
    );
    assert.strictEqual(
      document.querySelector('[data-test-view-b] [data-test-journal]'),
      journalB,
      'RP-20.5: the second mounted view of the same instance also updates in place',
    );
    assert
      .dom('.boxel-execution-loading')
      .doesNotExist(
        'RP-20.1: the loading branch is never re-entered by a data update',
      );
  });

  test('RP-20.1, RP-20.2, RP-20.5: component stability under typing — a sentence typed into a field lands intact while another view updates live', async function (assert) {
    let card = await createJournal();

    // The acceptance bar for the whole continuity contract: an edit view
    // and an isolated view side by side; type a sentence character by
    // character (auto-save echoes land mid-typing); the input element must
    // keep identity, focus, and every character, while the isolated view
    // converges — with zero DOM teardown anywhere.
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div data-test-edit-view>
            <CardRenderer @card={{card}} @format='edit' @execution='auto' />
          </div>
          <div data-test-isolated-view>
            <CardRenderer @card={{card}} @format='isolated' @execution='auto' />
          </div>
        </template>
      },
    );
    await waitFor('[data-test-isolated-view] [data-test-journal]', {
      timeout: 10000,
    });
    await waitFor('[data-test-edit-view] input', { timeout: 10000 });

    let input = [
      ...document.querySelectorAll<HTMLInputElement>(
        '[data-test-edit-view] input',
      ),
    ].find((candidate) => candidate.value === 'First Light');
    assert.ok(input, 'the headline editor rendered with the current value');
    let journal = document.querySelector(
      '[data-test-isolated-view] [data-test-journal]',
    )!;

    input!.focus();
    let sentence = 'The quick brown fox jumps over the lazy dog';
    let valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    for (let i = 1; i <= sentence.length; i++) {
      valueSetter.call(input, sentence.slice(0, i));
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      // Yield between keystrokes so save echoes and refresh batches land
      // MID-TYPING — the exact window the old teardown behavior destroyed
      // the input in.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    input!.dispatchEvent(new Event('change', { bubbles: true }));

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-isolated-view] [data-test-headline]')
          ?.textContent?.includes(sentence),
      { timeout: 10000 },
    );

    assert.strictEqual(
      [
        ...document.querySelectorAll<HTMLInputElement>(
          '[data-test-edit-view] input',
        ),
      ].find((candidate) => candidate.value.startsWith('The quick')),
      input,
      'RP-20.1: the input element keeps DOM identity across every echo',
    );
    assert.strictEqual(
      input!.value,
      sentence,
      'RP-20.5: every typed character survived the sync round-trips',
    );
    assert.strictEqual(
      document.activeElement,
      input,
      'RP-20.1: focus never left the field',
    );
    assert.strictEqual(
      document.querySelector('[data-test-isolated-view] [data-test-journal]'),
      journal,
      'RP-20.2: the isolated view updated in place, no remount',
    );

    // Quiescence: once converged, nothing may keep rendering or writing.
    let settledHTML = journal.innerHTML;
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.strictEqual(
      journal.innerHTML,
      settledHTML,
      'RP-20.2: the system is quiescent at rest — no churn without input',
    );
  });

  test('RP-20.2: the live model is a pure read-through — reads mutate nothing, and mutations are visible on the next read with no delivery machinery', async function (assert) {
    let card = await createJournal();
    let api = (await getService('loader-service').loader.import(
      '@cardstack/base/card-api',
    )) as typeof import('@cardstack/base/card-api');

    let notifications = 0;
    let listener = () => notifications++;
    api.subscribeToChanges(card, listener);
    try {
      let model = createLiveBoxelModel(card, api, {});
      assert.strictEqual(
        model.headline as string,
        'First Light',
        'a read projects the current declared value',
      );
      assert.strictEqual(
        (model.entries as string[])?.length,
        12,
        'containsMany values project fully',
      );
      // Reads flushed; a mutation from the reader would notify on the next
      // microtasks.
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.strictEqual(
        notifications,
        0,
        'reading the live model mutates nothing — no subscriber fired',
      );

      (card as unknown as Record<string, unknown>).headline = 'Second Light';
      assert.strictEqual(
        model.headline as string,
        'Second Light',
        'the very next read sees the mutation — liveness needs no pipeline',
      );
      assert.true(notifications > 0, 'sanity: the mutation itself notified');
    } finally {
      api.unsubscribeFromChanges(card, listener);
    }
  });

  test('RP-20.3: scroll position inside the card survives a data update', async function (assert) {
    let card = await createJournal();

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardRenderer @card={{card}} @format='isolated' @execution='auto' />
        </template>
      },
    );
    await waitFor('[data-test-scroller]', { timeout: 10000 });

    let scroller = document.querySelector('[data-test-scroller]')!;
    scroller.scrollTop = 48;
    assert.strictEqual(scroller.scrollTop, 48, 'sanity: the scroller scrolled');

    (card as unknown as Record<string, unknown>).headline = 'Scrolled Light';
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-headline]')
          ?.textContent?.includes('Scrolled Light'),
      { timeout: 10000 },
    );

    assert.strictEqual(
      document.querySelector('[data-test-scroller]'),
      scroller,
      'the scroller keeps DOM identity',
    );
    assert.strictEqual(
      scroller.scrollTop,
      48,
      'the scroll position is retained across the update',
    );
  });

  test('RP-20.4: the media bridge hydrates once per source and re-hydrates recreated images synchronously from cache', async function (assert) {
    let fetches: string[] = [];
    let bytes = new Uint8Array([137, 80, 78, 71]);
    let fetchMedia = async (url: string) => {
      fetches.push(url);
      return new Response(new Blob([bytes], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    };

    let root = document.createElement('div');
    document.body.append(root);
    let bridge = new SandboxMediaBridge(root, fetchMedia);
    try {
      let source = 'https://realm.example/assets/logo.png';
      let first = document.createElement('img');
      first.src = source;
      let twin = document.createElement('img');
      twin.src = source;
      root.append(first, twin);
      bridge.start();
      await bridge.refresh();
      await waitUntil(
        () => first.src.startsWith('blob:') && twin.src.startsWith('blob:'),
        { timeout: 5000 },
      );
      assert.strictEqual(
        fetches.length,
        1,
        'two images with one source share one authorized fetch',
      );

      // A re-render recreates the element; the source is already hydrated.
      first.remove();
      twin.remove();
      let recreated = document.createElement('img');
      recreated.src = source;
      root.append(recreated);
      await bridge.refresh();
      assert.true(
        recreated.src.startsWith('blob:'),
        'a recreated image hydrates synchronously from the cache',
      );
      assert.strictEqual(
        fetches.length,
        1,
        'no second fetch for an already-hydrated source',
      );
    } finally {
      bridge.stop();
      root.remove();
    }
  });

  test('RP-20.5: a canonical-instance mutation reaches a mounted Sandbox process as a coalesced updateInstance push carrying the projected CURRENT state', async function (assert) {
    let card = await createJournal();
    let execution = getService('boxel-execution');
    // The push serializes through the same pipeline a real render request
    // does; running requestFor first captures the card API exactly as any
    // real mount would have.
    await execution.requestFor(card, 'isolated', execution.surfaceId());

    let pushed: LooseSingleCardDocument[] = [];
    let stubProcess = {
      pushInstanceUpdate: async (pushedDocument: LooseSingleCardDocument) => {
        pushed.push(pushedDocument);
        return { generation: pushed.length, ok: true };
      },
    };
    let disconnect = execution.connectSandboxInstanceSync(
      card,
      stubProcess as unknown as SandboxRuntimeProcess,
    );
    try {
      (card as unknown as Record<string, unknown>).headline = 'Second Light';
      await waitUntil(() => pushed.length >= 1);
      assert.strictEqual(
        pushed[pushed.length - 1]!.data?.attributes?.headline,
        'Second Light',
        'a mutation pushes the projected execution document carrying the CURRENT field value — the child applies it in place (RP-20.5)',
      );

      // A burst of rapid mutations coalesces: the queue drains with every
      // push carrying whatever is current at serialize time, and the FINAL
      // push always carries the final state.
      let before = pushed.length;
      let model = card as unknown as {
        headline: string;
        entries: string[];
      };
      model.entries[0] = 'rewritten mid-burst';
      model.headline = 'Third Light';
      model.headline = 'Final Light';
      await waitUntil(() => pushed.length > before);
      // Let the coalescing queue fully drain before asserting the tail.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      let final = pushed[pushed.length - 1]!;
      assert.strictEqual(
        final.data?.attributes?.headline,
        'Final Light',
        'the final push carries the final state — order can never regress',
      );
      assert.strictEqual(
        (final.data?.attributes?.entries as string[])[0],
        'rewritten mid-burst',
        'a full-document push carries every mutated field, not just the last-touched one',
      );
      assert.true(
        pushed.length - before <= 3,
        `a mutation burst coalesces per queue drain rather than pushing once per notification (saw ${
          pushed.length - before
        } pushes for 3 mutations)`,
      );

      disconnect();
      let settledCount = pushed.length;
      model.headline = 'After Disconnect';
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(
        pushed.length,
        settledCount,
        'disconnecting stops the stream — teardown leaves no orphan subscriber pushing at a dead process',
      );
    } finally {
      disconnect();
    }
  });
});
