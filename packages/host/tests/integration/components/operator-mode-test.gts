import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { baseRealm } from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';
import { Loader } from '@cardstack/runtime-common/loader';
import OperatorMode from '@cardstack/host/components/operator-mode';
import CardPrerender from '@cardstack/host/components/card-prerender';
import { Card } from 'https://cardstack.com/base/card-api';
import { renderComponent } from '../../helpers/render-component';
import { testRealmURL, setupCardLogs, setupMockLocalRealm, TestRealmAdapter, TestRealm } from '../../helpers';
import { waitFor, click, fillIn } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import { shimExternals } from '@cardstack/host/lib/externals';

let cardApi: typeof import('https://cardstack.com/base/card-api');

module('Integration | operator-mode', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  async function loadCard(url: string): Promise<Card> {
    let { createFromSerialized, recompute } = cardApi;
    let result = await realm.searchIndex.card(new URL(url));
    if (!result || result.type === 'error') {
      throw new Error(
        `cannot get instance ${url} from the index: ${
          result ? result.error.detail : 'not found'
        }`
      );
    }
    let card = await createFromSerialized<typeof Card>(
      result.doc.data,
      result.doc,
      undefined,
      {
        loader: Loader.getLoaderFor(createFromSerialized),
      }
    );
    await recompute(card, { loadFields: true });
    return card;
  }

  hooks.beforeEach(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    shimExternals();
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);

    adapter = new TestRealmAdapter({
      'pet.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends Card {
          @field name = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-pet={{@model.name}}>
                <@fields.name/>
              </h3>
            </template>
          }
        }
      `,
      'person.gts': `
        import { contains, linksTo, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field pet = linksTo(Pet);
          static isolated = class Embedded extends Component<typeof this> {
            <template>
              <h2 data-test-person={{@model.firstName}}>
                <@fields.firstName/>
              </h2>
              Pet: <@fields.pet/>
            </template>
          }
        }
      `,
      'Pet/mango.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Pet/mango`,
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      },
      'Person/fadhlan.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/fadhlan`,
          attributes: {
            firstName: 'Fadhlan',
          },
          relationships: {
            pet: {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
    });
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;
  });

  test("it doesn't change the field value if user clicks cancel in edit view", async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').hasText('Fadhlan');

    await click('[aria-label="Edit"]');
    await fillIn('[data-test-boxel-input]', 'FadhlanEdit');

    await click('[aria-label="Cancel"]');
    assert.dom('[data-test-person]').hasText('Fadhlan');
  });

  test("it changes the field value if user clicks save in edit view", async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');

    await click('[aria-label="Edit"]');
    await fillIn('[data-test-boxel-input]', 'EditedName');
    await click('[aria-label="Save"]');

    await waitFor('[data-test-person="EditedName"]');
    assert.dom('[data-test-person]').hasText('EditedName');
    console.log(this.element.querySelector('[data-test-person]')?.textContent);
  });
});
