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
  setupMockLocalRealm,
} from '../../helpers';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import CardPrerender from '@cardstack/host/components/card-prerender';
import FileTree from '@cardstack/host/components/file-tree';
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
  setupMockLocalRealm(hooks);

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
          static isolated = class Isolated extends Component<typeof this> {
            <template><h1><@fields.firstName/></h1></template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template><h3>Person: <@fields.firstName/></h3></template>
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

  test('can transition to correct route after creating a new card', async function (assert) {
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
    await waitFor('[data-test-card-catalog-modal] [data-test-ref]');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Jackie');
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.strictEqual(didTransition?.route, 'code');
    assert.deepEqual(didTransition?.params, {
      queryParams: { path: 'Person/1.json' },
    });
  });
});
