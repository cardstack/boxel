import { module, test } from 'qunit';
import { waitFor, fillIn, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import Module from '@cardstack/host/components/module';
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
import { Realm } from '@cardstack/runtime-common/realm';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import CardPrerender from '@cardstack/host/components/card-prerender';
import type LoaderService from '@cardstack/host/services/loader-service';
import { shimExternals } from '@cardstack/host/lib/externals';

module('Integration | schema', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  hooks.beforeEach(async function () {
    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    shimExternals();
    adapter = new TestRealmAdapter({});
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;
  });

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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
        'Delete firstName - contains - field card ID: https://cardstack.com/base/string/default'
      );
  });

  test('renders card schema view with a "/" in template', async function (assert) {
    await realm.write(
      'test.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import IntegerCard from "https://cardstack.com/base/integer";

      export class Test extends Card {
        @field test = contains(IntegerCard, {
          computeVia: function () {
            return 10 / 2;
          },
        });
      }
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}test`,
      name: 'Test',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}friend`,
      name: 'Friend',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
        'Delete firstName - contains - field card ID: https://cardstack.com/base/string/default'
      );
    assert.dom('[data-test-field="friend"]').exists();
    assert
      .dom('[data-test-field="friend"]')
      .hasText(
        `Delete friend - linksTo - field card ID: ${testRealmURL}friend/Friend (this card)`
      );
  });

  test('renders link to field card', async function (assert) {
    await realm.write(
      'person.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `
    );
    await realm.write(
      'post.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class Post extends Card {
        @field title = contains(StringCard);
        @field author = contains(Person);
      }
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}post`,
      name: 'Post',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    assert
      .dom('[data-test-field="author"] a[href="/code?path=person"]')
      .exists('link to person card exists');
    assert
      .dom(
        '[data-test-field="title"] a[href="http://localhost:4201/base/string?schema"]'
      )
      .exists('link to string card exists');
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
    `
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
    `
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
    `
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}fancy-person`,
      name: 'FancyPerson',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
    `
    );
    await realm.write(
      'post.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Post extends Card {
        @field title = contains(StringCard);
      }
    `
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
      })
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
      })
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}post`,
      name: 'Post',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'author');
    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog] [data-test-realm-name]');

    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"]`
      )
      .exists('local realm composite card displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/boolean-field`
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/card-field`
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/card-ref-field`
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/date-field`
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/datetime-field`
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/integer-field`
      )
      .exists('base realm primitive field displayed');
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${baseRealm.url}fields/string-field`
      )
      .exists('base realm primitive field displayed');

    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}person-entry"] [data-test-realm-name]`
      )
      .exists();

    // a "contains" field cannot be the same card as it's enclosing card
    assert
      .dom(
        `[data-test-card-catalog] [data-test-card-catalog-item="${testRealmURL}post-entry"]`
      )
      .doesNotExist('own card is not available to choose as a field');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('.schema [data-test-field="author"]');
    assert.dom('[data-test-field="author"]').exists();
    assert
      .dom('[data-test-field="author"]')
      .hasText(
        `Delete author - contains - field card ID: ${testRealmURL}person/Person`
      );

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
    `
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'aliases');
    await click('[data-test-new-field-containsMany]');
    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');

    await click(`[data-test-select="${baseRealm.url}fields/string-field"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="aliases"]');
    assert.dom('[data-test-field="aliases"]').exists();
    assert
      .dom('[data-test-field="aliases"]')
      .hasText(
        `Delete aliases - containsMany - field card ID: ${baseRealm.url}string/default`
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
    `
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
    `
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
    `
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
    `
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
      })
    );

    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}pet`,
      name: 'Pet',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'appointment');
    await click('[data-test-new-field-contains]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert.dom(`[data-test-select="${testRealmURL}appointment"]`).exists();

    await click(`[data-test-select="${testRealmURL}appointment"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="appointment"]');
    assert
      .dom('[data-test-field="appointment"]')
      .hasText(
        `Delete appointment - contains - field card ID: ${testRealmURL}appointment/Appointment`
      );

    await waitFor('[data-test-catalog-entry-publish]');
    await click(`[data-test-catalog-entry-publish]`);

    await waitFor('[data-test-save-card]');
    await click(`[data-test-save-card]`);
    await waitFor(`[data-test-catalog-entry-editor] [data-test-realm-name]`);
    assert
      .dom(`[data-test-catalog-entry-editor] [data-test-realm-name]`)
      .containsText(`in Unnamed Workspace`);

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
    `
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
    `
    );
    await realm.write(
      'pet.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field name = contains(StringCard);
      }
    `
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
      })
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'pet');
    await click('[data-test-new-field-linksTo]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
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
    `
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
    `
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
      })
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'friend');
    await click('[data-test-new-field-linksTo]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    await click(`[data-test-select="${testRealmURL}person"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-field="friend"]');
    assert
      .dom('[data-test-field="friend"]')
      .hasText(
        `Delete friend - linksTo - field card ID: ${testRealmURL}person/Person (this card)`
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
    `
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
    `
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
    `
    );

    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}employee`,
      name: 'Employee',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
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
        'The field name "department" already exists, please choose a different name.'
      );
    await fillIn('[data-test-new-field-name]', 'firstName');
    assert.dom('[data-test-error-msg').exists();
    assert
      .dom('[data-test-error-msg')
      .hasText(
        'The field name "firstName" already exists, please choose a different name.'
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
    `
    );
    await realm.write(
      'pet.gts',
      `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field name = contains(StringCard);
      }
    `
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
      })
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'pets');
    await click('[data-test-new-field-linksToMany]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
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
        `Delete pets - linksToMany - field card ID: ${testRealmURL}pet/Pet`
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
    `
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
    `
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
      })
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardCatalogModal />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-card-id]');
    await fillIn('[data-test-new-field-name]', 'friends');
    await click('[data-test-new-field-linksToMany]');

    await click('[data-test-add-field]');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
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
        `Delete friends - linksToMany - field card ID: ${testRealmURL}person/Person (this card)`
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
    `
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
    `
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
    `
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
    `
    );
    let openFile = await getFileResource(this, adapter, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Module @file={{openFile}} />
          <CardPrerender />
        </template>
      }
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
    `
    );
  });
});
