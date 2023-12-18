import {
  visit,
  click,
  waitFor,
  fillIn,
  triggerKeyEvent,
  waitUntil,
  scrollTo,
} from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';

import stringify from 'safe-stable-stringify';

import {
  baseRealm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import { Realm } from '@cardstack/runtime-common/realm';

import type LoaderService from '@cardstack/host/services/loader-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

import {
  getMonacoContent,
  percySnapshot,
  setupAcceptanceTestRealm,
  setMonacoContent,
  setupLocalIndexing,
  testRealmURL,
  setupServerSentEvents,
  waitForCodeEditor,
  type TestContextWithSSE,
} from '../helpers';
import { setupMatrixServiceMock } from '../helpers/mock-matrix-service';

const indexCardSource = `
  import { CardDef, Component } from "https://cardstack.com/base/card-api";

  export class Index extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-index-card>
          Hello, world!
        </div>
      </template>
    };
  }
`;

const postalCodeFieldSource = `
  import {
    contains,
    field,
    Component,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import StringCard from 'https://cardstack.com/base/string';

  export class PostalCode extends FieldDef {
    static displayName = 'Postal Code';
    @field fiveDigitPostalCode = contains(StringCard); // required
    @field fourDigitOptional = contains(StringCard);

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <address>
          <div><@fields.fiveDigitPostalCode /> - <@fields.fourDigitOptional /></div>
        </address>
      </template>
    };
  }
`;

const addressFieldSource = `
  import {
    contains,
    field,
    Component,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import StringCard from 'https://cardstack.com/base/string';
  import { PostalCode } from './postal-code';

  export class Address extends FieldDef {
    static displayName = 'Address';
    @field streetAddress = contains(StringCard); // required
    @field city = contains(StringCard); // required
    @field region = contains(StringCard);
    @field postalCode = contains(PostalCode);
    @field poBoxNumber = contains(StringCard);
    @field country = contains(StringCard); // required // dropdown

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <address>
          <div><@fields.streetAddress /></div>
          <@fields.city />
          <@fields.region />
          <@fields.postalCode /><@fields.poBoxNumber />
          <@fields.country />
        </address>
      </template>
    };
  }
`;

const countryCardSource = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Country extends CardDef {
    static displayName = 'Country';
    @field name = contains(StringField);
    @field title = contains(StringField, {
      computeVia(this: Country) {
        return this.name;
      },
    });

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <address>
          <@fields.name />
        </address>
      </template>
    };
  }
`;

const tripsFieldSource = `
  import {
    linksToMany,
    field,
    Component,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import { Country } from './country';

  export class Trips extends FieldDef {
    static displayName = 'Trips';
    @field countriesVisited = linksToMany(Country);

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <address>
          <@fields.countriesVisited />
        </address>
      </template>
    };
  }
`;

const personCardSource = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";
  import { Friend } from './friend';
  import { Pet } from "./pet";
  import { Address } from './address';
  import { Trips } from './trips';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    @field title = contains(StringCard, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field pet = linksTo(Pet);
    @field friends = linksToMany(Friend);
    @field address = containsMany(StringCard);
    @field addressDetail = contains(Address);
    @field trips = contains(Trips);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
          <p>Address List: <@fields.address /></p>
          <p>Friends: <@fields.friends /></p>
        </div>
        <style>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }
`;

const petCardSource = `
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
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <h1>{{@model.title}}</h1>
        <h2 data-test-pet={{@model.name}}>
          <@fields.name/>
        </h2>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
      </template>
    }
  }
`;

const employeeCardSource = `
  import {
    contains,
    field,
    Component,
    CardDef
  } from 'https://cardstack.com/base/card-api';
  import StringCard from 'https://cardstack.com/base/string';
  import DateField from 'https://cardstack.com/base/date';
  import BooleanField from 'https://cardstack.com/base/boolean';
  import { Person } from './person';

  export function isHourly (this: Employee) {
    return !this.isSalaried;
  }

  export class Isolated extends Component<typeof Employee> {
    <template>
      <@fields.firstName /> <@fields.lastName />

      Department: <@fields.department />
    </template>
  };

  export class Employee extends Person {
    static displayName = 'Employee';
    @field department = contains(StringCard);

    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <@fields.firstName /> <@fields.lastName />

        Department: <@fields.department />
      </template>
    };
  }
`;

