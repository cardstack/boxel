import { waitUntil, waitFor, fillIn, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm, CodeRef } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import CardPrerender from '@cardstack/host/components/card-prerender';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import CatalogEntryEditor from '@cardstack/host/components/editor/catalog-entry-editor';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  TestRealm,
  TestRealmAdapter,
  testRealmURL,
  setupLocalIndexing,
} from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

let loader: Loader;

module('Integration | catalog-entry-editor', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(async function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    adapter = new TestRealmAdapter({
      'person.gts': `
        import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        export class Person extends FieldDef {
          @field firstName = contains(StringCard);
          @field title =  contains(StringCard, {
            computeVia: function (this: Person) {
              return this.firstName;
            },
          });
          @field description = contains(StringCard, { computeVia: () => 'Person' });
          @field thumbnailURL = contains(StringCard, { computeVia: () => './person.svg' });
          static embedded = class Embedded extends Component<typeof this> {
            <template><@fields.firstName/></template>
          }
        }
      `,
      'pet.gts': `
        import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import BooleanCard from "https://cardstack.com/base/boolean";
        import DateCard from "https://cardstack.com/base/date";
        import { Person } from "./person";
        export class Pet extends CardDef {
          @field name = contains(StringCard);
          @field lovesWalks = contains(BooleanCard);
          @field birthday = contains(DateCard);
          @field owner = contains(Person);
          @field title =  contains(StringCard, {
            computeVia: function (this: Pet) {
              return this.name;
            },
          });
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h2 data-test-pet-name><@fields.name/></h2>
              <div data-test-pet-owner><@fields.owner/></div>
              <div data-test-pet-owner><@fields.birthday/></div>
            </template>
          }
        }
      `,
    });
    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
    await realm.ready;
  });

  test('can publish new catalog entry', async function (assert) {
    const args: CodeRef = { module: `${testRealmURL}pet`, name: 'Pet' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('button[data-test-catalog-entry-publish]', { timeout: 5000 });
    await click('[data-test-catalog-entry-publish]');
    // for some reason this takes long enough in CI that it seems
    // to trigger a timeout error using the default timeout
    await waitFor('[data-test-ref]', { timeout: 5000 });
    await waitFor('[data-test-field="realmName"]', { timeout: 5000 });

    assert
      .dom('[data-test-catalog-entry-editor]')
      .exists('catalog entry editor exists');
    assert
      .dom('[data-test-field="title"] input')
      .hasValue(
        `Pet from ${testRealmURL}pet`,
        'title input field value is correct',
      );
    assert
      .dom('[data-test-field="description"] input')
      .hasValue(
        `Catalog entry for Pet from ${testRealmURL}pet`,
        'description input field value is correct',
      );
    assert
      .dom('[data-test-ref]')
      .containsText(`Module: ${testRealmURL}pet Name: Pet`);
    assert
      .dom('[data-test-field="realmName"]')
      .containsText(`Unnamed Workspace`);
    assert
      .dom('[data-test-field="demo"] [data-test-field="name"] input')
      .hasValue('', 'demo card name input field is correct');
    assert
      .dom(
        '[data-test-field="demo"] [data-test-field="lovesWalks"] label:nth-of-type(2) input',
      )
      .isChecked('demo card lovesWalks input field is correct');

    await fillIn('[data-test-field="title"] input', 'Pet test');
    await fillIn('[data-test-field="description"] input', 'Test description');
    await fillIn(
      '[data-test-field="demo"] [data-test-field="description"] input',
      'Beagle',
    );
    await fillIn(
      '[data-test-field="demo"] [data-test-field="thumbnailURL"] input',
      './jackie.png',
    );
    await fillIn('[data-test-field="name"] input', 'Jackie');
    await click('[data-test-field="lovesWalks"] label:nth-of-type(1) input');
    await fillIn('[data-test-field="firstName"] input', 'BN');
    await click('button[data-test-save-card]');

    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    let entry = await realm.searchIndex.card(
      new URL(`${testRealmURL}CatalogEntry/1`),
    );
    assert.ok(entry, 'the new catalog entry was created');

    let fileRef = await adapter.openFile('CatalogEntry/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            title: 'Pet test',
            description: 'Test description',
            ref: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
            demo: {
              name: 'Jackie',
              lovesWalks: true,
              birthday: null,
              owner: {
                firstName: 'BN',
              },
              description: 'Beagle',
              thumbnailURL: './jackie.png',
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/catalog-entry',
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
      },
      'file contents are correct',
    );
  });

  test('can edit existing catalog entry', async function (assert) {
    await realm.write(
      'pet-catalog-entry.json',
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
              lovesWalks: true,
              birthday: null,
              owner: {
                firstName: 'BN',
              },
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

    const args: CodeRef = { module: `${testRealmURL}pet`, name: 'Pet' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-format-button="edit"]');
    await click('[data-test-format-button="edit"]');

    assert
      .dom('[data-test-catalog-entry-id]')
      .hasText(`${testRealmURL}pet-catalog-entry`);
    assert
      .dom('[data-test-field="title"] input')
      .hasValue('Pet', 'title input field value is correct');
    assert
      .dom('[data-test-field="description"] input')
      .hasValue('Catalog entry', 'description input field value is correct');
    assert
      .dom('[data-test-ref]')
      .containsText(`Module: ${testRealmURL}pet Name: Pet`);
    assert
      .dom('[data-test-field="realmName"]')
      .containsText(`Unnamed Workspace`);
    assert
      .dom('[data-test-field="demo"] [data-test-field="name"] input')
      .hasValue('Jackie', 'demo card name input field is correct');
    assert
      .dom('[data-test-field="lovesWalks"] label:nth-of-type(1) input')
      .isChecked('title input field value is correct');
    assert
      .dom('[data-test-field="owner"] [data-test-field="firstName"] input')
      .hasValue(
        'BN',
        'demo card owner first name input field value is correct',
      );

    await fillIn('[data-test-field="title"] input', 'test title');
    await fillIn('[data-test-field="description"] input', 'test description');
    await fillIn('[data-test-field="name"] input', 'Jackie Wackie');
    await fillIn('[data-test-field="firstName"] input', 'EA');

    await click('button[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.dom('[data-test-title]').hasText('test title');
    assert.dom('[data-test-description]').hasText('test description');
    assert.dom('[data-test-realm-name]').hasText('in Unnamed Workspace');
    assert
      .dom('[data-test-demo] [data-test-pet-name]')
      .hasText('Jackie Wackie');
    assert.dom('[data-test-demo] [data-test-pet-owner]').exists();
    assert.dom('[data-test-demo] [data-test-pet-owner]').hasText('EA');

    let maybeError = await realm.searchIndex.card(
      new URL(`${testRealmURL}pet-catalog-entry`),
    );
    if (maybeError?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${maybeError.error.detail}`,
      );
    }
    let { doc } = maybeError!;
    assert.strictEqual(
      doc?.data.attributes?.title,
      'test title',
      'catalog entry title was updated',
    );
    assert.strictEqual(
      doc?.data.attributes?.description,
      'test description',
      'catalog entry description was updated',
    );
    assert.strictEqual(
      doc?.data.attributes?.demo?.name,
      'Jackie Wackie',
      'demo name field was updated',
    );
    assert.strictEqual(
      doc?.data.attributes?.demo?.owner?.firstName,
      'EA',
      'demo owner firstName field was updated',
    );
  });

  test('can edit existing catalog entry that uses relative references', async function (assert) {
    await realm.write(
      'dir/pet-catalog-entry.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Pet',
            description: 'Catalog entry',
            ref: {
              module: `../pet`,
              name: 'Pet',
            },
            demo: {
              name: 'Jackie',
              lovesWalks: true,
              birthday: null,
              owner: {
                firstName: 'BN',
              },
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
                  module: `../pet`,
                  name: 'Pet',
                },
              },
            },
          },
        },
      }),
    );

    const args: CodeRef = { module: `${testRealmURL}pet`, name: 'Pet' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-format-button="edit"]');
    await click('[data-test-format-button="edit"]');

    assert
      .dom('[data-test-catalog-entry-id]')
      .hasText(`${testRealmURL}dir/pet-catalog-entry`);
    assert
      .dom('[data-test-field="title"] input')
      .hasValue('Pet', 'title input field value is correct');
    assert
      .dom('[data-test-field="description"] input')
      .hasValue('Catalog entry', 'description input field value is correct');
    assert.dom('[data-test-ref]').containsText(`Module: ../pet Name: Pet`);
    assert
      .dom('[data-test-field="demo"] [data-test-field="name"] input')
      .hasValue('Jackie', 'demo card name input field is correct');
    assert
      .dom('[data-test-field="lovesWalks"] label:nth-of-type(1) input')
      .isChecked('title input field value is correct');
    assert
      .dom('[data-test-field="owner"] [data-test-field="firstName"] input')
      .hasValue(
        'BN',
        'demo card owner first name input field value is correct',
      );

    await fillIn('[data-test-field="title"] input', 'test title');
    await fillIn('[data-test-field="description"] input', 'test description');
    await fillIn('[data-test-field="name"] input', 'Jackie Wackie');
    await fillIn('[data-test-field="firstName"] input', 'EA');

    await click('button[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.dom('[data-test-title]').hasText('test title');
    assert.dom('[data-test-description]').hasText('test description');
    assert
      .dom('[data-test-demo] [data-test-pet-name]')
      .hasText('Jackie Wackie');
    assert.dom('[data-test-demo] [data-test-pet-owner]').exists();
    assert.dom('[data-test-demo] [data-test-pet-owner]').hasText('EA');

    let maybeError = await realm.searchIndex.card(
      new URL(`${testRealmURL}dir/pet-catalog-entry`),
    );
    if (maybeError?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${maybeError.error.detail}`,
      );
    }
    let { doc } = maybeError!;
    assert.strictEqual(
      doc?.data.attributes?.title,
      'test title',
      'catalog entry title was updated',
    );
    assert.strictEqual(
      doc?.data.attributes?.description,
      'test description',
      'catalog entry description was updated',
    );
    assert.strictEqual(
      doc?.data.attributes?.demo?.name,
      'Jackie Wackie',
      'demo name field was updated',
    );
    assert.strictEqual(
      doc?.data.attributes?.demo?.owner?.firstName,
      'EA',
      'demo owner firstName field was updated',
    );
  });

  test('can create new card with missing composite field value', async function (assert) {
    const args: CodeRef = { module: `${testRealmURL}pet`, name: 'Pet' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('button[data-test-catalog-entry-publish]');
    await click('[data-test-catalog-entry-publish]');
    await waitFor('[data-test-ref]');

    await fillIn('[data-test-field="name"] input', 'Jackie');
    await click('button[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    let entry = await realm.searchIndex.card(
      new URL(`${testRealmURL}CatalogEntry/1`),
    );
    assert.ok(entry, 'catalog entry was created');

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-format-button="edit"]');
    await click('[data-test-format-button="edit"]');
    assert.dom('[data-test-field="firstName"] input').exists();

    let fileRef = await adapter.openFile('CatalogEntry/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            title: `Pet from ${testRealmURL}pet`,
            description: `Catalog entry for Pet from ${testRealmURL}pet`,
            ref: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
            demo: {
              name: 'Jackie',
              lovesWalks: false,
              birthday: null,
              owner: {
                firstName: null,
              },
              description: null,
              thumbnailURL: null,
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/catalog-entry',
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
      },
      'file contents are correct',
    );
  });

  test('can create new catalog entry with all demo card field values missing', async function (assert) {
    const args: CodeRef = { module: `${testRealmURL}person`, name: 'Person' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('button[data-test-catalog-entry-publish]');
    await click('[data-test-catalog-entry-publish]');
    await waitFor('[data-test-ref]');

    await click('button[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-format-button="edit"]');
    await click('[data-test-format-button="edit"]');
    assert.dom('[data-test-field="firstName"] input').exists();

    let entry = await realm.searchIndex.card(
      new URL(`${testRealmURL}CatalogEntry/1`),
    );
    assert.ok(entry, 'catalog entry was created');

    let fileRef = await adapter.openFile('CatalogEntry/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            demo: {
              firstName: null,
            },
            title: `Person from ${testRealmURL}person`,
            description: `Catalog entry for Person from ${testRealmURL}person`,
            ref: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/catalog-entry',
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
      },
      'file contents are correct',
    );
  });

  test('it can render catalog entry for card with linksTo field', async function (assert) {
    await realm.write(
      'pet.gts',
      `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      export class Pet extends CardDef {
        @field name = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><h4 data-test-pet-name><@fields.name/></h4></template>
        };
      }
    `,
    );
    // note that person.gts already exists in beforeEach, so using a different module so we don't collide
    await realm.write(
      'nice-person.gts',
      `
      import { contains, field, linksTo, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Pet } from "./pet";
      export class NicePerson extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
        @field pet = linksTo(Pet);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h3 data-test-person-name><@fields.firstName/> <@fields.lastName/></h3>
            <div>Pet: <@fields.pet/></div>
          </template>
        };
      }
    `,
    );
    await realm.write(
      'jackie-pet.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            name: 'Jackie',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      }),
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
              module: `${testRealmURL}nice-person`,
              name: 'NicePerson',
            },
            demo: {
              firstName: 'Burcu',
              lastName: 'Noyan',
            },
          },
          relationships: {
            'demo.pet': {
              links: {
                self: `${testRealmURL}jackie-pet`,
              },
            },
          },
          meta: {
            fields: {
              demo: {
                adoptsFrom: {
                  module: `${testRealmURL}nice-person`,
                  name: 'NicePerson',
                },
              },
            },
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      }),
    );

    const args: CodeRef = {
      module: `${testRealmURL}nice-person`,
      name: 'NicePerson',
    };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('[data-test-ref]');
    assert
      .dom(`[data-test-ref]`)
      .hasText(`Module: ${testRealmURL}nice-person Name: NicePerson`);

    await waitFor('[data-test-person-name]');
    assert.dom('[data-test-person-name]').hasText('Burcu Noyan');

    await waitFor('[data-test-pet-name]');
    assert.dom('[data-test-pet-name]').exists();
    assert.dom('[data-test-pet-name]').hasText('Jackie');
  });

  test('can use card classes defined on the same module as fields', async function (assert) {
    await realm.write(
      'invoice.gts',
      `
      import { contains, containsMany, field, linksTo, CardDef, FieldDef, Component } from "https://cardstack.com/base/card-api";
      import NumberCard from "https://cardstack.com/base/number";
      import StringCard from "https://cardstack.com/base/string";
      class Vendor extends CardDef {
        @field company = contains(StringCard);
        @field title = contains(StringCard, {
          computeVia: function (this: Vendor) {
            return this.company;
          },
        });
        @field description = contains(StringCard, { computeVia: () => 'Vendor' });
        @field thumbnailURL = contains(StringCard, { computeVia: () => null });
        static embedded = class Embedded extends Component<typeof this> {
          <template><div data-test-company><@fields.company/></div></template>
        };
      }
      class Item extends FieldDef {
        @field name = contains(StringCard);
        @field price = contains(NumberCard);
        @field title =  contains(StringCard, {
          computeVia: function (this: Item) {
            return this.name + ' ' + this.price;
          },
        });
        @field description = contains(StringCard, { computeVia: () => null });
        @field thumbnailURL = contains(StringCard, { computeVia: () => null });
      }
      class LineItem extends Item {
        @field quantity = contains(NumberCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template><div data-test-line-item="{{@model.name}}"><@fields.name/> - <@fields.quantity/> @ $<@fields.price/> USD</div></template>
        };
      }
      export class Invoice extends CardDef {
        @field vendor = linksTo(Vendor);
        @field lineItems = containsMany(LineItem);
        @field balanceDue = contains(NumberCard, { computeVia: function(this: Invoice) {
          return this.lineItems.length === 0 ? 0 : this.lineItems.map(i => i.price * i.quantity).reduce((a, b) => (a + b));
        }});
        @field title =  contains(StringCard, {
          computeVia: function (this: Invoice) {
            return this.vendor ? 'Invoice from ' + this.vendor.title : 'Invoice'
          },
        });
        @field description = contains(StringCard, { computeVia: () => 'Invoice' });
        @field thumbnailURL = contains(StringCard, { computeVia: () => null });
        static embedded = class Embedded extends Component<typeof Invoice> {
          <template>
            <h3>Invoice</h3>
            Vendor: <@fields.vendor/>
            <@fields.lineItems/>
            Balance Due: $<span data-test-balance-due><@fields.balanceDue/></span> USD
          </template>
        };
      }
    `,
    );

    const args: CodeRef = { module: `${testRealmURL}invoice`, name: 'Invoice' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CatalogEntryEditor @ref={{args}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );

    await waitFor('button[data-test-catalog-entry-publish]');
    await click('[data-test-catalog-entry-publish]');
    await waitFor('[data-test-ref]');

    await click('[data-test-field="lineItems"] [data-test-add-new]');
    await fillIn('[data-test-field="name"] input', 'Keyboard');
    await fillIn('[data-test-field="quantity"] input', '2');
    await fillIn('[data-test-field="price"] input', '150');

    await click('[data-test-field="vendor"] [data-test-add-new]');
    await waitFor('[data-test-card-catalog-modal]');
    await waitFor('[data-test-card-catalog-create-new-button]');

    await click('[data-test-card-catalog-create-new-button]');
    await waitFor('[data-test-create-new-card="Vendor"]');
    await fillIn('[data-test-field="company"] input', 'Big Tech');

    await click('[data-test-create-new-card="Vendor"] [data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    await click('button[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.dom('[data-test-company]').hasText('Big Tech');
    assert
      .dom('[data-test-line-item="Keyboard"]')
      .hasText('Keyboard - 2 @ $ 150 USD');
    assert.dom('[data-test-balance-due]').hasText('300');

    let entry = await realm.searchIndex.card(
      new URL(`${testRealmURL}CatalogEntry/1`),
    );
    assert.ok(entry, 'the new catalog entry was created');

    let fileRef = await adapter.openFile('CatalogEntry/1.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            title: `Invoice from ${testRealmURL}invoice`,
            description: `Catalog entry for Invoice from ${testRealmURL}invoice`,
            ref: {
              module: `${testRealmURL}invoice`,
              name: 'Invoice',
            },
            demo: {
              lineItems: [
                {
                  name: 'Keyboard',
                  quantity: 2,
                  price: 150,
                },
              ],
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
                  module: `${testRealmURL}invoice`,
                  name: 'Invoice',
                },
              },
            },
          },
          relationships: {
            'demo.vendor': {
              links: {
                self: `${testRealmURL}cards/1`,
              },
            },
          },
        },
      },
      'file contents are correct',
    );

    let vendorfileRef = await realm.searchIndex.card(
      new URL(`${testRealmURL}cards/1`),
    );
    if (!vendorfileRef || !('doc' in vendorfileRef)) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      vendorfileRef?.doc.data.meta.adoptsFrom,
      {
        type: 'fieldOf',
        field: 'vendor',
        card: {
          module: `${testRealmURL}invoice`,
          name: 'Invoice',
        },
      },
      'newly created vendor file has correct meta.adoptsFrom',
    );
  });
});
