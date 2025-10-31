import { click, waitFor, fillIn, find, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import {
  type LooseSingleCardDocument,
  Deferred,
  baseRealm,
  type SingleCardDocument,
} from '@cardstack/runtime-common';

import type MonacoService from '@cardstack/host/services/monaco-service';

import { RecentFiles } from '@cardstack/host/utils/local-storage-keys';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  getMonacoContent,
  setMonacoContent,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  withSlowSave,
  type TestContextWithSave,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

import type { TestRealmAdapter } from '../../helpers/adapter';

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

    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    monacoService = getService('monaco-service');

    window.localStorage.setItem(
      RecentFiles,
      JSON.stringify([[testRealmURL, 'Pet/mango.json']]),
    );

    ({ adapter } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'pet.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class Pet extends CardDef {
          static displayName = 'Pet';
          @field name = contains(StringField);
          @field title = contains(StringField, {
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
        import StringField from "https://cardstack.com/base/string";
        export class ShippingInfo extends FieldDef {
          static displayName = 'Shipping Info';
          @field preferredCarrier = contains(StringField);
          @field remarks = contains(StringField);
          @field title = contains(StringField, {
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
        import StringField from "https://cardstack.com/base/string";
        import { ShippingInfo } from "./shipping-info";
        import { FieldContainer } from '@cardstack/boxel-ui/components';

        export class Address extends FieldDef {
          static displayName = 'Address';
          @field city = contains(StringField);
          @field country = contains(StringField);
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
        import StringField from "https://cardstack.com/base/string";
        import { Pet } from "./pet";
        import { Address } from "./address";

        export class Person extends CardDef {
          static displayName = 'Person';
          @field firstName = contains(StringField);
          @field pet = linksTo(Pet);
          @field friends = linksToMany(Pet);
          @field firstLetterOfTheName = contains(StringField, {
            computeVia: function (this: Chain) {
              return this.firstName[0];
            },
          });
          @field title = contains(StringField, {
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
        'theme-starry-night.json': {
          data: {
            meta: {
              adoptsFrom: {
                name: 'Theme',
                module: 'https://cardstack.com/base/card-api',
              },
            },
            attributes: {
              cardInfo: { title: 'Theme Starry Night' },
              cssVariables:
                ':root {\n  --background: #f5f7fa;\n  --foreground: #1a2238;\n  --card: #e3eaf2;\n  --card-foreground: #1a2238;\n  --popover: #fffbe6;\n  --popover-foreground: #1a2238;\n  --primary: #3a5ba0;\n  --primary-foreground: #fffbe6;\n  --secondary: #f7c873;\n  --secondary-foreground: #1a2238;\n  --muted: #e5e5df;\n  --muted-foreground: #3a5ba0;\n  --accent: #6ea3c1;\n  --accent-foreground: #fffbe6;\n  --destructive: #2d1e2f;\n  --destructive-foreground: #fffbe6;\n  --border: #b0b8c1;\n  --input: #6ea3c1;\n  --ring: #f7c873;\n  --chart-1: #3a5ba0;\n  --chart-2: #f7c873;\n  --chart-3: #6ea3c1;\n  --chart-4: #b0b8c1;\n  --chart-5: #2d1e2f;\n  --sidebar: #e3eaf2;\n  --sidebar-foreground: #1a2238;\n  --sidebar-primary: #3a5ba0;\n  --sidebar-primary-foreground: #fffbe6;\n  --sidebar-accent: #f7c873;\n  --sidebar-accent-foreground: #1a2238;\n  --sidebar-border: #b0b8c1;\n  --sidebar-ring: #f7c873;\n  --font-sans: Libre Baskerville, serif;\n  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;\n  --radius: 0.5rem;\n  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\n  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\n  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\n  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\n  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);\n  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);\n  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);\n  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);\n  --tracking-normal: 0em;\n  --spacing: 0.25rem;\n}\n\n.dark {\n  --background: #181a24;\n  --foreground: #e6eaf3;\n  --card: #23243a;\n  --card-foreground: #e6eaf3;\n  --popover: #23243a;\n  --popover-foreground: #ffe066;\n  --primary: #3a5ba0;\n  --primary-foreground: #ffe066;\n  --secondary: #ffe066;\n  --secondary-foreground: #23243a;\n  --muted: #23243a;\n  --muted-foreground: #7a88a1;\n  --accent: #bccdf0;\n  --accent-foreground: #181a24;\n  --destructive: #a04a6c;\n  --destructive-foreground: #ffe066;\n  --border: #2d2e3e;\n  --input: #3a5ba0;\n  --ring: #ffe066;\n  --chart-1: #3a5ba0;\n  --chart-2: #ffe066;\n  --chart-3: #6ea3c1;\n  --chart-4: #7a88a1;\n  --chart-5: #a04a6c;\n  --sidebar: #23243a;\n  --sidebar-foreground: #e6eaf3;\n  --sidebar-primary: #3a5ba0;\n  --sidebar-primary-foreground: #ffe066;\n  --sidebar-accent: #ffe066;\n  --sidebar-accent-foreground: #23243a;\n  --sidebar-border: #2d2e3e;\n  --sidebar-ring: #ffe066;\n  --font-sans: Libre Baskerville, serif;\n  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;\n  --radius: 0.5rem;\n  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\n  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\n  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\n  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\n  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);\n  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);\n  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);\n  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);\n}',
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

    assert
      .dom('[data-test-code-mode-card-renderer-body] [data-test-field="name"]')
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
      .dom('[data-test-code-mode-card-renderer-body] [data-test-field="name"]')
      .containsText('MangoXXX');
  });

  test('card instance changes made in monaco editor are synchronized with store', async function (assert) {
    assert.expect(2);
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

    assert
      .dom('[data-test-code-mode-card-renderer-body] [data-test-field="name"]')
      .containsText('Mango');

    // use a slow save so that we can be sure the synchronization we are seeing
    // is not a result of indexing activity
    await withSlowSave(1000, async () => {
      setMonacoContent(JSON.stringify(expected));
      await settled();
      assert
        .dom(
          '[data-test-code-mode-card-renderer-body] [data-test-field="name"]',
        )
        .containsText('MangoXXX');
    });
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
          cardInfo: {
            title: null,
            description: null,
            thumbnailURL: null,
            notes: null,
          },
        },
        relationships: {
          'cardInfo.theme': {
            links: {
              self: null,
            },
          },
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

    await click('[data-test-format-chooser="edit"]');
    await fillIn('[data-test-field="name"] input', 'MangoXXX');
    await waitFor('[data-test-save-idle]');
  });

  test<TestContextWithSave>('non-card instance change made in monaco editor is auto-saved', async function (assert) {
    assert.expect(2);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    });

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
    let environment = getService('environment-service');
    environment.autoSaveDelayMs = 1000; // slowdown the auto save so it doesn't interfere with this test
    assert.expect(2);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}README.txt`,
    });
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
    let environment = getService('environment-service');
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

    await click('[data-test-format-chooser="edit"]');
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
    import StringField from "https://cardstack.com/base/string";

    export class Pet extends CardDef {
      static displayName = 'PetXXX';  // this is the change
      @field name = contains(StringField);
      @field title = contains(StringField, {
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

  test<TestContextWithSave>('can select and remove linked theme in default card-info editor', async function (assert) {
    assert.expect(10);

    const themeId = `${testRealmURL}theme-starry-night`;
    const onSave = (
      url: URL,
      json: string | SingleCardDocument,
      currentThemeId: string | null,
    ) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(url.href, `${testRealmURL}Pet/mango`);
      assert.strictEqual(
        json.data.relationships?.['cardInfo.theme']?.links?.self,
        currentThemeId,
      );
    };

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    });

    this.onSave((url: URL, json: string | SingleCardDocument) =>
      onSave(url, json, themeId),
    );

    await click('[data-test-edit-button]');
    await click('[data-test-toggle-thumbnail-editor]');
    await click('[data-test-add-new="theme"]');

    assert.dom('[data-test-card-catalog]').exists();
    await click(`[data-test-card-catalog-item="${themeId}"]`);
    await click('[data-test-card-catalog-go-button]');

    assert
      .dom(`[data-test-field="cardInfo-theme"] [data-test-card="${themeId}"]`)
      .exists({ count: 1 });
    await click(
      '[data-test-field="cardInfo-theme"] [data-test-boxel-field-label]',
    );
    await click(`[data-test-card="${themeId}"]`);
    assert
      .dom(`[data-test-card="${themeId}"]`)
      .exists({ count: 1 }, 'items are non-interactive');

    this.unregisterOnSave();
    this.onSave((url: URL, json: string | SingleCardDocument) =>
      onSave(url, json, null),
    );

    await click(`[data-test-field="cardInfo-theme"] [data-test-remove-card]`);

    assert.dom('[data-test-card-catalog]').doesNotExist();
    assert
      .dom(`[data-test-field="cardInfo-theme"] [data-test-card="${themeId}"]`)
      .doesNotExist();
    assert.dom('[data-test-add-new="theme"]').exists();
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
        'rgb(96, 96, 96)', // equivalent to #606060
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
