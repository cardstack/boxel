import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, PermissionsContextName } from '@cardstack/runtime-common';
import type { Permissions } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const PARENT_URL = `${testRealmURL}Parent/one`;
const CHILD_URL = `${testRealmURL}Child/one`;

// The cards are declared inside a helper rather than at module scope because
// the base-realm helpers (CardDef, field, …) are only populated once
// `setupBaseRealm` has run.
function makeCards() {
  class Person extends CardDef {
    static displayName = 'Person';
    @field name = contains(StringField);
  }

  class Child extends CardDef {
    static displayName = 'Child';
    @field cardTitle = contains(StringField);
    @field matches = linksToMany(() => Person, {
      query: { filter: { eq: { name: '$this.cardTitle' } } },
    });
    static embedded = class extends Component<typeof Child> {
      <template>
        <div data-test-child>
          {{#each @model.matches as |person|}}
            <span data-test-match>{{person.name}}</span>
          {{/each}}
        </div>
      </template>
    };
  }

  class Parent extends CardDef {
    static displayName = 'Parent';
    @field child = linksTo(() => Child);
    static isolated = class extends Component<typeof Parent> {
      <template><@fields.child @format='embedded' /></template>
    };
  }

  return { Person, Child, Parent };
}

// A query-backed field is resolved for the card a document was asked for and
// not for the cards that document side-loads, so a card displayed as a link
// target arrives with its query-backed fields unresolved. Nothing is lost to
// the reader: a live consumer runs the field's query itself, which is what it
// does with a resolved field too.
module('Integration | nested query-field rendering', function (hooks) {
  let loader: Loader;
  let cardApi: typeof import('@cardstack/base/card-api');

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
    cardApi = await loader.import('@cardstack/base/card-api');

    let { Person, Child, Parent } = makeCards();
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Child, Parent },
        'Person/one.json': new Person({ name: 'Anchor' }),
        'Person/two.json': new Person({ name: 'Anchor' }),
        // Outside the query, so its absence from the render is what says the
        // field resolved rather than listing every person.
        'Person/three.json': new Person({ name: 'Different' }),
        'Child/one.json': new Child({ cardTitle: 'Anchor' }),
        'Parent/one.json': {
          data: {
            attributes: {},
            relationships: { child: { links: { self: '../Child/one' } } },
            meta: {
              adoptsFrom: { module: testRRI('test-cards'), name: 'Parent' },
            },
          },
        },
      },
    });
    await getService('realm').login(testRealmURL);
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('a link target renders its own query-backed field', async function (this: RenderingTestContext, assert) {
    let parent = (await getService('store').get(PARENT_URL)) as CardDefType;
    await settled();

    let element = await renderCard(loader, parent, 'isolated');
    await settled();

    let rendered = [
      ...element.querySelectorAll('[data-test-child] [data-test-match]'),
    ].map((node) => node.textContent?.trim());
    assert.deepEqual(
      rendered,
      ['Anchor', 'Anchor'],
      'the nested query-backed field resolves to both matching people',
    );
  });

  test("the parent's document leaves the nested field unresolved", async function (this: RenderingTestContext, assert) {
    let response = await getService('network').authedFetch(PARENT_URL, {
      headers: { Accept: 'application/vnd.card+json' },
    });
    let doc = await response.json();
    let child = (doc.included ?? []).find((resource: { id: string }) =>
      resource.id.endsWith('Child/one'),
    );
    assert.ok(child, 'the child is side-loaded into the document');

    // `links.search` is written only where the field was resolved, and the
    // consumer reads its absence as an unanswered field rather than as an
    // answer of none — which is what sends it to its own query.
    assert.notOk(
      child.relationships?.matches?.links?.search,
      'the side-loaded child carries no resolved umbrella for its query field',
    );
    assert.strictEqual(
      (doc.included ?? []).filter((resource: { id: string }) =>
        resource.id.includes('Person/'),
      ).length,
      0,
      "and none of that query's matches were expanded into the document",
    );
  });

  test('a link target resolves its query-backed field inside a render context too', async function (this: RenderingTestContext, assert) {
    // The case the document's answer used to decide. Inside a render context
    // a query field resolves lazily, through the getter, and the seed logic
    // treats an unresolved field as unanswered rather than as an answer of
    // none — so the field reaches its own query instead of rendering empty.
    let globals = globalThis as unknown as { __boxelRenderContext?: boolean };
    globals.__boxelRenderContext = true;
    try {
      let parent = (await getService('store').get(PARENT_URL)) as CardDefType;
      await settled();

      let element = await renderCard(loader, parent, 'isolated');
      await settled();

      let rendered = [
        ...element.querySelectorAll('[data-test-child] [data-test-match]'),
      ].map((node) => node.textContent?.trim());
      assert.deepEqual(
        rendered,
        ['Anchor', 'Anchor'],
        'the nested query-backed field resolves without a seed to read',
      );
    } finally {
      delete globals.__boxelRenderContext;
    }
  });

  test('the field the document does resolve is the one that was asked for', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let child = (await getService('store').get(CHILD_URL)) as CardDefType;
    await settled();

    let response = await getService('network').authedFetch(CHILD_URL, {
      headers: { Accept: 'application/vnd.card+json' },
    });
    let doc = await response.json();
    assert.ok(
      doc.data.relationships?.matches?.links?.search,
      'asked for directly, the child resolves its own query-backed field',
    );

    assert.strictEqual(
      getRelationshipMembershipState(child, 'matches').membership?.length,
      2,
      'and the field holds both matches either way',
    );
  });
});
