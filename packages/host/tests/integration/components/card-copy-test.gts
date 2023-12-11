import { waitUntil, waitFor, click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import flatMap from 'lodash/flatMap';
import { module, test } from 'qunit';
import { validate as uuidValidate } from 'uuid';

import {
  baseRealm,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type LoaderService from '@cardstack/host/services/loader-service';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  setupServerSentEvents,
  type TestContextWithSave,
  type TestContextWithSSE,
  setupIntegrationTestRealm,
} from '../../helpers';
import { setupMatrixServiceMock } from '../../helpers/mock-matrix-service';
import { renderComponent } from '../../helpers/render-component';

const testRealm2URL = `http://test-realm/test2/`;
let loader: Loader;
let setCardInOperatorModeState: (
  leftCards: string[],
  rightCards?: string[],
) => Promise<void>;

type TestContextForCopy = TestContextWithSave & TestContextWithSSE;

module('Integration | card-copy', function (hooks) {
  let onFetch: ((req: Request, body: string) => void) | undefined;
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
  setupMatrixServiceMock(hooks);
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
          type: 'card' as const,
          id: url,
          format: 'isolated' as const,
        })),
        rightCards.map((url) => ({
          type: 'card' as const,
          id: url,
          format: 'isolated' as const,
        })),
      ].filter((a) => a.length > 0);
      await operatorModeStateService.restore({ stacks });
    };
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, linksTo, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-pet={{@model.firstName}}><@fields.firstName /></h2>
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.firstName}}><@fields.firstName /></h3>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}><@fields.firstName /></h2>
          <@fields.pet />
        </template>
      };
    }

    ({ realm: realm1 } = await setupIntegrationTestRealm({
      loader,
      onFetch: wrappedOnFetch(),
      contents: {
        'person.gts': { Person },
        'pet.gts': { Pet },
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
      },
    }));

    ({ realm: realm2 } = await setupIntegrationTestRealm({
      loader,
      realmURL: testRealm2URL,
      contents: {
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
      },
    }));

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

  test('copy button does not appear when right and left stacks are both the same index card', async function (assert) {
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
    assert.expect(12);
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
    let id: string | undefined;
    this.onSave((json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      id = json.data.id.split('/').pop()!;
      assert.true(uuidValidate(id), 'card identifier is UUID');
      assert.strictEqual(json.data.id, `${testRealm2URL}Pet/${id}`);
      assert.strictEqual(json.data.attributes?.firstName, 'Mango');
      assert.deepEqual(json.data.meta.adoptsFrom, {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      });
      assert.strictEqual(json.data.meta.realmURL, testRealm2URL);
    });
    await this.expectEvents({
      assert,
      realm: realm2,
      expectedNumberOfEvents: 1,
      onEvents: ([event]) => {
        if (event.type === 'index') {
          assert.deepEqual(event.data.invalidations, [
            `${testRealm2URL}Pet/${id}`,
          ]);
        } else {
          assert.ok(
            false,
            `expected 'index' event, but received ${JSON.stringify(event)}`,
          );
        }
      },
      callback: async () => {
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
        assert.strictEqual(
          document.querySelectorAll(
            '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
          ).length,
          1,
          '1 card exists in destination realm',
        );
        await click('[data-test-copy-button]');
      },
    });
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );
    if (!id) {
      assert.ok(false, 'new card identifier was undefined');
    }
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/${id}"]`,
      )
      .exists('copied card appears in destination realm');
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/${id}"]`,
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
    assert.expect(7);
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
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      savedCards.push(json);
    });
    await this.expectEvents({
      assert,
      realm: realm2,
      expectedNumberOfEvents: 2,
      onEvents: (events) => {
        assert.deepEqual(
          events.map((e) => e.type),
          ['index', 'index'],
          'event types are correct',
        );
        assert.deepEqual(
          flatMap(events, (e) => e.data.invalidations),
          [savedCards[0].data.id, savedCards[1].data.id],
          'event invalidations are correct',
        );
      },
      callback: async () => {
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

        assert.strictEqual(
          document.querySelectorAll(
            '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
          ).length,
          1,
          '1 card exists in destination realm',
        );
        await click('[data-test-copy-button]');
      },
    });
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 3,
    );
    assert.strictEqual(savedCards.length, 2, 'correct number of cards saved');
    let cardIds = savedCards.map((c) => c.data.id.split('/').pop()!);
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/${cardIds[0]}"]`,
      )
      .exists('copied card appears in destination realm');
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/${cardIds[1]}"]`,
      )
      .exists('copied card appears in destination realm');
    assert.deepEqual(
      savedCards.map((c) => c.data.attributes?.firstName).sort(),
      ['Mango', 'Van Gogh'],
    );
  });

  test<TestContextForCopy>('can copy a card that has a relative link to card in source realm', async function (assert) {
    assert.expect(15);
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

    let id: string | undefined;
    this.onSave((json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      id = json.data.id.split('/').pop()!;
      assert.strictEqual(json.data.id, `${testRealm2URL}Person/${id}`);
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
    await this.expectEvents({
      assert,
      realm: realm2,
      expectedNumberOfEvents: 1,
      onEvents: ([event]) => {
        if (event.type === 'index') {
          assert.deepEqual(event.data.invalidations, [
            `${testRealm2URL}Person/${id}`,
          ]);
        } else {
          assert.ok(
            false,
            `expected 'index' event, but received ${JSON.stringify(event)}`,
          );
        }
      },
      callback: async () => {
        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
        );
        await waitFor(
          '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Person/hassan"] button.select`,
        );

        assert.strictEqual(
          document.querySelectorAll(
            '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
          ).length,
          1,
          '1 card exists in destination realm',
        );
        await click('[data-test-copy-button]');
      },
    });
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );
    if (!id) {
      assert.ok(false, 'new card identifier was undefined');
    }
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/${id}"]`,
      )
      .exists('copied card appears in destination realm');

    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/${id}"]`,
      )
      .containsText('Hassan');
  });

  test<TestContextForCopy>('can copy a card that has a link to card in destination realm', async function (assert) {
    assert.expect(15);
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
    let id: string | undefined;
    this.onSave((json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      id = json.data.id.split('/').pop()!;
      assert.strictEqual(json.data.id, `${testRealm2URL}Person/${id}`);
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
    await this.expectEvents({
      assert,
      realm: realm2,
      expectedNumberOfEvents: 1,
      onEvents: ([event]) => {
        if (event.type === 'index') {
          assert.deepEqual(event.data.invalidations, [
            `${testRealm2URL}Person/${id}`,
          ]);
        } else {
          assert.ok(
            false,
            `expected 'index' event, but received ${JSON.stringify(event)}`,
          );
        }
      },
      callback: async () => {
        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
        );
        await waitFor(
          '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
        );
        await click(
          `[data-test-overlay-card="${testRealmURL}Person/sakura"] button.select`,
        );

        assert.strictEqual(
          document.querySelectorAll(
            '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
          ).length,
          1,
          '1 card exists in destination realm',
        );
        await click('[data-test-copy-button]');
      },
    });
    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );
    if (!id) {
      assert.ok(false, 'new card identifier was undefined');
    }
    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/${id}"]`,
      )
      .exists('copied card appears in destination realm');

    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Person/${id}"]`,
      )
      .containsText('Sakura');
  });
});
