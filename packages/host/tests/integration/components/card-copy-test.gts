import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import {
  baseRealm,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';
import { Loader } from '@cardstack/runtime-common/loader';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import CardPrerender from '@cardstack/host/components/card-prerender';
import { renderComponent } from '../../helpers/render-component';
import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  setupServerSentEvents,
  TestRealmAdapter,
  TestRealm,
  type TestContextWithSave,
  type TestContextWithSSE,
} from '../../helpers';
import { waitUntil, waitFor, click } from '@ember/test-helpers';
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

type TestContextForCopy = TestContextWithSave & TestContextWithSSE;

module('Integration | card-copy', function (hooks) {
  let onFetch: ((req: Request, body: string) => void) | undefined;
  let adapter1: TestRealmAdapter;
  let adapter2: TestRealmAdapter;
  let realm1: Realm;
  let realm2: Realm;
  let noop = () => {};
  function wrappedOnFetch() {
    return async (req: Request) => {
      if (!onFetch) {
        return Promise.resolve(req);
      }
      let { headers, method } = req;
      let body = await req.text();
      onFetch(req, body);
      // need to return a new request since we just read the body
      return new Request(req.url, {
        method,
        headers,
        ...(body ? { body } : {}),
      });
    };
  }

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
  setupServerSentEvents(hooks);
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
      onFetch: wrappedOnFetch(),
    });
    await realm1.ready;

    realm2 = await TestRealm.createWithAdapter(adapter2, loader, this.owner, {
      realmURL: testRealm2URL,
      onFetch: wrappedOnFetch(),
    });
    await realm2.ready;

    // write in the new record last because it's link didn't exist until realm2 was created
    await realm1.write(
      'Person/sakura.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            firstName: 'Sakura',
          },
          relationships: {
            pet: {
              links: {
                self: `${testRealm2URL}Pet/paper`,
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
      } as LooseSingleCardDocument),
    );

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

  test<TestContextForCopy>('can copy a card', async function (assert) {
    assert.expect(11);
    let expectedEvents = ['added: Pet/1.json', 'index: incremental'];
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
    this.onSave((json) => {
      assert.strictEqual(json.data.id, `${testRealm2URL}Pet/1`);
      assert.strictEqual(json.data.attributes?.firstName, 'Mango');
      assert.deepEqual(json.data.meta.adoptsFrom, {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      });
      assert.strictEqual(json.data.meta.realmURL, testRealm2URL);
    });
    await this.expectEvents(
      assert,
      realm2,
      adapter2,
      expectedEvents,
      async () => {
        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
        );
        await waitFor(
          '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] button.select`,
        );
        assert
          .dom(`.selected[data-test-overlay-card="${testRealmURL}Pet/mango"]`)
          .exists('souce card is selected');
        assert
          .dom(
            `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/1"]`,
          )
          .doesNotExist('card does not initially exist in destiation realm');
        await click('[data-test-copy-button]');
      },
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/1"]`,
      )
      .exists('copied card appears in destination realm');
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/1"]`,
      )
      .containsText('Mango');

    // assert that the selected card state is reset properly
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );
    assert
      .dom(`.selected[data-test-overlay-card="${testRealmURL}Pet/mango"]`)
      .doesNotExist('souce card is not selected');

    await click(
      `[data-test-overlay-card="${testRealm2URL}Pet/paper"] button.select`,
    );
    assert
      .dom('[data-test-copy-button="left"]')
      .exists('copy button with left arrow exists');
  });

  test<TestContextForCopy>('can copy mulitple cards', async function (assert) {
    assert.expect(8);
    let expectedEvents = [
      'added: Pet/1.json',
      'index: incremental',
      'added: Pet/2.json',
      'index: incremental',
    ];
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
    let savedCards: SingleCardDocument[] = [];
    this.onSave((json) => {
      savedCards.push(json);
    });
    await this.expectEvents(
      assert,
      realm2,
      adapter2,
      expectedEvents,
      async () => {
        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
        );
        await waitFor(
          '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] button.select`,
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Pet/vangogh"] button.select`,
        );

        assert
          .dom(
            `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/1"]`,
          )
          .doesNotExist('card does not initially exist in destiation realm');
        assert
          .dom(
            `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/2"]`,
          )
          .doesNotExist('card does not initially exist in destiation realm');
        await click('[data-test-copy-button]');
      },
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 3,
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/1"]`,
      )
      .exists('copied card appears in destination realm');
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/2"]`,
      )
      .exists('copied card appears in destination realm');
    assert.strictEqual(savedCards.length, 2, 'correct number of cards saved');
    assert.deepEqual(savedCards.map((c) => c.data.id).sort(), [
      `${testRealm2URL}Pet/1`,
      `${testRealm2URL}Pet/2`,
    ]);
    assert.deepEqual(
      savedCards.map((c) => c.data.attributes?.firstName).sort(),
      ['Mango', 'Van Gogh'],
    );
  });

  test<TestContextForCopy>('can copy a card that has a relative link to card in source realm', async function (assert) {
    assert.expect(17);
    let expectedEvents = ['added: Person/1.json', 'index: incremental'];
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
    onFetch = (req, body) => {
      if (req.method !== 'GET') {
        let json = JSON.parse(body);
        assert.strictEqual(json.data.attributes.firstName, 'Hassan');
        assert.strictEqual(
          json.included,
          undefined,
          'included not being sent over the wire',
        );
      }
    };

    this.onSave((json) => {
      assert.strictEqual(json.data.id, `${testRealm2URL}Person/1`);
      assert.strictEqual(json.data.attributes?.firstName, 'Hassan');
      assert.deepEqual(json.data.meta.adoptsFrom, {
        module: `${testRealmURL}person`,
        name: 'Person',
      });
      assert.strictEqual(json.data.meta.realmURL, testRealm2URL);
      assert.deepEqual(json.data.relationships, {
        pet: {
          links: {
            self: `${testRealmURL}Pet/mango`,
          },
          data: {
            type: 'card',
            id: `${testRealmURL}Pet/mango`,
          },
        },
      });
      assert.strictEqual(json.included?.length, 1);
      let included = json.included?.[0]!;
      assert.strictEqual(included.id, `${testRealmURL}Pet/mango`);
      assert.deepEqual(included.meta.adoptsFrom, {
        module: `../pet`, // this is ok because it is relative to the incuded's id
        name: 'Pet',
      });
      assert.deepEqual(included.meta.realmURL, testRealmURL);
    });
    await this.expectEvents(
      assert,
      realm2,
      adapter2,
      expectedEvents,
      async () => {
        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
        );
        await waitFor(
          '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
        );

        assert
          .dom(
            `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/1"]`,
          )
          .doesNotExist('card does not initially exist in destiation realm');
        await click('[data-test-copy-button]');
      },
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/1"]`,
      )
      .exists('copied card appears in destination realm');

    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/1"]`,
      )
      .containsText('Hassan');
  });

  test<TestContextForCopy>('can copy a card that has a link to card in destination realm', async function (assert) {
    assert.expect(17);
    let expectedEvents = ['added: Person/1.json', 'index: incremental'];
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
    onFetch = (req, body) => {
      if (req.method !== 'GET') {
        let json = JSON.parse(body);
        assert.strictEqual(json.data.attributes.firstName, 'Sakura');
        assert.strictEqual(
          json.included,
          undefined,
          'included not being sent over the wire',
        );
      }
    };
    this.onSave((json) => {
      assert.strictEqual(json.data.id, `${testRealm2URL}Person/1`);
      assert.strictEqual(json.data.attributes?.firstName, 'Sakura');
      assert.deepEqual(json.data.meta.adoptsFrom, {
        module: `${testRealmURL}person`,
        name: 'Person',
      });
      assert.strictEqual(json.data.meta.realmURL, testRealm2URL);
      assert.deepEqual(json.data.relationships, {
        pet: {
          links: {
            self: `../Pet/paper`, // we should recognize that the link is now in the same realm and should be a relative path
          },
          data: {
            type: 'card',
            id: `${testRealm2URL}Pet/paper`,
          },
        },
      });
      assert.strictEqual(json.included?.length, 1);
      let included = json.included?.[0]!;
      assert.strictEqual(included.id, `${testRealm2URL}Pet/paper`);
      assert.deepEqual(included.meta.adoptsFrom, {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      });
      assert.deepEqual(included.meta.realmURL, testRealm2URL);
    });
    await this.expectEvents(
      assert,
      realm2,
      adapter2,
      expectedEvents,
      async () => {
        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
        );
        await waitFor(
          '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Person/sakura"] button.select`,
        );

        assert
          .dom(
            `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/1"]`,
          )
          .doesNotExist('card does not initially exist in destiation realm');
        await click('[data-test-copy-button]');
      },
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/1"]`,
      )
      .exists('copied card appears in destination realm');

    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/1"]`,
      )
      .containsText('Sakura');
  });
});
