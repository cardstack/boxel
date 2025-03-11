import { click, waitFor, fillIn, find, settled } from '@ember/test-helpers';

import window from 'ember-window-mock';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import {
  type LooseSingleCardDocument,
  Deferred,
  baseRealm,
} from '@cardstack/runtime-common';

import type EnvironmentService from '@cardstack/host/services/environment-service';

import type MonacoService from '@cardstack/host/services/monaco-service';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  getMonacoContent,
  setMonacoContent,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  waitForCodeEditor,
  setupUserSubscription,
  type TestContextWithSave,
} from '../../helpers';
import { TestRealmAdapter } from '../../helpers/adapter';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

let matrixRoomId: string;
module('Acceptance | code submode | editor tests', function (hooks) {
  let monacoService: MonacoService;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    setRealmPermissions({ [testRealmURL]: ['read', 'write'] });

    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([[testRealmURL, 'Pet/mango.json']]),
    );

    ({ adapter } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Pet extends CardDef {
          static displayName = 'Pet';
          @field name = contains(StringCard);
          @field title = contains(StringCard, {
            computeVia: function (this: Pet) {
              return this.name;
            },
          });
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-pet={{@model.name}}>
                <@fields.name/>
              </h3>
            </template>
          }
        }
      `,
        'shipping-info.gts': `
        import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class ShippingInfo extends FieldDef {
          static displayName = 'Shipping Info';
          @field preferredCarrier = contains(StringCard);
          @field remarks = contains(StringCard);
          @field title = contains(StringCard, {
            computeVia: function (this: ShippingInfo) {
              return this.preferredCarrier;
            },
          });
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <span data-test-preferredCarrier={{@model.preferredCarrier}}></span>
              <@fields.preferredCarrier/>
            </template>
          }
        }
      `,
        'address.gts': `
        import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { ShippingInfo } from "./shipping-info";
        import { FieldContainer } from '@cardstack/boxel-ui/components';

        export class Address extends FieldDef {
          static displayName = 'Address';
          @field city = contains(StringCard);
          @field country = contains(StringCard);
          @field shippingInfo = contains(ShippingInfo);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-city={{@model.city}}>
                <@fields.city/>
              </h3>
              <h3 data-test-country={{@model.country}}>
                <@fields.country/>
              </h3>
              <div data-test-shippingInfo-field><@fields.shippingInfo/></div>
            </template>
          }

          static edit = class Edit extends Component<typeof this> {
            <template>
              <FieldContainer @label='city' @tag='label' data-test-boxel-input-city>
                <@fields.city />
              </FieldContainer>
              <FieldContainer @label='country' @tag='label' data-test-boxel-input-country>
                <@fields.country />
              </FieldContainer>
              <div data-test-shippingInfo-field><@fields.shippingInfo/></div>
            </template>
          };
        }
      `,
        'person.gts': `
        import { contains, linksTo, field, Component, CardDef, linksToMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";
        import { Address } from "./address";

        export class Person extends CardDef {
          static displayName = 'Person';
          @field firstName = contains(StringCard);
          @field pet = linksTo(Pet);
          @field friends = linksToMany(Pet);
          @field firstLetterOfTheName = contains(StringCard, {
            computeVia: function (this: Chain) {
              return this.firstName[0];
            },
          });
          @field title = contains(StringCard, {
            computeVia: function (this: Person) {
              return this.firstName;
            },
          });
          @field address = contains(Address);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h2 data-test-person={{@model.firstName}}>
                <@fields.firstName/>
              </h2>
              <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
                <@fields.firstLetterOfTheName/>
              </p>
              Pet: <@fields.pet/>
              Friends: <@fields.friends/>
              Address: <@fields.address/>
            </template>
          }
        }
      `,
        'README.txt': `Hello World`,
        'Pet/mango.json': {
          data: {
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
        'Pet/vangogh.json': {
          data: {
            attributes: {
              name: 'Van Gogh',
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
            attributes: {
              firstName: 'Fadhlan',
              address: {
                city: 'Bandung',
                country: 'Indonesia',
                shippingInfo: {
                  preferredCarrier: 'DHL',
                  remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
                },
              },
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
        'grid.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        'index.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
        'Person/john-with-bad-pet-link.json': {
          data: {
            attributes: {
              firstName: 'John',
              address: {
                city: 'Ljubljana',
                country: 'Slovenia',
              },
            },
            relationships: {
              pet: {
                links: {
                  self: `http://badlink.com/nonexisting-pet`,
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
      },
    }));
  });

  test('card instance JSON displayed in monaco editor', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });
    await waitForCodeEditor();

    assert.false(
      monacoService?.editor?.getOption(MonacoSDK.editor.EditorOption.readOnly),
      'editor should not be read-only',
    );
    assert.deepEqual(JSON.parse(getMonacoContent()), {
      data: {
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
    });

    // TODO we often timeout waiting for syntax highlighting, so i'm commenting
    // out this assertion and creating a ticket to research this: CS-6770

    // await waitForSyntaxHighlighting('"Pet"', 'rgb(4, 81, 165)');
    // await percySnapshot(assert);
  });

  test<TestContextWithSave>('allows fixing broken cards', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/john-with-bad-pet-link.json`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Person/john-with-bad-pet-link.json`,
    });
    await waitFor('[data-test-editor]');

    let editedCard: LooseSingleCardDocument = {
      data: {
        attributes: {
          firstName: 'John',
          address: {
            city: 'Ljubljana',
            country: 'Slovenia',
          },
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
    };

    setMonacoContent(JSON.stringify(editedCard));
    await settled();

    let fileRef = await adapter.openFile('Person/john-with-bad-pet-link.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      fileRef.content as string,
      JSON.stringify(editedCard),
      'Person/john-with-bad-pet-link.json changes were saved',
    );
  });

  test<TestContextWithSave>('card instance change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(4);

    let expected: LooseSingleCardDocument = {
      data: {
        attributes: {
          name: 'MangoXXX',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        },
      },
    };
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });

    await waitForCodeEditor();
    assert
      .dom('[data-test-code-mode-card-preview-body] [data-test-field="name"]')
      .containsText('Mango');

    this.onSave((url, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.strictEqual(url.href, `${testRealmURL}Pet/mango.json`);
      assert.strictEqual(JSON.parse(content).data.attributes?.name, 'MangoXXX');
    });

    setMonacoContent(JSON.stringify(expected));
    await settled();

    assert
      .dom('[data-test-code-mode-card-preview-body] [data-test-field="name"]')
      .containsText('MangoXXX');
  });

  test<TestContextWithSave>('card instance change made in card editor is auto-saved', async function (assert) {
    assert.expect(2);

    let expected: LooseSingleCardDocument = {
      data: {
        id: `${testRealmURL}Pet/mango`,
        type: 'card',
        attributes: {
          name: 'MangoXXX',
          title: 'MangoXXX',
          description: null,
          thumbnailURL: null,
        },
        meta: {
          adoptsFrom: {
            module: `../pet`,
            name: 'Pet',
          },
        },
      },
    };
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });
    await waitForCodeEditor();

    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(url.href, `${testRealmURL}Pet/mango`);
      delete json.data.links;
      delete json.data.meta.realmInfo;
      delete json.data.meta.realmURL;
      delete json.data.meta.lastModified;
      delete json.data.meta.resourceCreatedAt;
      assert.strictEqual(
        stringify(json),
        stringify(expected),
        'saved card is correct',
      );
    });

    await click('[data-test-format-chooser-edit]');
    await fillIn('[data-test-field="name"] input', 'MangoXXX');
    await waitFor('[data-test-save-idle]');
  });

  test<TestContextWithSave>('non-card instance change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(2);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    });
    await waitForCodeEditor();

    this.onSave((url, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.strictEqual(url.href, `${testRealmURL}README.txt`);
      assert.strictEqual(content, 'Hello Mars');
    });

    setMonacoContent('Hello Mars');

    await waitFor('[data-test-save-idle]');
  });

  test<TestContextWithSave>('unsaved changes made in monaco editor are saved when switching out of code submode', async function (assert) {
    assert.expect(2);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    });
    await waitForCodeEditor();

    this.onSave((url, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.strictEqual(url.href, `${testRealmURL}README.txt`);
      assert.strictEqual(content, 'Hello Mars');
    });

    setMonacoContent('Hello Mars');
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
  });

  test<TestContextWithSave>('unsaved changes made in monaco editor are saved when opening a different file', async function (assert) {
    let environment = this.owner.lookup(
      'service:environment-service',
    ) as EnvironmentService;
    environment.autoSaveDelayMs = 1000; // slowdown the auto save so it doesn't interfere with this test
    assert.expect(2);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    });
    await waitForCodeEditor();
    let deferred = new Deferred<void>();
    this.onSave((url, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.strictEqual(url.href, `${testRealmURL}README.txt`);
      assert.strictEqual(content, 'Hello Mars');
      deferred.fulfill();
    });

    setMonacoContent('Hello Mars');
    await new Promise((r) => setTimeout(r, 100));
    await click(`[data-test-recent-file="${testRealmURL}Pet/mango.json"]`);

    await deferred.promise;
  });

  test<TestContextWithSave>('unsaved changes made in card editor are saved when switching out of code submode', async function (assert) {
    let environment = this.owner.lookup(
      'service:environment-service',
    ) as EnvironmentService;
    environment.autoSaveDelayMs = 1000; // slowdown the auto save so it doesn't interfere with this test
    let numSaves = 0;
    assert.expect(2);

    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });
    await waitForCodeEditor();

    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      if (numSaves > 0) {
        // this is the auto-save--we can ignore it
      } else {
        assert.strictEqual(url.href, `${testRealmURL}Pet/mango`);
        assert.strictEqual(json.data.attributes?.name, 'MangoXXX');
        numSaves++;
      }
    });

    await click('[data-test-format-chooser-edit]');
    await fillIn('[data-test-field="name"] input', 'MangoXXX');
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
  });

  test<TestContextWithSave>('invalid JSON card instance change made in monaco editor is NOT auto-saved', async function (assert) {
    assert.expect(1);
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });
    await waitForCodeEditor();

    this.onSave(() => {
      assert.ok(false, `save should never happen`);
    });
    setMonacoContent(`{ this is not actual JSON }`);

    // autosave happens 500ms after inactivity, so we wait 1s to make sure save
    // doesn't occur
    await new Promise((res) => setTimeout(res, 1000));

    assert.strictEqual(getMonacoContent(), `{ this is not actual JSON }`);
  });

  test<TestContextWithSave>('card definition change made in monaco editor is auto-saved', async function (assert) {
    let expected = `
    import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
    import StringCard from "https://cardstack.com/base/string";

    export class Pet extends CardDef {
      static displayName = 'PetXXX';  // this is the change
      @field name = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name/>
          </h3>
        </template>
      }
    }
  `;

    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Pet/mango`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await waitForCodeEditor();

    setMonacoContent(expected);
    await settled();

    let fileRef = await adapter.openFile('pet.gts');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      fileRef.content as string,
      expected,
      'pet.gts changes were saved',
    );
  });

  module('when the user lacks write permissions', function (hooks) {
    hooks.beforeEach(function () {
      setRealmPermissions({ [testRealmURL]: ['read'] });
    });

    test('the editor is read-only', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}pet.gts`,
      });

      await waitForCodeEditor();

      assert.true(
        monacoService?.editor?.getOption(
          MonacoSDK.editor.EditorOption.readOnly,
        ),
        'editor should be read-only',
      );

      assert.dom('[data-test-realm-indicator-not-writable]').exists();
      assert.strictEqual(
        window
          .getComputedStyle(find('.monaco-editor-background')!)
          .getPropertyValue('background-color')!,
        'rgb(235, 234, 237)', // equivalent to #ebeaed
        'monaco editor is greyed out when read-only',
      );

      assert
        .dom('[data-test-add-field-button]')
        .doesNotExist('add field button does not exist');
      assert
        .dom('[data-test-schema-editor-field-contextual-button]')
        .doesNotExist('field context menu button does not exist');
    });
  });
});
