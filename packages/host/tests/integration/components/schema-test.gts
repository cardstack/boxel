import { module, test } from 'qunit';
import { waitFor, fillIn, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import Module from '@cardstack/host/components/editor/module';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';
import {
  getFileResource,
  TestRealm,
  TestRealmAdapter,
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
} from '../../helpers';
import { isReady } from '@cardstack/host/resources/file';
import { Realm } from '@cardstack/runtime-common/realm';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import CardPrerender from '@cardstack/host/components/card-prerender';
import CodeController from '@cardstack/host/controllers/code';
import { OpenFiles } from '@cardstack/host/controllers/code';
import type LoaderService from '@cardstack/host/services/loader-service';
import { TestContext } from '@ember/test-helpers';

module('Integration | schema', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;
  let mockOpenFiles: OpenFiles;
  let loader: Loader;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(function (this: TestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
  });
  hooks.beforeEach(async function () {
    mockOpenFiles = new OpenFiles(new CodeController());
    adapter = new TestRealmAdapter({});
    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
    await realm.ready;
  });
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('renders card schema view', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        static displayName = 'Person';
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
            <CardPrerender />
          {{/if}}
          <CardCatalogModal />
        </template>

        openFile = f;
      },
    );
    await waitFor('[data-test-card-id]');
    assert.dom('[data-test-card-id]').exists();
    assert
      .dom('[data-test-card-id]')
      .hasText(`Card ID: ${testRealmURL}person/Person`);
    assert.dom('[data-test-display-name]').hasText(`Display Name: Person`);
    assert.dom('[data-test-adopts-from').exists();
    assert
      .dom('[data-test-adopts-from')
      .hasText('Adopts From: https://cardstack.com/base/card-api/Card');
    assert.dom('[data-test-field="firstName"]').exists();
    assert
      .dom('[data-test-field="firstName"]')
      .hasText(
        'Delete firstName - contains - field card ID: https://cardstack.com/base/string/default',
      );
  });
  test('renders card schema view with a "/" in template', async function (assert) {
    await realm.write(
      'test.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import NumberCard from "https://cardstack.com/base/number";

      export class Test extends Card {
        @field test = contains(NumberCard, {
          computeVia: function () {
            return 10 / 2;
          },
        });
      }
    `,
    );

    mockOpenFiles.path = 'test.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
            <CardPrerender />
            <CardCatalogModal />
          {{/if}}
        </template>
        openFile = f;
      },
    );
    await waitFor('[data-test-card-id]');
    assert.dom('[data-test-card-id]').exists();
  });

  test('renders a card schema view for a card that contains itself as a field', async function (assert) {
    await realm.write(
      'friend.gts',
      `
      import { contains, linksTo, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Friend extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Friend);
      }
    `,
    );

    mockOpenFiles.path = 'friend.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');

    assert.dom('[data-test-card-id]').exists();
    assert
      .dom('[data-test-card-id]')
      .hasText(`Card ID: ${testRealmURL}friend/Friend`);
    assert.dom('[data-test-adopts-from').exists();
    assert
      .dom('[data-test-adopts-from')
      .hasText('Adopts From: https://cardstack.com/base/card-api/Card');
    assert.dom('[data-test-field="firstName"]').exists();
    assert
      .dom('[data-test-field="firstName"]')
      .hasText(
        'Delete firstName - contains - field card ID: https://cardstack.com/base/string/default',
      );
    assert.dom('[data-test-field="friend"]').exists();
    assert
      .dom('[data-test-field="friend"]')
      .hasText(
        `Delete friend - linksTo - field card ID: ${testRealmURL}friend/Friend (this card)`,
      );
  });

  test('can delete a field from card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );
    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady f)}}
            <Module @file={{f}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
      },
    );

    await waitFor('[data-test-card-id]');
    await click('[data-test-field="firstName"] button[data-test-delete]');
    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field lastName = contains(StringCard);
      }
    `,
    );
  });

  test('can delete a linksTo field with the same type as its enclosing card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card, linksTo } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field name = contains(StringCard);
        @field friend = linksTo(() => Person);
      }
    `,
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await click('[data-test-field="friend"] button[data-test-delete]');
    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field name = contains(StringCard);
      }
    `,
    );
  });

  test('does not include a delete button for fields that are inherited', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'fancy-person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class FancyPerson extends Person {
        @field favoriteColor = contains(StringCard);
      }
    `,
    );

    mockOpenFiles.path = 'fancy-person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    assert
      .dom('[data-test-field="firstName"]')
      .exists('firstName field exists');
    assert
      .dom('[data-test-field="firstName"] button[data-test-delete]')
      .doesNotExist('delete button does not exist');
    assert
      .dom('[data-test-field="favoriteColor"] button[data-test-delete]')
      .exists('delete button exists');
  });

  test('it can add a new contains field to a card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'post.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Post extends Card {
        @field title = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'person-entry.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      }),
    );
    await realm.write(
      'post-entry.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Post',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      }),
    );

    mockOpenFiles.path = 'post.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
            <CardCatalogModal />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'author');
    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog] [data-test-realm]');
    await waitFor('[data-test-card-catalog] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');

    assert
      .dom('[data-test-card-catalog] [data-test-realm]')
      .exists({ count: 2 });
    assert
      .dom(
        '[data-test-card-catalog] [data-test-realm="Base Workspace"] [data-test-results-count]',
      )
      .hasText('12 results');
    assert
      .dom(
        '[data-test-card-catalog] [data-test-realm="Base Workspace"] [data-test-card-catalog-item]',
      )
      .exists({ count: 5 }, 'first 5 base realm cards are displayed');

    await click(
      '[data-test-realm="Base Workspace"] [data-test-show-more-cards]',
    );
    assert
      .dom(
        '[data-test-card-catalog] [data-test-realm="Base Workspace"] [data-test-card-catalog-item]',
      )
      .exists({ count: 10 }, '5 more base realm cards are displayed');

    await click(
      '[data-test-realm="Base Workspace"] [data-test-show-more-cards]',
    );
    assert
      .dom(
        '[data-test-card-catalog] [data-test-realm="Base Workspace"] [data-test-card-catalog-item]',
      )
      .exists({ count: 12 }, 'all base realm cards are displayed');

    assert
      .dom(
        '[data-test-card-catalog] [data-test-realm="Unnamed Workspace"] [data-test-results-count]',
      )
      .hasText('1 result');
    assert
      .dom(
        '[data-test-card-catalog] [data-test-realm="Unnamed Workspace"] [data-test-card-catalog-item]',
      )
      .exists({ count: 1 });
    assert
      .dom('[data-test-realm="Unnamed Workspace"] [data-test-show-more-cards]')
      .doesNotExist();

    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"]`,
      )
      .exists('local realm composite card displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/boolean-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/card-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/card-ref-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/date-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/datetime-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/number-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/string-field`,
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"]`,
      )
      .exists();

    // a "contains" field cannot be the same card as it's enclosing card
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}post-entry"]`,
      )
      .doesNotExist('own card is not available to choose as a field');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="author"]');
    assert.dom('[data-test-field="author"]').exists();
    assert
      .dom('[data-test-field="author"]')
      .hasText(
        `Delete author - contains - field card ID: ${testRealmURL}person/Person`,
      );

    mockOpenFiles.path = 'post.gts';
    let fileRef = await adapter.openFile('post.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { Person as PersonCard } from "${testRealmURL}person";
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Post extends Card {
        @field title = contains(StringCard);
        @field author = contains(() => PersonCard);
      }
    `,
    );
  });

  test('it can add containsMany field to a card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'aliases');
    await click('[data-test-new-field-containsMany]');
    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    await click(
      '[data-test-realm="Base Workspace"] [data-test-show-more-cards]',
    );
    await click(`[data-test-select="${baseRealm.url}fields/string-field"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="aliases"]');
    assert.dom('[data-test-field="aliases"]').exists();
    assert
      .dom('[data-test-field="aliases"]')
      .hasText(
        `Delete aliases - containsMany - field card ID: ${baseRealm.url}string/default`,
      );

    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card, containsMany } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field aliases = containsMany(StringCard);
      }
    `,
    );
  });

  test('it can add a field with a card whose fields have a cyclic dependency with the enclosing card', async function (assert) {
    await realm.write(
      'pet.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field firstName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'person.gts',
      `
      import { contains, linksTo, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Pet } from "./pet";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field pet = linksTo(() => Pet);
      }
    `,
    );
    await realm.write(
      'appointment.gts',
      `
      import { contains, containsMany, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class Appointment extends Card {
        @field title = contains(StringCard);
        @field contacts = containsMany(Person);
      }
    `,
    );

    await realm.write(
      'appointment.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Appointment',
            ref: {
              module: `${testRealmURL}appointment`,
              name: 'Appointment',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
            fields: {
              demo: {
                adoptsFrom: {
                  module: `${testRealmURL}appointment`,
                  name: 'Appointment',
                },
              },
            },
          },
        },
      }),
    );

    mockOpenFiles.path = 'pet.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'appointment');
    await click('[data-test-new-field-contains]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    assert.dom(`[data-test-select="${testRealmURL}appointment"]`).exists();

    await click(`[data-test-select="${testRealmURL}appointment"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="appointment"]');
    assert
      .dom('[data-test-field="appointment"]')
      .hasText(
        `Delete appointment - contains - field card ID: ${testRealmURL}appointment/Appointment`,
      );

    await waitFor('[data-test-catalog-entry-publish]');
    await click(`[data-test-catalog-entry-publish]`);

    await waitFor('[data-test-save-card]');
    await click(`[data-test-save-card]`);

    let fileRef = await adapter.openFile('pet.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { Appointment as AppointmentCard } from "${testRealmURL}appointment";
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field firstName = contains(StringCard);
        @field appointment = contains(() => AppointmentCard);
      }
    `,
    );
  });

  test('it can add linksTo field to a card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'pet.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field name = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'pet.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Pet',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
            demo: {
              name: 'Jackie',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
            fields: {
              demo: {
                adoptsFrom: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
        },
      }),
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'pet');
    await click('[data-test-new-field-linksTo]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    assert.dom(`[data-test-select="${testRealmURL}pet"]`).exists();
    assert
      .dom('[data-test-select]')
      .exists({ count: 2 }, 'primitive fields are not shown');

    await click(`[data-test-select="${testRealmURL}pet"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="pet"]');
    assert
      .dom('[data-test-field="pet"]')
      .hasText(`Delete pet - linksTo - field card ID: ${testRealmURL}pet/Pet`);

    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { Pet as PetCard } from "${testRealmURL}pet";
      import { contains, field, Card, linksTo } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field pet = linksTo(() => PetCard);
      }
    `,
    );
  });

  test('it can add a linksTo field with the same type as its enclosing card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'person.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
            demo: {
              firstName: 'Mr.',
              lastName: 'Peanutbutter',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
            fields: {
              demo: {
                adoptsFrom: {
                  module: `${testRealmURL}person`,
                  name: 'Person',
                },
              },
            },
          },
        },
      }),
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'friend');
    await click('[data-test-new-field-linksTo]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    await click(`[data-test-select="${testRealmURL}person"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="friend"]');
    assert
      .dom('[data-test-field="friend"]')
      .hasText(
        `Delete friend - linksTo - field card ID: ${testRealmURL}person/Person (this card)`,
      );

    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card, linksTo } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field friend = linksTo(() => Person);
      }
    `,
    );
  });

  test('it does not allow duplicate field to be created', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'employee.gts',
      `
      import { contains, field } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class Employee extends Person {
        @field department = contains(StringCard);
      }
    `,
    );

    mockOpenFiles.path = 'employee.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    assert
      .dom('data-test-error-msg')
      .doesNotExist('error message does not exist');

    await fillIn('[data-test-new-field-name]', 'department');
    assert.dom('[data-test-error-msg').exists();
    assert
      .dom('[data-test-error-msg')
      .hasText(
        'The field name "department" already exists, please choose a different name.',
      );
    await fillIn('[data-test-new-field-name]', 'firstName');
    assert.dom('[data-test-error-msg').exists();
    assert
      .dom('[data-test-error-msg')
      .hasText(
        'The field name "firstName" already exists, please choose a different name.',
      );
    await fillIn('[data-test-new-field-name]', 'newFieldName');
    assert
      .dom('data-test-error-msg')
      .doesNotExist('error message does not exist');
  });

  test('it can add a linksToMany field to a card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'pet.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field name = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'pet.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Pet',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
            demo: {
              name: 'Jackie',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
            fields: {
              demo: {
                adoptsFrom: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
        },
      }),
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'pets');
    await click('[data-test-new-field-linksToMany]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    assert.dom(`[data-test-select="${testRealmURL}pet"]`).exists();
    assert
      .dom('[data-test-select]')
      .exists({ count: 2 }, 'primitive fields are not shown');

    await click(`[data-test-select="${testRealmURL}pet"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="pets"]');
    assert
      .dom('[data-test-field="pets"]')
      .hasText(
        `Delete pets - linksToMany - field card ID: ${testRealmURL}pet/Pet`,
      );

    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { Pet as PetCard } from "${testRealmURL}pet";
      import { contains, field, Card, linksToMany } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(() => PetCard);
      }
    `,
    );
  });

  test('it can add a linksToMany field with the same type as its enclosing card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'person.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
            demo: {
              firstName: 'Jackie',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
            fields: {
              demo: {
                adoptsFrom: {
                  module: `${testRealmURL}person`,
                  name: 'Person',
                },
              },
            },
          },
        },
      }),
    );
    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'friends');
    await click('[data-test-new-field-linksToMany]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    assert.dom(`[data-test-select="${testRealmURL}person"]`).exists();
    assert
      .dom('[data-test-select]')
      .exists({ count: 2 }, 'primitive fields are not shown');

    await click(`[data-test-select="${testRealmURL}person"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="friends"]');
    assert
      .dom('[data-test-field="friends"]')
      .hasText(
        `Delete friends - linksToMany - field card ID: ${testRealmURL}person/Person (this card)`,
      );

    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card, linksToMany } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field friends = linksToMany(() => Person);
      }
    `,
    );
  });

  test('can delete a linksToMany field with the same type as its enclosing card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card, linksToMany } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field friends = linksToMany(() => Person);
      }
    `,
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await click('[data-test-field="friends"] button[data-test-delete]');
    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
      }
    `,
    );
  });

  test('can delete a linksToMany field', async function (assert) {
    await realm.write(
      'pet.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field name = contains(StringCard);
      }
    `,
    );
    await realm.write(
      'person.gts',
      `
      import { Pet as PetCard } from "${testRealmURL}pet";
      import { contains, field, Card, linksToMany } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(PetCard);
      }
    `,
    );

    mockOpenFiles.path = 'person.gts';
    let f = await getFileResource(this, testRealmURL, mockOpenFiles);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if (isReady this.openFile)}}
            <Module @file={{this.openFile}} />
          {{/if}}
          <CardPrerender />
          <CardCatalogModal />
        </template>
        openFile = f;
      },
    );

    await waitFor('[data-test-card-id]');
    await click('[data-test-field="pets"] button[data-test-delete]');
    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(
      src,
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
      }
    `,
    );
  });
});