const inThisFileSource = `
  import {
    contains,
    field,
    CardDef,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import StringCard from 'https://cardstack.com/base/string';

  export const exportedVar = 'exported var';

  const localVar = 'local var';

  class LocalClass {}
  export class ExportedClass {}

  export class ExportedClassInheritLocalClass extends LocalClass {}

  function localFunction() {}
  export function exportedFunction() {}

  export { LocalClass as AClassWithExportName };

  class LocalCard extends CardDef {
    static displayName = 'local card';
  }

  export class ExportedCard extends CardDef {
    static displayName = 'exported card';
    @field someString = contains(StringCard);
  }

  export class ExportedCardInheritLocalCard extends LocalCard {
    static displayName = 'exported card extends local card';
  }

  class LocalField extends FieldDef {
    static displayName = 'local field';
  }
  export class ExportedField extends FieldDef {
    static displayName = 'exported field';
    @field someString = contains(StringCard);
  }

  export class ExportedFieldInheritLocalField extends LocalField {
    static displayName = 'exported field extends local field';
  }

  export default class DefaultClass {}
`;

const friendCardSource = `
  import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Friend extends CardDef {
    static displayName = 'Friend';
    @field name = contains(StringCard);
    @field friend = linksTo(() => Friend);
    @field title = contains(StringCard, {
      computeVia: function (this: Person) {
        return name;
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
        </div>
        <style>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }
`;

const txtSource = `
  Hello, world!
`;

const brokenSource = 'some text to make the code broken' + friendCardSource;

