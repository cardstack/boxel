import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import {
  setupBaseRealm,
  field,
  contains,
  linksTo,
  CardDef,
  StringField,
  searchDocFromFields,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;

// Exercises the searchable-driven generator `searchDocFromFields` (CS-11722).
// The central property under test (Hassan-confirmed): search-doc depth is
// sourced ONLY from the `searchable` annotations on the card being indexed —
// a card pulled in as a link target does NOT re-consult its own `searchable`.
module('Integration | searchable search doc', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    class Agent extends CardDef {
      static displayName = 'Agent';
      @field name = contains(StringField);
    }
    // Author makes its OWN `agent` link searchable. This annotation must be
    // honored only when Author is the indexed card — never when Author is
    // pulled in as a link target of another card.
    class Author extends CardDef {
      static displayName = 'Author';
      @field name = contains(StringField);
      @field agent = linksTo(Agent, { searchable: true });
    }
    // Three articles linking to the same Author, differing only in how (or
    // whether) `author` is made searchable.
    class ArticleSelf extends CardDef {
      static displayName = 'ArticleSelf';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: true }); // self link only
    }
    class ArticleDeep extends CardDef {
      static displayName = 'ArticleDeep';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: 'agent' }); // route into agent
    }
    class ArticleShallow extends CardDef {
      static displayName = 'ArticleShallow';
      @field title = contains(StringField);
      @field author = linksTo(Author); // not searchable → {id}
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'agent.gts': { Agent },
        'author.gts': { Author },
        'article.gts': { ArticleSelf, ArticleDeep, ArticleShallow },
        'Agent/a1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Agent/a1`,
            attributes: { name: 'Agent Smith' },
            meta: {
              adoptsFrom: { module: `${testRealmURL}agent`, name: 'Agent' },
            },
          },
        },
        'Author/au1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Author/au1`,
            attributes: { name: 'Jo' },
            relationships: {
              agent: { links: { self: `${testRealmURL}Agent/a1` } },
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}author`, name: 'Author' },
            },
          },
        },
        'ArticleSelf/s1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleSelf/s1`,
            attributes: { title: 'Self' },
            relationships: {
              author: { links: { self: `${testRealmURL}Author/au1` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}article`,
                name: 'ArticleSelf',
              },
            },
          },
        },
        'ArticleDeep/d1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleDeep/d1`,
            attributes: { title: 'Deep' },
            relationships: {
              author: { links: { self: `${testRealmURL}Author/au1` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}article`,
                name: 'ArticleDeep',
              },
            },
          },
        },
        'ArticleShallow/sh1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleShallow/sh1`,
            attributes: { title: 'Shallow' },
            relationships: {
              author: { links: { self: `${testRealmURL}Author/au1` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}article`,
                name: 'ArticleShallow',
              },
            },
          },
        },
      },
    });
  });

  async function loadAndGenerate(id: string) {
    let store = getService('store') as StoreService;
    let instance = (await store.get(id)) as CardDefType;
    return await searchDocFromFields(instance);
  }

  let agentUrl = `${testRealmURL}Agent/a1`;
  let authorUrl = `${testRealmURL}Author/au1`;

  test('a pulled-in link target does NOT consult its own searchable (routes come only from the indexed card)', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSelf/s1`);
    // author IS pulled in (the indexed card's `author` is searchable: true)…
    assert.strictEqual(doc.author?.name, 'Jo', 'author is expanded');
    // …but author.agent stays `{ id }` even though Author.agent is itself
    // `searchable: true` — Author's own annotation is dormant when pulled in.
    assert.deepEqual(
      doc.author?.agent,
      { id: agentUrl },
      "the target's own searchable link is NOT expanded",
    );
  });

  test('the same card indexed directly DOES honor its own searchable', async function (assert) {
    let doc = await loadAndGenerate(authorUrl);
    assert.strictEqual(
      doc.agent?.name,
      'Agent Smith',
      'Author.agent is expanded when Author is the card being indexed',
    );
  });

  test('a dotted route on the indexed card expands the deeper link', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleDeep/d1`);
    assert.strictEqual(
      doc.author?.agent?.name,
      'Agent Smith',
      'the route `author.agent` declared on the indexed card drives the depth',
    );
  });

  test('a link with no searchable annotation stays { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleShallow/sh1`);
    assert.deepEqual(
      doc.author,
      { id: authorUrl },
      'an unannotated link is captured as { id } only',
    );
  });
});
