import { module, test } from 'qunit';
import Service from '@ember/service';
import GlimmerComponent from '@glimmer/component';
import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import {
  TestRealm,
  TestRealmAdapter,
  testRealmURL,
  setupLocalIndexing,
} from '../../helpers';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import CardPrerender from '@cardstack/host/components/card-prerender';
import FileTree from '@cardstack/host/components/editor/file-tree';
import { waitUntil, waitFor, fillIn, click } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import { shimExternals } from '@cardstack/host/lib/externals';

module('Integration | file-tree', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  let didTransition: { route: string; params: any } | undefined;
  class MockRouter extends Service {
    transitionTo(route: string, params: any) {
      didTransition = { route, params };
    }
  }
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(async function () {
    didTransition = undefined;
    this.owner.register('service:router', MockRouter);
    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    shimExternals();
    adapter = new TestRealmAdapter({
      'person.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field nickName = contains(StringCard, { computeVia: function() { return this.firstName + '-poo'; }});
          @field title =  contains(StringCard, {
            computeVia: function (this: Item) {
              return this.nickName;
            },
          });
          static isolated = class Isolated extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template><h3>Person: <@fields.firstName/></h3></template>
          }
        }
      `,
      'post.gts': `
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
      `,
      'person-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
      'post-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Post',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
    });
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;
  });

  hooks.afterEach(function () {
    Loader.destroy();
  });

  test('can create a new card', async function (assert) {
    let openDirs: string[] = [];
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <FileTree
            @url={{testRealmURL}}
            @openFile={{undefined}}
            @openDirs={{openDirs}}
          />
          <CreateCardModal />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );
    await click('[data-test-create-new-card-button]');

    assert
      .dom(`[data-test-card-catalog-modal] [data-test-boxel-header-title]`)
      .hasText('Choose a card type');

    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');

    assert
      .dom('[data-test-card-catalog] li')
      .exists({ count: 3 }, 'number of catalog items is correct');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"]`
      )
      .exists('first item is correct');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}post-entry"]`
      )
      .exists('second item is correct');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/string-field`
      )
      .doesNotExist('primitive field cards are not displayed');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Jackie');
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.strictEqual(didTransition?.route, 'code', 'the route is correct');
    assert.deepEqual(
      didTransition?.params,
      {
        queryParams: { path: 'Person/1.json' },
      },
      'the query params are correct'
    );

    let entry = await realm.searchIndex.card(
      new URL(`${testRealmURL}Person/1`)
    );
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
              module: `../person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct'
    );
  });
});
