import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Realm, IndexedInstance } from '@cardstack/runtime-common';
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
  linksToMany,
  CardDef,
  FieldDef,
  Component,
  StringField,
  searchDocFromFields,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;
let realm: Realm;

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
    // Self-referential link for the cycle-clip case.
    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
      @field friend = linksTo(() => Person, { searchable: true });
    }
    // A FieldDef that itself holds a link, so a route can pass THROUGH a
    // contained value to reach a deeper link (contains-routing).
    class ArticleMeta extends FieldDef {
      static displayName = 'ArticleMeta';
      @field editor = linksTo(Author);
    }
    class ArticleContains extends CardDef {
      static displayName = 'ArticleContains';
      @field title = contains(StringField);
      @field meta = contains(ArticleMeta, { searchable: 'editor' });
    }
    // For the differential parity check: a link target with ONLY contained
    // fields (no nested links to disagree on) and no polymorphism, so the
    // searchable-driven doc must equal the store-driven doc exactly.
    class SimpleAuthor extends CardDef {
      static displayName = 'SimpleAuthor';
      @field name = contains(StringField);
    }
    // A subtype with an extra contained field, to prove the generator
    // enumerates the DECLARED link type and drops subtype-only bloat.
    class FancyAuthor extends SimpleAuthor {
      static displayName = 'FancyAuthor';
      @field penName = contains(StringField);
    }
    class ParityArticle extends CardDef {
      static displayName = 'ParityArticle';
      @field title = contains(StringField);
      @field authors = linksToMany(SimpleAuthor, { searchable: true });
      // Render the links so the indexer's store-driven pass loads them — the
      // differential parity check needs both paths at the same depth.
      static isolated = class extends Component<typeof this> {
        <template><@fields.authors /></template>
      };
    }
    class ArticleSubtype extends CardDef {
      static displayName = 'ArticleSubtype';
      @field title = contains(StringField);
      @field author = linksTo(SimpleAuthor, { searchable: true });
    }

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'agent.gts': { Agent },
        'author.gts': { Author },
        'article.gts': { ArticleSelf, ArticleDeep, ArticleShallow },
        'person.gts': { Person },
        'article-contains.gts': { ArticleContains, ArticleMeta },
        'simple-author.gts': { SimpleAuthor, FancyAuthor },
        'parity.gts': { ParityArticle, ArticleSubtype },
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
        // A self link (friend → itself) for the cycle-clip case.
        'Person/p1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Person/p1`,
            attributes: { name: 'Solo' },
            relationships: {
              friend: { links: { self: `${testRealmURL}Person/p1` } },
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}person`, name: 'Person' },
            },
          },
        },
        // author points at a card that does not exist (broken / 404 target).
        'ArticleSelf/broken.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleSelf/broken`,
            attributes: { title: 'Broken' },
            relationships: {
              author: { links: { self: `${testRealmURL}Author/missing` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}article`,
                name: 'ArticleSelf',
              },
            },
          },
        },
        // meta is a contained value whose `editor` link is reached via the
        // route `meta.editor` declared on the indexed card.
        'ArticleContains/c1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleContains/c1`,
            attributes: { title: 'Contains', meta: {} },
            relationships: {
              'meta.editor': { links: { self: `${testRealmURL}Author/au1` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}article-contains`,
                name: 'ArticleContains',
              },
            },
          },
        },
        'SimpleAuthor/sa1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}SimpleAuthor/sa1`,
            attributes: { name: 'Plain' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}simple-author`,
                name: 'SimpleAuthor',
              },
            },
          },
        },
        // A FancyAuthor instance linked through a `linksTo(SimpleAuthor)` —
        // its `penName` must be dropped (declared type is SimpleAuthor).
        'FancyAuthor/fa1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}FancyAuthor/fa1`,
            attributes: { name: 'Fancy', penName: 'Quill' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}simple-author`,
                name: 'FancyAuthor',
              },
            },
          },
        },
        'ParityArticle/pa1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ParityArticle/pa1`,
            attributes: { title: 'Parity' },
            relationships: {
              'authors.0': {
                links: { self: `${testRealmURL}SimpleAuthor/sa1` },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}parity`,
                name: 'ParityArticle',
              },
            },
          },
        },
        'ArticleSubtype/sub1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleSubtype/sub1`,
            attributes: { title: 'Subtype' },
            relationships: {
              author: { links: { self: `${testRealmURL}FancyAuthor/fa1` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}parity`,
                name: 'ArticleSubtype',
              },
            },
          },
        },
      },
    }));
  });

  async function loadAndGenerate(id: string) {
    let store = getService('store') as StoreService;
    let instance = (await store.get(id)) as CardDefType;
    return await searchDocFromFields(instance);
  }

  // The store-driven search doc the indexer produced, minus `_cardType` (which
  // the prerender meta route appends, not the generator) — the differential
  // parity baseline.
  async function storeDrivenSearchDoc(id: string) {
    let entry = await realm.realmIndexQueryEngine.instance(new URL(id));
    if (!entry || entry.type === 'instance-error') {
      return undefined;
    }
    let { _cardType, ...rest } = (entry as IndexedInstance).searchDoc ?? {};
    return rest;
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

  test('a self-referential link clips the cycle to { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Person/p1`);
    assert.deepEqual(
      doc.friend,
      { id: `${testRealmURL}Person/p1` },
      'a self link clips to { id } via the cycle guard',
    );
  });

  test('a searchable link to a missing target degrades to { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSelf/broken`);
    assert.deepEqual(
      doc.author,
      { id: `${testRealmURL}Author/missing` },
      'an unloadable link keeps its reference as { id }',
    );
  });

  test('a route through a contained field reaches a deeper link', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleContains/c1`);
    assert.strictEqual(
      doc.meta?.editor?.name,
      'Jo',
      'the route `meta.editor` expands the link beneath the contained value',
    );
  });

  // Differential parity: the searchable-driven path must follow a searchable
  // link to the SAME target, pulling in the same data, that the store-driven
  // render loaded. Byte-for-byte equality of the whole doc is NOT asserted here
  // and is not yet true — the new spec keeps `{ id }`/`null` for every
  // relationship while the store-driven path omits unused links via
  // `usedLinksToFieldsOnly`; reconciling that (and dropping subtype bloat) to
  // an identical doc is the cutover ticket's (CS-11724) gate, after the
  // migration reproduces today's depth. Here we prove the expansion matches.
  test('searchable expansion pulls in the same target+data as the store-driven load', async function (assert) {
    let generated = await loadAndGenerate(`${testRealmURL}ParityArticle/pa1`);
    let storeDriven = await storeDrivenSearchDoc(
      `${testRealmURL}ParityArticle/pa1`,
    );
    assert.deepEqual(
      (generated.authors ?? []).map((a: any) => a.id),
      (storeDriven?.authors ?? []).map((a: any) => a.id),
      'follows the searchable link to the same target the store loaded',
    );
    assert.deepEqual(
      (generated.authors ?? []).map((a: any) => a.name),
      (storeDriven?.authors ?? []).map((a: any) => a.name),
      'pulls the same contained data from the expanded target',
    );
  });

  test('a link target is enumerated by its DECLARED type (subtype bloat dropped)', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSubtype/sub1`);
    assert.strictEqual(
      doc.author?.name,
      'Fancy',
      'the declared field is present',
    );
    assert.notOk(
      'penName' in (doc.author ?? {}),
      'the subtype-only field is dropped (declared-type enumeration)',
    );
  });
});