module('Acceptance | code submode tests', function (hooks) {
  let realm: Realm;
  let monacoService: MonacoService;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);
  setupMatrixServiceMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    ({ realm } = await setupAcceptanceTestRealm({
      loader,
      contents: {
        'index.gts': indexCardSource,
        'pet-person.gts': personCardSource,
        'person.gts': personCardSource,
        'pet.gts': petCardSource,
        'friend.gts': friendCardSource,
        'employee.gts': employeeCardSource,
        'in-this-file.gts': inThisFileSource,
        'postal-code.gts': postalCodeFieldSource,
        'address.gts': addressFieldSource,
        'country.gts': countryCardSource,
        'trips.gts': tripsFieldSource,
        'broken.gts': brokenSource,
        'person-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Person',
              description: 'Catalog entry',
              ref: {
                module: `./person`,
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
        },
        'index.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: './index',
                name: 'Index',
              },
            },
          },
        },
        'not-json.json': 'I am not JSON.',
        'Person/fadhlan.json': {
          data: {
            attributes: {
              firstName: 'Fadhlan',
              address: [
                {
                  city: 'Bandung',
                  country: 'Indonesia',
                  shippingInfo: {
                    preferredCarrier: 'DHL',
                    remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
                  },
                },
              ],
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
        'Person/1.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Hassan',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        },
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
        'Country/united-states.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'United States',
              description: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: {
                module: '../country',
                name: 'Country',
              },
            },
          },
        },
        'hello.txt': txtSource,
        'z00.json': '{}',
        'z01.json': '{}',
        'z02.json': '{}',
        'z03.json': '{}',
        'z04.json': '{}',
        'z05.json': '{}',
        'z06.json': '{}',
        'z07.json': '{}',
        'z08.json': '{}',
        'z09.json': '{}',
        'z10.json': '{}',
        'z11.json': '{}',
        'z12.json': '{}',
        'z13.json': '{}',
        'z14.json': '{}',
        'z15.json': '{}',
        'z16.json': '{}',
        'z17.json': '{}',
        'z18.json': '{}',
        'z19.json': '{}',
        'zzz/zzz/file.json': '{}',
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
        'noop.gts': `export function noop() {};\nclass NoopClass {}`,
      },
    }));
  });

  test('defaults to inheritance view and can toggle to file view', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Person/1.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();
    await waitFor('[data-test-file-view-header]');

    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'Inspector');
    assert.dom('[data-test-inspector-toggle]').hasClass('active');
    assert.dom('[data-test-file-browser-toggle]').doesNotHaveClass('active');

    await waitFor('[data-test-card-inspector-panel]');

    assert.dom('[data-test-card-inspector-panel]').exists();
    assert.dom('[data-test-file]').doesNotExist();

    await click('[data-test-file-browser-toggle]');

    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'File Browser');
    assert.dom('[data-test-inspector-toggle]').doesNotHaveClass('active');
    assert.dom('[data-test-file-browser-toggle]').hasClass('active');

    await waitFor('[data-test-file]');

    assert.dom('[data-test-inheritance-placeholder]').doesNotExist();
    assert.dom('[data-test-file]').exists();
  });

  test('non-card JSON is shown as just a file with empty schema editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}z01.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitForCodeEditor();
    await waitFor('[data-test-file-definition]');

    assert.dom('[data-test-definition-file-extension]').hasText('.json');
    await waitFor('[data-test-definition-realm-name]');
    assert
      .dom('[data-test-definition-realm-name]')
      .hasText('in Test Workspace B');

    assert
      .dom('[data-test-file-incompatibility-message]')
      .hasText(
        'No tools are available to be used with this file type. Choose a file representing a card instance or module.',
      );
  });

  test('invalid JSON is shown as just a file with empty schema editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}not-json.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitForCodeEditor();
    await waitFor('[data-test-file-definition]');

    assert.dom('[data-test-definition-file-extension]').hasText('.json');
    await waitFor('[data-test-definition-realm-name]');
    assert
      .dom('[data-test-definition-realm-name]')
      .hasText('in Test Workspace B');
    assert
      .dom('[data-test-file-incompatibility-message]')
      .hasText(
        'No tools are available to be used with this file type. Choose a file representing a card instance or module.',
      );
  });

  test('showing module with a syntax error will display the error', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}broken.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-syntax-error]');

    assert
      .dom('[data-test-syntax-error]')
      .includesText('/broken.gts: Missing semicolon. (1:4)');
  });

  test('empty state displays default realm info', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: null,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file]');

    assert.dom('[data-test-file]').exists();
    assert.dom('[data-test-file-browser-toggle]').hasClass('active');
    assert.dom('[data-test-card-inspector-panel]').doesNotExist();
    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'File Browser');
    assert.dom('[data-test-inspector-toggle]').isDisabled();

    assert.dom('[data-test-empty-code-mode]').exists();
    assert
      .dom('[data-test-empty-code-mode]')
      .containsText('Choose a file on the left to open it');

    assert.dom('[data-test-card-url-bar-input]').hasValue('');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .containsText('in Test Workspace B');
  });

  test('not-found state displays default realm info', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}perso`, // purposely misspelled
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file]');

    assert.dom('[data-test-file]').exists();
    assert.dom('[data-test-file-browser-toggle]').hasClass('active');
    assert.dom('[data-test-card-inspector-panel]').doesNotExist();
    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'File Browser');
    assert.dom('[data-test-inspector-toggle]').isDisabled();

    assert.dom('[data-test-empty-code-mode]').doesNotExist();
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}perso`);
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .containsText('in Test Workspace B');
  });

  test('code submode handles binary files', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `http://localhost:4202/test/mango.png`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-binary-info]');
    await waitFor('[data-test-definition-file-extension]');
    assert.dom('[data-test-definition-file-extension]').hasText('.png');
    await waitFor('[data-test-definition-realm-name]');
    assert
      .dom('[data-test-definition-realm-name]')
      .hasText('in Test Workspace A');
    assert.dom('[data-test-definition-info-text]').containsText('Last saved');
    assert
      .dom('[data-test-binary-info] [data-test-file-name]')
      .hasText('mango.png');
    assert.dom('[data-test-binary-info] [data-test-size]').hasText('114.71 kB');
    assert
      .dom('[data-test-binary-info] [data-test-last-modified]')
      .containsText('Last modified');
    assert
      .dom('[data-test-file-incompatibility-message]')
      .hasText(
        'No tools are available to be used with this file type. Choose a file representing a card instance or module.',
      );
    await percySnapshot(assert);
  });

  test('can handle error when user puts unidentified domain in card URL bar', async function (assert) {
    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitForCodeEditor();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `http://unknown-domain.com/test/mango.png`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await waitFor('[data-test-card-url-bar-error]');
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('This resource does not exist');
  });

  test('card preview will show in the 3rd column when submode is set to code', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/fadhlan`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Person/fadhlan.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitForCodeEditor();
    await waitFor('[data-test-card-resource-loaded]');

    assert.dom('[data-test-code-mode-card-preview-header]').hasText('Person');
    assert
      .dom('[data-test-code-mode-card-preview-body]')
      .includesText('Fadhlan');

    assert
      .dom('[data-test-preview-card-footer-button-isolated]')
      .hasClass('active');

    await click('[data-test-preview-card-footer-button-atom]');
    assert
      .dom('[data-test-preview-card-footer-button-atom]')
      .hasClass('active');
    assert.dom('[data-test-code-mode-card-preview-body] .atom-format').exists();
    assert
      .dom('[data-test-code-mode-card-preview-body] .atom-format')
      .includesText('Fadhlan');

    await click('[data-test-preview-card-footer-button-embedded]');
    assert
      .dom('[data-test-preview-card-footer-button-embedded]')
      .hasClass('active');
    assert
      .dom(
        '[data-test-code-mode-card-preview-body ] .field-component-card.embedded-format',
      )
      .exists();

    await click('[data-test-preview-card-footer-button-edit]');
    assert
      .dom('[data-test-preview-card-footer-button-edit]')
      .hasClass('active');

    assert
      .dom(
        '[data-test-code-mode-card-preview-body ] .field-component-card.edit-format',
      )
      .exists();

    // Only preview is shown in the right column when viewing an instance, no schema editor
    assert.dom('[data-test-card-schema]').doesNotExist();
  });

  test('displays clear message when a schema-editor incompatible item is selected within a valid file type', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();

    await waitFor('[data-test-loading-indicator]', { count: 0 });

    await waitFor(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected]',
    );
    assert
      .dom(
        '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected]',
      )
      .hasText('isHourly function');
    assert
      .dom('[data-test-file-incompatibility-message]')
      .hasText(
        'No tools are available for the selected item: function "isHourly". Select a card or field definition in the inspector.',
      );

    await click('[data-test-boxel-selector-item-text="Isolated"]');
    await waitFor('[data-test-loading-indicator]', { count: 0 });

    assert
      .dom(
        '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected]',
      )
      .hasText('Isolated class');
    assert
      .dom('[data-test-file-incompatibility-message]')
      .hasText(
        'No tools are available for the selected item: class "Isolated". Select a card or field definition in the inspector.',
      );

    operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}noop.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-loading-indicator]', { count: 0 });
    assert.dom('[data-test-file-incompatibility-message]').exists();
  });

  test('displays clear message on schema-editor when file is completely unsupported', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file-incompatibility-message]');
    assert
      .dom('[data-test-file-incompatibility-message]')
      .hasText(
        'No tools are available to inspect this file or its contents. Select a file with a .json, .gts or .ts extension.',
      );

    await waitFor('[data-test-definition-file-extension]');
    assert.dom('[data-test-definition-file-extension]').hasText('.txt');
  });

  test('Clicking card in search panel opens card JSON in editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();

    assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

    // Click on search-input
    await click('[data-test-search-field]');

    assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

    await fillIn('[data-test-search-field]', 'Mango');

    assert.dom('[data-test-search-sheet]').hasClass('results'); // Search open

    await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`, {
      timeout: 2000,
    });

    // Click on search result
    await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

    assert.dom('[data-test-search-sheet]').doesNotHaveClass('results'); // Search closed

    // The card appears in the editor
    await waitForCodeEditor();
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
  });

  test('changes cursor position when selected module declaration is changed', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitForCodeEditor();
    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name]');
    await waitFor('[data-test-in-this-file-selector]');
    //default is the 1st index
    let elementName = 'AClassWithExportName (LocalClass) class';
    assert
      .dom('[data-test-boxel-selector-item]:nth-of-type(1)')
      .hasText(elementName);
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(elementName);
    assert.true(
      monacoService.getLineCursorOn()?.includes('LocalClass'),
      'cursor is on LocalClass line',
    );

    // clicking on a card
    elementName = 'ExportedCard';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.true(
      monacoService.getLineCursorOn()?.includes(elementName),
      'cursor is on ExportedCard line',
    );

    // clicking on a field
    elementName = 'ExportedField';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.true(
      monacoService.getLineCursorOn()?.includes(elementName),
      'cursor is on ExportedField line',
    );

    // clicking on an exported function
    elementName = 'exportedFunction';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.true(
      monacoService.getLineCursorOn()?.includes(elementName),
      'cursor is on exportedFunction line',
    );
  });

  test('changes selected module declaration when cursor position is changed', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();
    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name]');
    await waitFor('[data-test-in-this-file-selector]');
    //default is the 1st index
    let elementName = 'AClassWithExportName (LocalClass) class';
    assert
      .dom('[data-test-boxel-selector-item]:nth-of-type(1)')
      .hasText(elementName);
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(elementName);
    assert.true(monacoService.getLineCursorOn()?.includes('LocalClass'));

    elementName = 'ExportedFieldInheritLocalField';
    let position = new MonacoSDK.Position(45, 0);
    monacoService.updateCursorPosition(position);
    await waitFor(
      `[data-test-boxel-selector-item-selected] [data-test-boxel-selector-item-text="${elementName}"]`,
    );
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} field`);

    elementName = 'LocalField';
    position = new MonacoSDK.Position(38, 0);
    monacoService.updateCursorPosition(position);
    await waitFor(
      `[data-test-boxel-selector-item-selected] [data-test-boxel-selector-item-text="${elementName}"]`,
    );
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} field`);

    elementName = 'ExportedCard';
    position = new MonacoSDK.Position(31, 0);
    monacoService.updateCursorPosition(position);
    await waitFor(
      `[data-test-boxel-selector-item-selected] [data-test-boxel-selector-item-text="${elementName}"]`,
    );
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);
  });

  test<TestContextWithSSE>('the monaco cursor position is maintained during an auto-save', async function (assert) {
    assert.expect(3);
    // we only want to change this for this particular test so we emulate what the non-test env sees
    monacoService.serverEchoDebounceMs = 5000;
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}in-this-file.gts`],
        },
      },
    ];

    try {
      let operatorModeStateParam = stringify({
        stacks: [[]],
        submode: 'code',
        codePath: `${testRealmURL}in-this-file.gts`,
      })!;

      await visit(
        `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
          operatorModeStateParam,
        )}`,
      );
      await waitForCodeEditor();

      let originalPosition: MonacoSDK.Position | undefined | null;
      await this.expectEvents({
        assert,
        realm,
        expectedEvents,
        callback: async () => {
          setMonacoContent(`// This is a change \n${inThisFileSource}`);
          monacoService.updateCursorPosition(new MonacoSDK.Position(45, 0));
          originalPosition = monacoService.getCursorPosition();
        },
      });
      await waitFor('[data-test-saved]');
      await waitFor('[data-test-save-idle]');
      let currentPosition = monacoService.getCursorPosition();
      assert.strictEqual(
        originalPosition!.lineNumber,
        currentPosition?.lineNumber,
        'cursor position line number has not changed',
      );
      assert.strictEqual(
        originalPosition!.column,
        currentPosition?.column,
        'cursor position column has not changed',
      );
    } finally {
      // set this back correctly regardless of test outcome
      monacoService.serverEchoDebounceMs = 0;
    }
  });

  test('cursor is placed at the correct declaration when user opens definition', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();

    await waitFor(`[data-boxel-selector-item-text="Employee"]`);
    await click(`[data-boxel-selector-item-text="Employee"]`);
    let lineCursorOn = monacoService.getLineCursorOn();
    assert.true(
      lineCursorOn?.includes('Employee'),
      'cursor is at Employee declaration',
    );

    await click(`[data-test-clickable-definition-container`);
    await waitFor(`[data-boxel-selector-item-text="Person"]`);
    await waitUntil(() => monacoService.hasFocus);
    lineCursorOn = monacoService.getLineCursorOn();
    assert.true(
      lineCursorOn?.includes('Person'),
      'cursor is at Person declaration',
    );
  });

  test('cursor must not be in editor if user focuses on other elements', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();

    await waitFor(`[data-boxel-selector-item-text="Employee"]`);
    await click(`[data-boxel-selector-item-text="Employee"]`);
    assert.true(monacoService.hasFocus);

    await fillIn('[data-test-card-url-bar] input', `${testRealmURL}person.gts`);
    assert.false(monacoService.hasFocus);
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await waitFor(`[data-boxel-selector-item-text="Person"]`);
    assert.true(monacoService.hasFocus);

    await fillIn(
      '[data-test-card-url-bar] input',
      `${testRealmURL}person.gts-test`,
    );
    assert.false(monacoService.hasFocus);
  });

  test('scroll position persists when changing card preview format', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}Pet/mango.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();
    await waitFor('[data-test-code-mode-card-preview-body]');

    await scrollTo('[data-test-code-mode-card-preview-body]', 0, 100);
    await click('[data-test-preview-card-footer-button-edit]');
    await click('[data-test-preview-card-footer-button-isolated]');
    let element = document.querySelector(
      '[data-test-code-mode-card-preview-body]',
    )!;
    assert.strictEqual(
      element.scrollTop,
      100,
      'the scroll position is correct',
    );
  });

  test<TestContextWithSSE>('updates values in preview panel must be represented in editor panel', async function (assert) {
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Person/fadhlan`],
        },
      },
    ];
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}Person/fadhlan.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitForCodeEditor();
    await waitFor('[data-test-code-mode-card-preview-body]');

    await click('[data-test-preview-card-footer-button-edit]');

    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        // primitive field
        await fillIn('[data-test-field="lastName"] input', 'Ridhwanallah');

        // compound field with 1 level
        await fillIn(
          '[data-test-field="streetAddress"] input',
          'Unknown Address',
        );
        await fillIn('[data-test-field="city"] input', 'Bandung');

        // compound field with 2 level
        await fillIn('[data-test-field="fiveDigitPostalCode"] input', '12345');
        await fillIn('[data-test-field="fourDigitOptional"] input', '1234');

        // compound field with linksToMany field
        await click(
          '[data-test-links-to-many="countriesVisited"] [data-test-add-new]',
        );
        await waitFor(
          `[data-test-select="${testRealmURL}Country/united-states"]`,
        );
        await click(
          `[data-test-select="${testRealmURL}Country/united-states"]`,
        );
        await click(`[data-test-card-catalog-go-button]`);
      },
      opts: { timeout: 4500 },
    });
    await waitFor('[data-test-saved]');
    await waitFor('[data-test-save-idle]');

    let content = getMonacoContent();
    assert.ok(content.includes('Ridhwanallah'));
    assert.ok(content.includes('Unknown Address'));
    assert.ok(content.includes('Bandung'));
    assert.ok(content.includes('12345'));
    assert.ok(content.includes('1234'));
    assert.ok(content.includes(`${testRealmURL}Country/united-states`));
  });

  test<TestContextWithSSE>('card preview live updates when index changes', async function (assert) {
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Person/fadhlan`],
        },
      },
    ];
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/fadhlan`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Person/fadhlan.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-card-resource-loaded]');
    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        await realm.write(
          'Person/fadhlan.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                firstName: 'FadhlanXXX',
              },
              meta: {
                adoptsFrom: {
                  module: '../person',
                  name: 'Person',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
      },
    });
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-code-mode-card-preview-body]')
          ?.textContent?.includes('FadhlanXXX'),
    );
    assert
      .dom('[data-test-code-mode-card-preview-body]')
      .includesText('FadhlanXXX');
  });

  test('card-catalog does not offer to "create new card" when editing linked fields in code mode', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}Person/fadhlan.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor('[data-test-card-resource-loaded]');
    assert
      .dom(
        `[data-test-code-mode-card-preview-header="${testRealmURL}Person/fadhlan"]`,
      )
      .exists();

    await click('[data-test-preview-card-footer-button-edit]');

    // linksTo field
    await click('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await waitFor('[data-test-links-to-editor="pet"] [data-test-add-new]');
    await click('[data-test-links-to-editor="pet"] [data-test-add-new]');
    await waitFor('[data-test-card-catalog-modal]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a Pet card');
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .doesNotExist('can not create new card for linksTo field in code mode');

    await click('[aria-label="close modal"]');
    await waitFor('[data-test-card-catalog-modal]', { count: 0 });

    // linksToMany field
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor('[data-test-card-catalog-modal]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Select 1 or more Friend cards');
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .doesNotExist(
        'can not create new card for linksToMany field in code mode',
      );
  });
});
