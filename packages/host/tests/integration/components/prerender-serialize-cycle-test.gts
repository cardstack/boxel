import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
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
  getQueryableValue,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// `CardDef[queryableValue]` recurses through relationships when building a
// card's search doc. Its cycle guard is `stack.includes(value)` — pure OBJECT
// IDENTITY. That misses a *logical* cycle whenever the same card is re-entered
// as a DIFFERENT object instance for the same id, which is exactly what a
// prerender produces when a link / query-field resolves a fresh object rather
// than the canonical store instance. The object-identity guard then expands the
// duplicate (and, if every re-entry is fresh, recurses without bound).
//
// `serialize` already guards by id (`visited.has(value.id)`); this test pins
// `queryableValue` to the same id-based behavior: a fresh-object re-entry of an
// already-on-the-stack card must collapse to `{ id }`, not expand. The graph is
// built from PRESENT, in-memory links (no realm round trip, no search), so it is
// deterministic with no timing dependence — the synchronous cost the prerender
// wedge exhibits, reproduced in isolation.

let loader: Loader;

module('Integration | prerender serialize cycle guard', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
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
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('queryableValue collapses a fresh-object cycle by id (object-identity alone would expand/recurse it)', async function (assert) {
    class Node extends CardDef {
      static displayName = 'Node';
      @field firstName = contains(StringField);
      @field link = linksTo(() => Node);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-node={{@model.firstName}}>
            <@fields.link @format='embedded' />
          </div>
        </template>
      };
      static embedded = class extends Component<typeof this> {
        <template>
          <div data-test-node={{@model.firstName}}>
            <@fields.firstName />
            <@fields.link @format='embedded' />
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Node });
    let api = (await loader.import(
      '@cardstack/base/card-api',
    )) as typeof import('@cardstack/base/card-api');

    let a = new Node({ firstName: 'A-canonical' });
    let b = new Node({ firstName: 'B' });
    await saveCard(a, `${testRealmURL}Node/a`, loader);
    await saveCard(b, `${testRealmURL}Node/b`, loader);

    // a2 — a FRESH object carrying A's id but a distinctive field value: the
    // "same logical card, different object instance" the object-identity guard
    // can't see. b links to a2 (not the canonical a), so the serialize traversal
    // is a -> b -> a2, and a2 re-enters A's id while A is still on the stack.
    // a2 has no outgoing link, so the render below terminates (a -> b -> a2) —
    // only the serialize-side cycle guard is under test here, not render-cycle
    // handling. Without the id-based guard the serialize simply expands a2 once
    // (its `firstName` lands in the doc and the assertion fails) rather than
    // looping; with it, a2 collapses to `{ id }`.
    let a2 = new Node({ firstName: 'A-DUPLICATE-FRESH-OBJECT' });
    api.setCardAsSavedForTest(a2 as any, `${testRealmURL}Node/a`);
    getDataBucket(a).set('link', b);
    getDataBucket(b).set('link', a2);

    // Render once so the `link` field counts as a used linksTo (queryableValue
    // serializes used links only). Reaching past this line also proves the
    // serialize below terminated rather than pegging.
    await renderCard(loader, a, 'isolated');

    let doc = getQueryableValue(a.constructor as typeof CardDef, a);
    let json = JSON.stringify(doc);

    assert.ok(
      json.includes('A-canonical'),
      'the root A serializes its own attributes',
    );
    assert.notOk(
      json.includes('A-DUPLICATE-FRESH-OBJECT'),
      'the fresh-object re-entry of A collapses to {id} — not expanded; without the id-based guard the object-identity check would miss the cycle and expand it',
    );
  });

  // A query-backed field is resolved live from a query and the index has no way
  // to invalidate it when matching cards change, so its value in the search doc
  // would always be stale — and traversing the query closure to build it is what
  // wedges a dense realm. The search-doc builder must skip query-backed fields
  // entirely, while keeping ordinary contains / linksTo(Many) fields.
  test('a query-backed field is omitted from the search doc; ordinary fields are kept', async function (assert) {
    class Member extends CardDef {
      static displayName = 'Member';
      @field firstName = contains(StringField);
    }
    class Team extends CardDef {
      static displayName = 'Team';
      @field teamName = contains(StringField);
      @field roster = linksToMany(() => Member);
      @field matchingMembers = linksToMany(() => Member, {
        query: { filter: { eq: { firstName: 'anything' } } },
      });
    }
    loader.shimModule(`${testRealmURL}team-cards`, { Member, Team });

    let member = new Member({ firstName: 'Mango' });
    let team = new Team({ teamName: 'Engineering' });
    await saveCard(member, `${testRealmURL}Member/mango`, loader);
    await saveCard(team, `${testRealmURL}Team/eng`, loader);

    // Mark both relationship fields as used (populate the bucket) so each would
    // be a search-doc candidate were it not for the query-backed filter.
    getDataBucket(team).set('roster', [member]);
    getDataBucket(team).set('matchingMembers', [member]);

    let doc = getQueryableValue(
      team.constructor as typeof CardDef,
      team,
    ) as Record<string, any>;

    assert.notOk(
      'matchingMembers' in doc,
      'the query-backed field is absent from the search doc',
    );
    assert.strictEqual(
      doc.teamName,
      'Engineering',
      'an ordinary contains field is still present',
    );
    assert.ok(
      'roster' in doc,
      'an ordinary (non-query) linksToMany field is still present',
    );
  });
});
