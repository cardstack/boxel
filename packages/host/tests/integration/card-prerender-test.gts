import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  testRealmURL,
  setupCardLogs,
  cleanWhiteSpace,
  trimCardContainer,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';

let loader: Loader;

module('Integration | card-prerender', function (hooks) {
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
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h3><@fields.firstName /></h3>
        </template>
      };
    }

    ({ realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'pet.gts': { Pet },
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
      },
    }));
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
