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
  setupMockLocalRealm
} from '../helpers';
import { setupRenderingTest } from 'ember-qunit';

module('Integration | card-prerender', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  hooks.beforeEach(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    adapter = new TestRealmAdapter({
      'pet.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends Card {
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
      }
    });
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    await realm.ready;
  });

  test("can generate the card's pre-rendered HTML", async function (assert) {
    {
      let entry = await realm.searchIndex.searchEntry(new URL(`${testRealmURL}Pet/mango`));
      assert.strictEqual(
        cleanWhiteSpace(entry!.html!),
        cleanWhiteSpace(`
          <div data-test-shadow-boundary>
            <h3> Mango </h3>
          </div>
        `),
        'the pre-rendered HTML is correct'
      );
    }
    {
      let entry = await realm.searchIndex.searchEntry(new URL(`${testRealmURL}Pet/vangogh`));
      assert.strictEqual(
        cleanWhiteSpace(entry!.html!),
        cleanWhiteSpace(`
          <div data-test-shadow-boundary>
            <h3> Van Gogh </h3>
          </div>
        `),
        'the pre-rendered HTML is correct'
      );
    }
  });
});
