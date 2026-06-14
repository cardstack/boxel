import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  RenderAncestryContextName,
  type Permissions,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  saveCard,
  setupCardLogs,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  getDataBucket,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// ---------------------------------------------------------------------------
// Why this test is deterministic, and how it would fail WITHOUT the guard
// ---------------------------------------------------------------------------
// The card graph can be cyclic: a card embeds a linked card that links back to
// it (a -> b -> a, or a -> a). `serialize` already breaks such cycles with a
// `visited` set and `queryableValue` with a `stack`, but the Glimmer *render*
// path had no equivalent guard. A cyclic embed therefore re-nested forever:
// rendering `a` embedded `b`, which embedded `a`, which embedded `b`, ... with
// no terminal condition. That is unbounded synchronous recursion on the render
// thread (the indexer wedge these tests guard against).
//
// The fix threads a `Set<string>` of ancestor card ids down the embed path. The
// rendered card starts with an empty ancestry and renders in its requested
// format; each card on the spine then extends the set with its own id as the
// render descends into it. A field about to embed a card whose id is already on
// that spine degrades to a bounded `atom` stand-in (marked
// `data-test-render-cycle-atom`) instead of recursing into it. The cut happens
// at the FIRST re-entry of a card already on the spine — the re-entered card is
// shown as an atom and its embedded body is not rendered again, so a self-link
// (a -> a) cuts at the first embed and a mutual cycle (a -> b -> a) cuts when
// the spine returns to `a`.
//
// These tests build the cycle out of *present, already-resolved* in-memory
// links — `getDataBucket(card).set(fieldName, otherCard)` plants the linked
// card object directly into the data bucket, exactly as
// get-relationship-membership-state-test does for its cycle cases. The render
// path reads the resolved card synchronously: there is no lazy load, no 404, no
// search index, and no realm-server round trip, so the cycle reproduces the
// same way on every run with no timing dependence. The guard keys purely on the
// resolved card's `id`, so a plain `linksTo` / `linksToMany` cycle is a faithful
// reproduction.
//
// The regression signal is termination itself: `await renderCard(...)` only
// resolves if the synchronous render flush completes. Without the guard the
// embed recurses without bound and that flush never returns — the render either
// overflows the stack or hangs, and the test fails (timeout / RangeError)
// rather than asserting. With the guard, the spine re-entry degrades to an atom
// and the render completes, so the assertions below run at all. Each test then
// also asserts the *shape* of that termination (exactly one cycle-atom, on the
// re-entered card, carrying only its atom representation rather than its full
// field tree) and the final non-cyclic test proves the guard is surgical — an
// ordinary embed of a different card is untouched.

let loader: Loader;

