import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { baseRealm } from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';
import { Loader } from '@cardstack/runtime-common/loader';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import CardPrerender from '@cardstack/host/components/card-prerender';
// import { Card } from 'https://cardstack.com/base/card-api';
import { renderComponent } from '../../helpers/render-component';
import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  TestRealmAdapter,
  TestRealm,
  // type AutoSaveTestContext,
} from '../../helpers';
import { waitFor, click } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type CardService from '@cardstack/host/services/card-service';
import percySnapshot from '@percy/ember';

const testRealm2URL = `http://test-realm/test2/`;
let loader: Loader;
let setCardInOperatorModeState: (
  leftCards: string[],
  rightCards?: string[],
) => Promise<void>;

module('Integration | card-copy', function (hooks) {
  let adapter1: TestRealmAdapter;
  let adapter2: TestRealmAdapter;
  let realm1: Realm;
  let realm2: Realm;
  let noop = () => {};
  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  hooks.afterEach(async function () {
    localStorage.removeItem('recent-cards');
  });

  hooks.beforeEach(async function () {
    localStorage.removeItem('recent-cards');

    setCardInOperatorModeState = async (
      leftCards: string[],
      rightCards: string[] = [],
    ) => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      let stacks = [
        leftCards.map((url) => ({
          type: 'card' as 'card',
          id: url,
          format: 'isolated' as 'isolated',
        })),
        rightCards.map((url) => ({
          type: 'card' as 'card',
          id: url,
          format: 'isolated' as 'isolated',
        })),
      ].filter((a) => a.length > 0);
      await operatorModeStateService.restore({ stacks });
    };
    adapter1 = new TestRealmAdapter({
      'person.gts': `
        import { contains, linksTo, field, Component, Card, linksToMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";

        export class Person extends Card {
          static displayName = 'Person';
          @field firstName = contains(StringCard);
          @field pet = linksTo(Pet);
          @field title = contains(StringCard, {
            computeVia: function (this: Person) { return this.firstName; }
          });
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h2 data-test-person={{@model.firstName}}><@fields.firstName/></h2>
              <@fields.pet/>
            </template>
          }
        }
      `,
      'pet.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends Card {
          static displayName = 'Pet';
          @field firstName = contains(StringCard);
          @field title = contains(StringCard, {
            computeVia: function (this: Pet) {
              return this.firstName;
            },
          });
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h2 data-test-pet={{@model.firstName}}><@fields.firstName/></h2>
              <@fields.pet/>
            </template>
          }
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-pet={{@model.firstName}}><@fields.name/></h3>
            </template>
          }
        }
      `,
      'index.json': {
        data: {
          type: 'card',
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/cards-grid',
              name: 'CardsGrid',
            },
          },
        },
      },
      'Person/hassan.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
          },
          relationships: {
            pet: {
              links: {
                self: '../Pet/mango',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `../person`,
              name: 'Person',
            },
          },
        },
      },
      'Pet/mango.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: '../pet',
              name: 'Pet',
            },
          },
        },
      },
      'Pet/vangogh.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: '../pet',
              name: 'Pet',
            },
          },
        },
      },
      '.realm.json': {
        name: 'Test Workspace 1',
        backgroundURL:
          'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
      },
    });

    adapter2 = new TestRealmAdapter({
      'index.json': {
        data: {
          type: 'card',
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/cards-grid',
              name: 'CardsGrid',
            },
          },
        },
      },
      'Pet/paper.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Paper',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      },
      '.realm.json': {
        name: 'Test Workspace 2',
        backgroundURL:
          'https://i.postimg.cc/tgRHRV8C/pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/d0B9qMvy/icon.png',
      },
    });

    realm1 = await TestRealm.createWithAdapter(adapter1, loader, this.owner, {
      realmURL: testRealmURL,
    });
    await realm1.ready;

    realm2 = await TestRealm.createWithAdapter(adapter2, loader, this.owner, {
      realmURL: testRealm2URL,
    });
    await realm2.ready;

    let cardService = this.owner.lookup('service:card-service') as CardService;
    // the copy button only appears after this service has loaded,
    // so let's just wait for it here
    await cardService.ready;
  });

  test('copy button does not appear when there is 1 stack for single card item', async function (assert) {
    await setCardInOperatorModeState([
      `${testRealmURL}index`,
      `${testRealmURL}Person/hassan`,
    ]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-operator-mode-stack="0"] [data-test-person]');

    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist');
  });

  test('copy button does not appear when there is 1 stack for index card with selections', async function (assert) {
    await setCardInOperatorModeState([`${testRealmURL}index`]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );

    await click(
      `[data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
    );
    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist');
  });

  test('copy button does not appear when right and left stacks are both index cards but there are no selections', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist');
  });

  test('copy button does not appear when right and left stacks are both index cards but there are selections on both sides', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
    );
    await click(
      `[data-test-overlay-card="${testRealm2URL}Pet/paper"] button.select`,
    );
    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist');
  });

  test('copy button does not appear when right and left stacks are both single cards items', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`, `${testRealmURL}Person/hassan`],
      [`${testRealm2URL}index`, `${testRealm2URL}Pet/paper`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-operator-mode-stack="0"] [data-test-person]');
    await waitFor('[data-test-operator-mode-stack="1"] [data-test-pet]');
    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist');
  });

  test('copy button does not appear when right and left stacks are the same index item and there is a selection on one side', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealmURL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
    );
    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist');
  });

  test('copy button appears when right and left stacks are index cards and there are selections on right side', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
    );
    await percySnapshot(assert);
    assert
      .dom('[data-test-copy-button="right"]')
      .exists('copy button with right arrow exists');
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 1 Card', 'button text is correct');
  });

  test('copy button appears when right and left stacks are index cards and there are selections on left side', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    await click(
      ` [data-test-overlay-card="${testRealm2URL}Pet/paper"] button.select`,
    );
    await percySnapshot(assert);
    assert
      .dom('[data-test-copy-button="left"]')
      .exists('copy button with left arrow exists');
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 1 Card', 'button text is correct');
  });

  test('copy button appears when right and left stacks are index cards and there are mulitple selections on one side', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/mango"] button.select`,
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}Pet/vangogh"] button.select`,
    );
    await percySnapshot(assert);
    assert
      .dom('[data-test-copy-button="right"]')
      .exists('copy button with right arrow exists');
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 3 Cards', 'button text is correct');
  });

  test('copy button appears when right stack is an index card and left stack is single card item', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`, `${testRealmURL}Person/hassan`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor('[data-test-operator-mode-stack="0"] [data-test-person]');
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    await percySnapshot(assert);
    assert
      .dom('[data-test-copy-button="right"]')
      .exists('copy button with right arrow exists');
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 1 Card', 'button text is correct');
  });

  test('copy button appears when left stack is an index card and right stack is single card item', async function (assert) {
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`, `${testRealm2URL}Pet/paper`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );
    await waitFor('[data-test-operator-mode-stack="1"] [data-test-pet]');
    await percySnapshot(assert);
    assert
      .dom('[data-test-copy-button="left"]')
      .exists('copy button with left arrow exists');
    assert
      .dom('[data-test-copy-button]')
      .containsText('Copy 1 Card', 'button text is correct');
  });

  QUnit.skip('can copy a card', async function (_assert) {});
  QUnit.skip('can copy mulitple cards', async function (_assert) {});
  QUnit.skip(
    'can copy a card that has a relative link to card in source realm',
    async function (_assert) {},
  );
  QUnit.skip(
    'can copy a card that has a link to card in destination realm',
    async function (_assert) {},
  );
});
