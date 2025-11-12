import { waitUntil, waitFor, click, triggerEvent } from '@ember/test-helpers';

import { buildWaiter } from '@ember/test-waiters';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';
import { validate as uuidValidate } from 'uuid';

import {
  baseRealm,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { Realm } from '@cardstack/runtime-common/realm';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  IncrementalIndexEventContent,
  IndexRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  type TestContextWithSave,
  setupIntegrationTestRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const testRealm2URL = `http://test-realm/test2/`;
const readOnlyRealmURL = `http://test-realm/test-read-only/`;
let loader: Loader;
let setCardInOperatorModeState: (
  leftCards: string[],
  rightCards?: string[],
) => Promise<void>;

module('Integration | card-copy', function (hooks) {
  let realm1: Realm;
  let noop = () => {};

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let loggedInAs = '@testuser:localhost';

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs,
    activeRealms: [
      baseRealm.url,
      testRealmURL,
      testRealm2URL,
      readOnlyRealmURL,
    ],
    realmPermissions: {
      [readOnlyRealmURL]: ['read'],
    },
    autostart: true,
  });

  let { getRoomIdForRealmAndUser, getRealmEventMessagesSince } =
    mockMatrixUtils;

  hooks.beforeEach(async function () {
    setCardInOperatorModeState = async (
      leftCards: string[],
      rightCards: string[] = [],
    ) => {
      let operatorModeStateService = getService('operator-mode-state-service');

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
      operatorModeStateService.restore({ stacks });
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
          <div class='pet-container'>
            <@fields.pet />
          </div>
          <style scoped>
            .pet-container {
              height: 80px;
              padding: 10px;
            }
          </style>
        </template>
      };
    }

    ({ realm: realm1 } = await setupIntegrationTestRealm({
      mockMatrixUtils,
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

    await setupIntegrationTestRealm({
      mockMatrixUtils,
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
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
      },
    });

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
        </template>
      },
    );
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(
      '[data-test-operator-mode-stack="0"] [data-test-cards-grid-item]',
    );

    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/hassan"]`);
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
        </template>
      },
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
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
        </template>
      },
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/hassan"]`);
    await waitFor(
      `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/paper"]`,
    );
    await triggerEvent(
      `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/paper"] .field-component-card`,
      'mouseenter',
    );
    await waitFor(
      `[data-test-operator-mode-stack="1"] [data-test-overlay-select="${testRealm2URL}Pet/paper"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-overlay-select="${testRealm2URL}Pet/paper"]`,
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
        </template>
      },
    );
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-overlay-select="${testRealmURL}Person/hassan"]`,
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
        </template>
      },
    );
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-overlay-select="${testRealmURL}Person/hassan"]`,
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
        </template>
      },
    );
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/hassan"]`);
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
        </template>
      },
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealm2URL}Pet/paper"] .field-component-card`,
      'mouseenter',
    );
    await click(` [data-test-overlay-select="${testRealm2URL}Pet/paper"]`);
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
        </template>
      },
    );
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/hassan"]`);
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/mango"]`);
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/vangogh"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/vangogh"]`);
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
        </template>
      },
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
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

  test('copy button does not appear when destination index belongs to read-only realm', async function (assert) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: readOnlyRealmURL,
      permissions: {
        '@testuser:localhost': ['read'],
        '*': ['read'],
      },
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
          name: 'Read Only Workspace',
          backgroundURL:
            'https://i.postimg.cc/tgRHRV8C/pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg',
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
      },
    });

    await setCardInOperatorModeState(
      [`${testRealmURL}index`, `${testRealmURL}Person/hassan`],
      [`${readOnlyRealmURL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await waitFor('[data-test-operator-mode-stack="0"] [data-test-person]');
    await waitFor(
      '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
    );

    assert
      .dom('[data-test-copy-button]')
      .doesNotExist('copy button does not exist for read-only destination');
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
        </template>
      },
    );
    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
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

  test<TestContextWithSave>('can copy a card', async function (assert) {
    assert.expect(13);
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let id: string | undefined;
    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      id = url.href.split('/').pop()!;
      assert.true(uuidValidate(id), 'card identifier is UUID');
      assert.strictEqual(json.data.id, `${testRealm2URL}Pet/${id}`);
      assert.strictEqual(json.data.attributes?.firstName, 'Mango');
      assert.deepEqual(json.data.meta.adoptsFrom, {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      });
      assert.strictEqual(json.data.meta.realmURL, testRealm2URL);
    });

    let realmEventTimestampStart = Date.now();

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/mango"]`);
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

    let realmSessionRoomId = getRoomIdForRealmAndUser(
      testRealm2URL,
      loggedInAs,
    );

    await waitUntil(async () => {
      let matrixMessages = await getRealmEventMessagesSince(
        realmSessionRoomId,
        realmEventTimestampStart,
      );

      return matrixMessages.some(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === 'incremental',
      );
    });

    let realmEventMessages = getRealmEventMessagesSince(
      realmSessionRoomId,
      realmEventTimestampStart,
    );

    let incrementalIndexEvent: IncrementalIndexEventContent | undefined =
      realmEventMessages.find(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === 'incremental',
      )?.content as IncrementalIndexEventContent;

    assert.ok(incrementalIndexEvent, 'incremental index event was emitted');

    assert.deepEqual(incrementalIndexEvent?.invalidations, [
      `${testRealm2URL}Pet/${id}`,
    ]);

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

    await triggerEvent(
      `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/${id}"] .field-component-card`,
      'mouseenter',
    );
    await waitFor(
      `[data-test-operator-mode-stack="1"] [data-test-overlay-select="${testRealm2URL}Pet/${id}"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-overlay-select="${testRealm2URL}Pet/${id}"]`,
    );
    assert
      .dom('[data-test-copy-button="left"]')
      .exists('copy button with left arrow exists');
  });

  test<TestContextWithSave>('can copy multiple cards', async function (assert) {
    assert.expect(7);
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards: SingleCardDocument[] = [];
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      savedCards.push(json);
    });

    let realmEventTimestampStart = Date.now();

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/mango"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/mango"]`);
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/vangogh"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/vangogh"]`);

    assert.strictEqual(
      document.querySelectorAll(
        '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
      ).length,
      1,
      '1 card exists in destination realm',
    );
    await click('[data-test-copy-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 3,
    );

    let realmSessionRoomId = getRoomIdForRealmAndUser(
      testRealm2URL,
      loggedInAs,
    );

    let realmIndexEventMessages = getRealmEventMessagesSince(
      realmSessionRoomId,
      realmEventTimestampStart,
    )
      .filter((m) => m.content.eventName === 'index')
      .map((m) => m.content) as IndexRealmEventContent[];

    assert.deepEqual(
      realmIndexEventMessages.map((e: IndexRealmEventContent) => e.indexType),
      [
        'incremental-index-initiation',
        'incremental',
        'incremental-index-initiation',
        'incremental',
      ],
      'event types are correct',
    );

    let invalidationIds = realmIndexEventMessages.reduce(
      (invalidationIds: string[], e: IndexRealmEventContent) => {
        if (e.indexType === 'incremental') {
          return invalidationIds.concat(e.invalidations);
        }
        return invalidationIds;
      },
      [],
    ) as string[];

    assert.deepEqual(
      invalidationIds,
      [savedCards[0].data.id, savedCards[1].data.id],
      'event invalidations are correct',
    );

    assert.strictEqual(savedCards.length, 2, 'correct number of cards saved');
    let cardIds = savedCards.map((c) => c.data.id!.split('/').pop()!);
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

  test<TestContextWithSave>('can copy a card that has a relative link to card in source realm', async function (assert) {
    assert.expect(15);
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    let waiter = buildWaiter('body-interception-middleware');

    getService('network').mount(
      async (req) => {
        if (
          req.method !== 'GET' &&
          req.method !== 'HEAD' &&
          !(
            req.method === 'POST' &&
            req.headers.get('X-HTTP-Method-Override') === 'QUERY'
          )
        ) {
          let token = waiter.beginAsync();
          let json = JSON.parse(await req.clone().text());
          waiter.endAsync(token);
          assert.strictEqual(json.data.attributes.firstName, 'Hassan');
        }
        return null;
      },
      { prepend: true },
    );

    let realmEventTimestampStart = Date.now();

    let id: string | undefined;
    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      id = url.href.split('/').pop()!;
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
        'cardInfo.theme': { links: { self: null } },
      });
      assert.strictEqual(json.included?.length, 1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      let included = json.included?.[0]!;
      assert.strictEqual(included.id, `${testRealmURL}Pet/mango`);
      assert.deepEqual(included.meta.adoptsFrom, {
        module: `../pet`, // this is ok because it is relative to the incuded's id
        name: 'Pet',
      });
      assert.deepEqual(included.meta.realmURL, testRealmURL);
    });

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/hassan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/hassan"]`);

    assert.strictEqual(
      document.querySelectorAll(
        '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
      ).length,
      1,
      '1 card exists in destination realm',
    );
    await click('[data-test-copy-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]`,
        ).length === 2,
    );

    let realmSessionRoomId = getRoomIdForRealmAndUser(
      testRealm2URL,
      loggedInAs,
    );

    let realmEventMessages = getRealmEventMessagesSince(
      realmSessionRoomId,
      realmEventTimestampStart,
    );

    let incrementalIndexEvent: IncrementalIndexEventContent | undefined =
      realmEventMessages.find(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === 'incremental',
      )?.content as IncrementalIndexEventContent;

    assert.ok(incrementalIndexEvent, 'incremental index event was emitted');

    assert.deepEqual(
      (incrementalIndexEvent as IncrementalIndexEventContent).invalidations,
      [`${testRealm2URL}Person/${id}`],
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

  test<TestContextWithSave>('can copy a card that has a link to card in destination realm', async function (assert) {
    assert.expect(15);
    await setCardInOperatorModeState(
      [`${testRealmURL}index`],
      [`${testRealm2URL}index`],
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    let waiter = buildWaiter('body-interception-middleware');

    getService('network').mount(
      async (req) => {
        if (
          req.method !== 'GET' &&
          req.method !== 'HEAD' &&
          !(
            req.method === 'POST' &&
            req.headers.get('X-HTTP-Method-Override') === 'QUERY'
          )
        ) {
          let token = waiter.beginAsync();
          let json = JSON.parse(await req.clone().text());
          waiter.endAsync(token);
          assert.strictEqual(json.data.attributes.firstName, 'Sakura');
        }
        return null;
      },
      { prepend: true },
    );

    let id: string | undefined;
    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      id = url.href.split('/').pop()!;
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
        'cardInfo.theme': { links: { self: null } },
      });
      assert.strictEqual(json.included?.length, 1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      let included = json.included?.[0]!;
      assert.strictEqual(included.id, `${testRealm2URL}Pet/paper`);
      assert.deepEqual(included.meta.adoptsFrom, {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      });
      assert.deepEqual(included.meta.realmURL, testRealm2URL);
    });

    let realmEventTimestampStart = Date.now();

    await click(
      `[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await click(
      `[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]`,
    );
    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/sakura"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/sakura"]`);

    assert.strictEqual(
      document.querySelectorAll(
        '[data-test-operator-mode-stack="1"] [data-test-cards-grid-item]',
      ).length,
      1,
      '1 card exists in destination realm',
    );
    await click('[data-test-copy-button]');

    let realmSessionRoomId = getRoomIdForRealmAndUser(
      testRealm2URL,
      loggedInAs,
    );

    let realmEventMessages = getRealmEventMessagesSince(
      realmSessionRoomId,
      realmEventTimestampStart,
    );

    let incrementalIndexEvent: IncrementalIndexEventContent | undefined =
      realmEventMessages.find(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === 'incremental',
      )?.content as IncrementalIndexEventContent;

    assert.ok(incrementalIndexEvent, 'incremental index event was emitted');

    assert.deepEqual(incrementalIndexEvent?.invalidations, [
      `${testRealm2URL}Person/${id}`,
    ]);

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