module('Integration | render cycle guard', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  // Registers the mock Matrix session that backs the loader/store; the cards
  // here are shimmed and saved directly rather than seeded through a realm, so
  // the returned utils are not needed (mirrors get-relationship-membership-state-test).
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('singular linksTo: a mutual cycle (a -> b -> a) terminates and the re-entered card degrades to an atom', async function (assert) {
    // `Node` embeds its singular `partner` link in both isolated and embedded
    // formats. The embedded template carries a distinctive `data-test-node-body`
    // marker so a full (non-atom) render is visually distinguishable from the
    // bounded atom stand-in (the default atom template renders the title only and
    // emits no such marker). `firstName` drives the auto-computed `cardTitle`, so
    // the atom shows the node's name.
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field partner = linksTo(() => Node);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-node-body={{@model.firstName}}>
            <@fields.firstName />
            <@fields.partner @format='embedded' />
          </div>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-node-root={{@model.firstName}}>
            <@fields.partner @format='embedded' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });

    // Saving assigns each instance a stable id; the cycle is then planted as
    // present in-memory links: a.partner === b and b.partner === a.
    let a = new Node({ firstName: 'A' });
    let b = new Node({ firstName: 'B' });
    await saveCard(a, `${testRealmURL}Node/a`, loader);
    await saveCard(b, `${testRealmURL}Node/b`, loader);
    getDataBucket(a).set('partner', b);
    getDataBucket(b).set('partner', a);

    // Renders `a` isolated. Spine: a(isolated, root) -> b(embedded, full) ->
    // a is now on the spine again -> atom. Without the guard this would recurse
    // a -> b -> a -> b -> ... forever and never resolve.
    await renderCard(loader, a, 'isolated');

    // (i) The render COMPLETED — reaching this assertion at all is the core
    // regression signal (an unguarded cycle never returns from the flush). The
    // root rendered in its requested isolated format.
    assert
      .dom(`[data-test-node-root='A']`)
      .exists('the cyclic graph rendered to completion (the root is present)');

    // (ii) Exactly one embed re-enters a card already on the spine, and it
    // degrades to the bounded atom rather than recursing.
    assert
      .dom('[data-test-render-cycle-atom]')
      .exists(
        { count: 1 },
        'exactly one spine re-entry is degraded to a cycle atom',
      );
    // The re-entered card here is A: the spine returns to the root
    // (a -> b -> [a as atom]).
    assert
      .dom('[data-test-render-cycle-atom]')
      .hasAttribute(
        'data-boxel-card-id',
        `${testRealmURL}Node/a`,
        'the cycle atom stands in for the card that was re-entered',
      )
      .hasAttribute(
        'data-test-card-format',
        'atom',
        'the spine re-entry is rendered in atom format',
      );

    // (iii) The cycle atom is bounded: it stands in for A (identified by id) but
    // does NOT re-render A's full embedded field tree, so the recursion stopped.
    assert
      .dom('[data-test-render-cycle-atom] [data-test-node-body]')
      .doesNotExist(
        'the cycle atom does not re-render the full field tree of the re-entered card',
      );

    // B renders its full embedded body exactly once. A is only ever the
    // isolated root or the cut atom, so its embedded body never renders.
    assert
      .dom(`[data-test-node-body='A']`)
      .doesNotExist(
        'the root never renders an embedded body (root or atom only)',
      );
    assert
      .dom(`[data-test-node-body='B']`)
      .exists(
        { count: 1 },
        'B renders its full body once before the spine returns to the root',
      );
  });

  test('singular linksTo: a direct self-cycle (a -> a) terminates and the self re-entry degrades to an atom', async function (assert) {
    // The same shape as above with a single instance linking to itself, which
    // also exercises the field-component cycle branch. Spine: a(isolated, root)
    // -> a is already on the spine -> atom. The root's own self-embed is the
    // first re-entry, so it is cut to an atom immediately.
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field self = linksTo(() => Node);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-node-body={{@model.firstName}}>
            <@fields.firstName />
            <@fields.self @format='embedded' />
          </div>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-node-root={{@model.firstName}}>
            <@fields.self @format='embedded' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });

    let a = new Node({ firstName: 'Solo' });
    await saveCard(a, `${testRealmURL}Node/solo`, loader);
    getDataBucket(a).set('self', a);

    await renderCard(loader, a, 'isolated');

    assert
      .dom(`[data-test-node-root='Solo']`)
      .exists('the self-cyclic graph rendered to completion');
    assert
      .dom('[data-test-render-cycle-atom]')
      .exists(
        { count: 1 },
        'the self re-entry degrades to a single cycle atom',
      );
    assert
      .dom('[data-test-render-cycle-atom]')
      .hasAttribute(
        'data-boxel-card-id',
        `${testRealmURL}Node/solo`,
        'the cycle atom stands in for the card linking to itself',
      )
      .hasAttribute('data-test-card-format', 'atom');
    // The root renders in its isolated format, and its self-embed is the first
    // re-entry, so it is cut to the atom — the embedded body never renders.
    assert
      .dom(`[data-test-node-body='Solo']`)
      .doesNotExist(
        'the self-embed is cut to an atom, so the embedded body never renders',
      );
    assert
      .dom('[data-test-render-cycle-atom] [data-test-node-body]')
      .doesNotExist(
        'the self cycle atom does not re-render the full field tree',
      );
  });

  test('linksToMany: a per-element cycle terminates and the cyclic element degrades to an atom', async function (assert) {
    // `Node` embeds its plural `items` link. A node whose list contains itself
    // (items: [a]) forms a per-element cycle. The list is rendered in EMBEDDED
    // format so each element re-renders its embedded template, which itself
    // embeds `items` — that re-embed is where the cycle would otherwise recur.
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field items = linksToMany(() => Node);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-node-body={{@model.firstName}}>
            <@fields.firstName />
            <@fields.items @format='embedded' />
          </div>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-node-root={{@model.firstName}}>
            <@fields.items @format='embedded' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });

    let a = new Node({ firstName: 'A' });
    await saveCard(a, `${testRealmURL}Node/a`, loader);
    // A present list that contains the card itself: items === [a].
    getDataBucket(a).set('items', [a]);

    // Spine: a(isolated, root) -> items[0]=a is already on the spine -> atom.
    // The element is the root re-entered, so it is cut at the first occurrence.
    // Without the guard the list element a would re-enter forever
    // (a -> items[a] -> a -> items[a] -> ...).
    await renderCard(loader, a, 'isolated');

    assert
      .dom(`[data-test-node-root='A']`)
      .exists('the plural cyclic graph rendered to completion');
    // Exactly one element across the whole render is the cyclic one, degraded to
    // a per-element atom marked both as a plural item and a cycle atom.
    assert
      .dom('[data-test-render-cycle-atom]')
      .exists(
        { count: 1 },
        'the cyclic plural element degrades to a single cycle atom',
      );
    assert
      .dom('[data-test-render-cycle-atom]')
      .hasAttribute(
        'data-test-plural-view-item',
        '0',
        'the cycle atom occupies the per-element slot it replaced',
      )
      .hasAttribute(
        'data-test-card-format',
        'atom',
        'the cyclic element is forced to atom format',
      );
    // The root renders its isolated format, and its sole list element is the
    // root itself — cut to an atom at the first occurrence — so the embedded
    // body never renders.
    assert
      .dom(`[data-test-node-body='A']`)
      .doesNotExist(
        'the cyclic element is cut to an atom, so the embedded body never renders',
      );
  });

  test('non-cyclic embeds are unaffected: a normal linked card renders fully with no cycle atom', async function (assert) {
    // Proves the guard is surgical. `a` links to a DISTINCT card `b` that does
    // not link back, so no card is ever an ancestor of itself: the embed must
    // render fully and no `data-test-render-cycle-atom` may appear anywhere.
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field partner = linksTo(() => Node);
      @field items = linksToMany(() => Node);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          {{#if @model}}<span
              data-test-node-pill
            >{{@model.firstName}}</span>{{/if}}
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-node-body={{@model.firstName}}>
            <@fields.firstName />
          </div>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-node-root={{@model.firstName}}>
            <@fields.partner @format='embedded' />
            <@fields.items @format='fitted' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });

    let a = new Node({ firstName: 'A' });
    let b = new Node({ firstName: 'B' });
    let c = new Node({ firstName: 'C' });
    await saveCard(a, `${testRealmURL}Node/a`, loader);
    await saveCard(b, `${testRealmURL}Node/b`, loader);
    await saveCard(c, `${testRealmURL}Node/c`, loader);
    // No cycle: a links singularly to b and plurally to c; neither links back.
    getDataBucket(a).set('partner', b);
    getDataBucket(a).set('items', [c]);

    await renderCard(loader, a, 'isolated');

    assert.dom(`[data-test-node-root='A']`).exists('the root rendered');
    // The singular linked card b renders its full embedded body, not an atom.
    assert
      .dom(`[data-test-node-body='B']`)
      .exists({ count: 1 }, 'the distinct singular link renders its full body');
    // The plural element c renders fitted as a normal pill.
    assert
      .dom(`[data-test-node-pill]`)
      .hasText('C', 'the distinct plural element renders normally (fitted)');
    // The guard never fired — nothing was on its own spine.
    assert
      .dom('[data-test-render-cycle-atom]')
      .doesNotExist(
        'no cycle atom for an acyclic graph — the guard is surgical',
      );
  });

  // -------------------------------------------------------------------------
  // The route render path: the ROOT must render in its requested format, not as
  // its own cycle atom.
  // -------------------------------------------------------------------------
  // The tests above render through the `renderCard` helper with no ancestry
  // provided above the root, so they only exercise the descendant embeds. The
  // capture paths that the indexer/prerenderer actually use seed the
  // render-ancestry guard ABOVE the root: the `/render/html` route does it with
  // a `@provide(RenderAncestryContextName)` (see render/html.gts). What that
  // provided set contains is exactly what this fix is about. These two cases
  // pin the contract the route must honour, and reproduce the regression
  // deterministically through the same provided-context mechanism the route
  // uses (a present in-memory cycle, no realm round trip).
  //
  // `provideConsumeContext(RenderAncestryContextName, set)` provides the set at
  // the app root, exactly where the route's `@provide` sits relative to the
  // rendered card; the root card's `RenderAncestryConsumer` reads it as its
  // ancestry.
  test('route render path: an EMPTY provided ancestry renders the root in its requested format and only a descendant re-entry degrades to an atom', async function (assert) {
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field partner = linksTo(() => Node);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-node-body={{@model.firstName}}>
            <@fields.firstName />
            <@fields.partner @format='embedded' />
          </div>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-node-root={{@model.firstName}}>
            <@fields.partner @format='embedded' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });

    // a -> b -> a: the root (a) links to b, which links back to the root.
    let a = new Node({ firstName: 'A' });
    let b = new Node({ firstName: 'B' });
    await saveCard(a, `${testRealmURL}Node/a`, loader);
    await saveCard(b, `${testRealmURL}Node/b`, loader);
    getDataBucket(a).set('partner', b);
    getDataBucket(b).set('partner', a);

    // Provide an EMPTY render-ancestry set above the root, exactly as the fixed
    // render/html route does. The root has no ancestors, so it must render in
    // its requested isolated format.
    provideConsumeContext(RenderAncestryContextName, new Set<string>());
    await renderCard(loader, a, 'isolated');

    // (i) The root rendered in its requested isolated format. If the provided
    // set had contained the root's own id (the pre-fix route behavior, exercised
    // in the next test), the root would have matched its own cycle check and
    // this isolated body would be replaced by the bounded atom template.
    assert
      .dom(`[data-test-node-root='A']`)
      .exists('the root rendered in its requested isolated format');
    // (ii) Exactly one embed re-enters a card already on the spine — the genuine
    // descendant re-entry of the root (a -> b -> [a as atom]).
    assert
      .dom('[data-test-render-cycle-atom]')
      .exists(
        { count: 1 },
        'exactly one descendant re-entry is degraded to a cycle atom',
      );
    assert
      .dom('[data-test-render-cycle-atom]')
      .hasAttribute(
        'data-boxel-card-id',
        `${testRealmURL}Node/a`,
        'the cycle atom stands in for the root, re-entered beneath the descendant',
      )
      .hasAttribute('data-test-card-format', 'atom');
    // (iii) That re-entry is reached through the descendant b's full body, which
    // only renders if the root rendered its isolated body and descended into b.
    assert
      .dom(`[data-test-node-body='B'] [data-test-render-cycle-atom]`)
      .exists(
        { count: 1 },
        'the cycle atom is the root re-entered beneath the descendant, not the root itself',
      );
    assert
      .dom(`[data-test-node-body='B']`)
      .exists(
        { count: 1 },
        'the descendant renders its full body once before the cycle is cut',
      );
  });

  test('route render path: seeding the provided ancestry with the root id collapses the root to an atom (the regression this fix prevents)', async function (assert) {
    // The pre-fix route provided the render-ancestry set seeded with the root
    // card's own id. This test pins WHY that is wrong and is the failing case
    // the fix repairs: with the root's id on the spine above it, the root
    // matches its own cycle check and collapses to a bounded atom — its
    // requested format never renders (the bug where a saved card was captured as
    // a bare atom, e.g. an image card with no img element). The fix makes the
    // route provide an empty set instead (the previous test).
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field partner = linksTo(() => Node);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-node-body={{@model.firstName}}>
            <@fields.firstName />
            <@fields.partner @format='embedded' />
          </div>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-node-root={{@model.firstName}}>
            <@fields.partner @format='embedded' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });

    let a = new Node({ firstName: 'A' });
    let b = new Node({ firstName: 'B' });
    await saveCard(a, `${testRealmURL}Node/a`, loader);
    await saveCard(b, `${testRealmURL}Node/b`, loader);
    getDataBucket(a).set('partner', b);
    getDataBucket(b).set('partner', a);

    // Seed the provided ancestry with the ROOT's own id — the pre-fix route
    // behavior. The root's RenderAncestryConsumer reads this set and finds its
    // own id already present.
    provideConsumeContext(RenderAncestryContextName, new Set([a.id]));
    await renderCard(loader, a, 'isolated');

    // The root collapsed to its atom stand-in: the isolated body never rendered,
    // and the topmost card is the cycle atom standing in for the root itself.
    assert
      .dom(`[data-test-node-root='A']`)
      .doesNotExist(
        'a root seeded with its own id never renders its requested format',
      );
    assert
      .dom(
        `[data-test-render-cycle-atom][data-boxel-card-id='${testRealmURL}Node/a']`,
      )
      .exists(
        'the root itself is degraded to a cycle atom — the regression the fix prevents',
      );
  });
});
