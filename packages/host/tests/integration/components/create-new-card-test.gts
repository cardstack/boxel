import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from "@cardstack/runtime-common/loader";
import { Realm } from "@cardstack/runtime-common/realm";
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import { TestRealm, TestRealmAdapter, testRealmURL, setupMockLocalRealm } from '../../helpers';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import CardPrerender from '@cardstack/host/components/card-prerender';
import waitUntil from '@ember/test-helpers/wait-until';
import { waitFor, fillIn, click } from '../../helpers/shadow-assert';
import type LoaderService from '@cardstack/host/services/loader-service';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { on } from '@ember/modifier';
import { chooseCard, catalogEntryRef, createNewCard } from '@cardstack/runtime-common';

module('Integration | create-new-card', function (hooks) {
  let adapter: TestRealmAdapter
  let realm: Realm;
  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);

  hooks.beforeEach(async function() {
    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    adapter = new TestRealmAdapter({});
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    let loader = (this.owner.lookup('service:loader-service') as LoaderService).loader;
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;

    await realm.write('person.gts', `
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field nickName = contains(StringCard, { computeVia: function() { return this.firstName + '-poo'; }});
        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.firstName/></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h3>Person: <@fields.firstName/></h3></template>
        }
      }
    `);
    await realm.write('post.gts', `
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Post extends Card {
        @field title = contains(StringCard);
        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.title/></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h3>Person: <@fields.title/></h3></template>
        }
      }
    `);
    await realm.write('person-entry.json', JSON.stringify({
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
    await realm.write('post-entry.json', JSON.stringify({
      data: {
        type: 'card',
        attributes: {
          title: 'Post',
          description: 'Catalog entry',
          ref: {
            module: `${testRealmURL}post`,
            name: 'Post'
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
  });

  hooks.afterEach(function() {
    Loader.destroy();
  });

  test('can create new card', async function (assert) {
    async function createNew() {
      let card = await chooseCard<CatalogEntry>({
        filter: {
          on: catalogEntryRef,
          eq: { isPrimitive: false },
        }
      });
      if (!card) {
        return;
      }
      return await createNewCard(card.ref);
    }
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <button {{on "click" createNew}} type="button" data-test-create-button>
            Create New Card
          </button>
          <CreateCardModal />
          <CardCatalogModal />
          <CardPrerender/>
        </template>
      }
    );
    await click('[data-test-create-button]');
    await waitFor('[data-test-card-catalog-modal] [data-test-ref]');

    assert.dom('[data-test-card-catalog] li').exists({ count: 2 }, 'number of catalog items is correct');
    assert.dom(`[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"]`).exists('first item is correct');
    assert.dom(`[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}post-entry"]`).exists('second item is correct');
    assert.dom(`[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/string-field`).doesNotExist('primitive field cards are not displayed');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Jackie');
    await click('[data-test-save-card]');
    await waitUntil(() => !(document.querySelector('[data-test-saving]')));

    let entry = await realm.searchIndex.card(new URL(`${testRealmURL}Person/1`));
    assert.ok(entry, 'the new person card was created');

    let fileRef = await adapter.openFile('Person/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Jackie',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct'
    );
  });
});
