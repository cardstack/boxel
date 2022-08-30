import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { baseRealm, ExportedCardRef } from '@cardstack/runtime-common';
import { Loader } from "@cardstack/runtime-common/loader";
import { Realm } from "@cardstack/runtime-common/realm";
import { Deferred } from "@cardstack/runtime-common/deferred";
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import CatalogEntryEditor from 'runtime-spike/components/catalog-entry-editor';
import Service from '@ember/service';
import { waitUntil, click, fillIn } from '@ember/test-helpers';
import { TestRealm, TestRealmAdapter, testRealmURL } from '../../helpers';

class MockLocalRealm extends Service {
  isAvailable = true;
  url = new URL(testRealmURL);
}

class MockRouter extends Service {
  assert: Assert | undefined;
  expectedRoute: any | undefined;
  deferred: Deferred<void> | undefined;
  initialize(assert: Assert, expectedRoute: any, deferred: Deferred<void>) {
    this.assert = assert;
    this.expectedRoute = expectedRoute;
    this.deferred = deferred;
  }
  transitionTo(route: any) {
    this.assert!.deepEqual(route, this.expectedRoute, 'the route transitioned correctly')
    this.deferred!.fulfill();
  }
}

module('Integration | catalog-entry-editor', function (hooks) {
  let adapter: TestRealmAdapter
  let realm: Realm;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function() {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    Loader.disableNativeImport(true);

    // We have a bit of a chicken and egg problem here in that in order for us
    // to short circuit the fetch we need a Realm instance, however, we can't
    // create a realm instance without first doing a full index which will load
    //  cards for any instances it find which results in a fetch. so we create
    // an empty index, and then just use realm.write() to incrementally add
    // items into our index.
    adapter = new TestRealmAdapter({});

    realm = TestRealm.createWithAdapter(adapter);
    Loader.addRealmFetchOverride(realm);
    await realm.ready;

    await realm.write('person.gts', `
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import IntegerCard from "https://cardstack.com/base/integer";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field email = contains(StringCard);
        @field posts = contains(IntegerCard);
        @field fullName = contains(StringCard, { computeVia: async function(this: Person) {
          await new Promise(resolve => setTimeout(resolve, 10));
          return ((this.firstName ?? '') + ' ' + (this.lastName ?? '')).trim();
        }});
        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h3>Person: <@fields.firstName/></h3></template>
        }
        static demo: Record<string, any> = { firstName: 'Mango' }
      }
    `);

    this.owner.register('service:local-realm', MockLocalRealm);
    this.owner.register('service:router', MockRouter);
  });

  hooks.afterEach(function() {
    Loader.destroy();
  });

  test('can publish new catalog entry', async function (assert) {
    let router = this.owner.lookup('service:router') as MockRouter;
    let deferred = new Deferred<void>();
    router.initialize(assert, { queryParams: { path: 'CatalogEntry/1.json'}}, deferred);
    const args: ExportedCardRef =  { module: `${testRealmURL}person`, name: 'Person' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('button[data-test-catalog-entry-publish]')));
    await click('[data-test-catalog-entry-publish]');
    await waitUntil(() => Boolean(document.querySelector('[data-test-ref]')));

    assert.dom('[data-test-catalog-entry-editor] [data-test-field="title"] input').hasValue('Person');
    assert.dom('[data-test-catalog-entry-editor] [data-test-field="description"] input').hasValue('Catalog entry for Person card');
    assert.dom('[data-test-catalog-entry-editor] [data-test-ref]').containsText(`Module: ${testRealmURL}person Name: Person`);

    await fillIn('[data-test-catalog-entry-editor] [data-test-field="title"] input', 'Person test');
    await fillIn('[data-test-catalog-entry-editor] [data-test-field="description"] input', 'test description');

    await click('button[data-test-save-card');

    await deferred.promise; // wait for the component to transition on save
    let entry = await realm.searchIndex.card(new URL(`${testRealmURL}CatalogEntry/1`));
    assert.ok(entry, 'the new catalog entry was created');

    let fileRef = await adapter.openFile('CatalogEntry/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            title: 'Person test',
            description: 'test description',
            isPrimitive: false,
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person'
            }
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/catalog-entry',
              name: 'CatalogEntry',
            },
          },
        },
      },
      'file contents are correct'
    );
  });

  test('can edit existing catalog entry', async function (assert) {
    await realm.write('person-catalog-entry.json', JSON.stringify({
      data: {
        type: 'card',
        attributes: {
          title: 'Person',
          description: 'Catalog entry',
          ref: {
            module: `${testRealmURL}person`,
            name: 'Person'
          }
        },
        meta: {
          adoptsFrom: {
            module:`${baseRealm.url}catalog-entry`,
            name: 'CatalogEntry'
          }
        }
      }
    }));

    const args: ExportedCardRef =  { module: `${testRealmURL}person`, name: 'Person' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-ref]')));

    assert.dom('[data-test-catalog-entry-id]').hasText(`${testRealmURL}person-catalog-entry`);
    assert.dom('[data-test-catalog-entry-editor] [data-test-field="title"] input').hasValue('Person');
    assert.dom('[data-test-catalog-entry-editor] [data-test-field="description"] input').hasValue('Catalog entry');
    assert.dom('[data-test-catalog-entry-editor] [data-test-ref]').containsText(`Module: ${testRealmURL}person Name: Person`);

    await fillIn('[data-test-catalog-entry-editor] [data-test-field="title"] input', 'Test title');
    await fillIn('[data-test-catalog-entry-editor] [data-test-field="description"] input', 'Test entry');

    await click('button[data-test-save-card');

    assert.dom('button[data-test-save-card').doesNotExist();
    assert.dom('[data-test-catalog-entry-editor] [data-test-field="title"] input').hasValue('Test title');
    assert.dom('[data-test-catalog-entry-editor] [data-test-field="description"] input').hasValue('Test entry');

    let entry = await realm.searchIndex.card(new URL(`${testRealmURL}person-catalog-entry`));
    assert.strictEqual(entry?.attributes?.title, 'Test title', 'catalog entry title was updated');
    assert.strictEqual(entry?.attributes?.description, 'Test entry', 'catalog entry description was updated');
  });
});
