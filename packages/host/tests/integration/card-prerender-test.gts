import { module, test } from 'qunit';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { baseRealm } from '@cardstack/runtime-common';
import {
  testRealmURL,
  setupCardLogs,
  TestRealmAdapter,
  TestRealm,
  cleanWhiteSpace,
  trimCardContainer,
  setupLocalIndexing,
} from '../helpers';
import { RenderingTestContext } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import { setupRenderingTest } from 'ember-qunit';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';

let loader: Loader;

module('Integration | card-prerender', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;

  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function (this: RenderingTestContext) {
    adapter = new TestRealmAdapter({
      'pet.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends CardDef {
          @field firstName = contains(StringCard);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h3><@fields.firstName/></h3>
            </template>
          }
        }
      `,
      'Pet/mango.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Pet/mango`,
          attributes: {
            firstName: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      },
      'Pet/vangogh.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Pet/vangogh`,
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      },
    });

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
    await realm.ready;
  });

  test("can generate the card's pre-rendered HTML", async function (assert) {
    {
      let entry = await realm.searchIndex.searchEntry(
        new URL(`${testRealmURL}Pet/mango`),
      );
      assert.strictEqual(
        trimCardContainer(stripScopedCSSAttributes(entry!.html!)),
        cleanWhiteSpace(`<h3> Mango </h3>`),
        'the pre-rendered HTML is correct',
      );
    }
    {
      let entry = await realm.searchIndex.searchEntry(
        new URL(`${testRealmURL}Pet/vangogh`),
      );
      assert.strictEqual(
        trimCardContainer(stripScopedCSSAttributes(entry!.html!)),
        cleanWhiteSpace(`<h3> Van Gogh </h3>`),
        'the pre-rendered HTML is correct',
      );
    }
  });
});
