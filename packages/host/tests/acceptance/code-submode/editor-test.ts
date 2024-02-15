import { click, waitFor, fillIn } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';

import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import {
  type LooseSingleCardDocument,
  Deferred,
} from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';

import type EnvironmentService from '@cardstack/host/services/environment-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

import {
  TestRealmAdapter,
  percySnapshot,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  getMonacoContent,
  setMonacoContent,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  waitForSyntaxHighlighting,
  waitForCodeEditor,
  type TestContextWithSSE,
  type TestContextWithSave,
} from '../../helpers';
import { setupMatrixServiceMock } from '../../helpers/mock-matrix-service';

let realmPermissions: { [realmURL: string]: ('read' | 'write')[] } = {
  [testRealmURL]: ['read', 'write'],
};

module('Acceptance | code submode | editor tests', function (hooks) {
  let realm: Realm;
  let monacoService: MonacoService;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);
  setupWindowMock(hooks);
  setupMatrixServiceMock(hooks, () => realmPermissions);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-cards');
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    realmPermissions = { [testRealmURL]: ['read', 'write'] };

    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    window.localStorage.removeItem('recent-cards');
    window.localStorage.removeItem('recent-files');

    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([[testRealmURL, 'Pet/mango.json']]),
    );

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    ({ realm, adapter } = await setupAcceptanceTestRealm({
      loader,
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

    await this.pauseTest();

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
    await waitForSyntaxHighlighting('"Pet"', 'rgb(4, 81, 165)');
    await percySnapshot(assert);
  });

  test<
    TestContextWithSave & TestContextWithSSE
  >('allows fixing broken cards', async function (assert) {
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

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Person/john-with-bad-pet-link`],
        },
      },
    ];

    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        setMonacoContent(JSON.stringify(editedCard));
        await waitFor('[data-test-save-idle]');
      },
    });

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

  test<
    TestContextWithSave & TestContextWithSSE
  >('card instance change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(5);
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Pet/mango`],
        },
      },
    ];

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

    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        setMonacoContent(JSON.stringify(expected));
      },
    });

    await waitFor('[data-test-save-idle]');

    assert
      .dom('[data-test-code-mode-card-preview-body] [data-test-field="name"]')
      .containsText('MangoXXX');
  });

  test<
    TestContextWithSave & TestContextWithSSE
  >('card instance change made in card editor is auto-saved', async function (assert) {
    assert.expect(3);

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Pet/mango`],
        },
      },
    ];
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
      assert.strictEqual(
        stringify(json),
        stringify(expected),
        'saved card is correct',
      );
    });

    await click('[data-test-preview-card-footer-button-edit]');
    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        await fillIn('[data-test-field="name"] input', 'MangoXXX');
      },
    });
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

    await click('[data-test-preview-card-footer-button-edit]');
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

  test<
    TestContextWithSave & TestContextWithSSE
  >('card definition change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(2);

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
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [
            `${testRealmURL}pet.gts`,
            `${testRealmURL}Pet/mango`,
            `${testRealmURL}Pet/vangogh`,
            `${testRealmURL}Person/fadhlan`,
            `${testRealmURL}Person/john-with-bad-pet-link`,
            `${testRealmURL}person`,
          ],
        },
      },
    ];
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

    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        setMonacoContent(expected);
        await waitFor('[data-test-save-idle]');
      },
    });

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
      realmPermissions = { [testRealmURL]: ['read'] };
    });

    test('the editor is read-only', async function (assert) {
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

      assert.true(
        monacoService?.editor?.getOption(
          MonacoSDK.editor.EditorOption.readOnly,
        ),
        'editor should be read-only',
      );
    });
  });
});
