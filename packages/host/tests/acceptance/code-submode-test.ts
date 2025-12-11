import {
  click,
  waitFor,
  fillIn,
  triggerKeyEvent,
  waitUntil,
  scrollTo,
  visit,
  settled,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import * as MonacoSDK from 'monaco-editor';
import { module, skip, test } from 'qunit';

import stringify from 'safe-stable-stringify';

import {
  baseRealm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { Realm } from '@cardstack/runtime-common/realm';

import type MonacoService from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  ModuleInspectorSelections,
  PlaygroundSelections,
  SpecSelection,
} from '@cardstack/host/utils/local-storage-keys';

import {
  getMonacoContent,
  percySnapshot,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setMonacoContent,
  setupLocalIndexing,
  testRealmURL,
  visitOperatorMode,
  assertMessages,
  setupSnapshotRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  removePlaygroundSelections,
  removeSpecSelection,
  setPlaygroundSelections,
} from '../helpers/playground';
import { setupApplicationTest } from '../helpers/setup';

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
  import StringField from 'https://cardstack.com/base/string';

  export class PostalCode extends FieldDef {
    static displayName = 'Postal Code';
    @field fiveDigitPostalCode = contains(StringField); // required
    @field fourDigitOptional = contains(StringField);

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
  import StringField from 'https://cardstack.com/base/string';
  import { PostalCode } from './postal-code';

  export class Address extends FieldDef {
    static displayName = 'Address';
    @field streetAddress = contains(StringField); // required
    @field city = contains(StringField); // required
    @field region = contains(StringField);
    @field postalCode = contains(PostalCode);
    @field poBoxNumber = contains(StringField);
    @field country = contains(StringField); // required // dropdown

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
  import StringField from "https://cardstack.com/base/string";
  import { Friend } from './friend';
  import { Pet } from "./pet";
  import { Address } from './address';
  import { Trips } from './trips';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field pet = linksTo(Pet);
    @field friends = linksToMany(Friend);
    @field address = containsMany(StringField);
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
        <style scoped>
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
  import StringField from 'https://cardstack.com/base/string';
  import DateField from 'https://cardstack.com/base/date';
  import BooleanField from 'https://cardstack.com/base/boolean';
  import { Person } from './person';

  export class Isolated extends Component<typeof Employee> {
    <template>
      <@fields.firstName /> <@fields.lastName />

      Department: <@fields.department />
    </template>
  };

  export class Employee extends Person {
    static displayName = 'Employee';
    @field department = contains(StringField);

    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <@fields.firstName /> <@fields.lastName />

        Department: <@fields.department />
      </template>
    };
  }

  export function isHourly (this: Employee) {
    return !this.isSalaried;
  }
`;

const inThisFileSource = `
  import {
    contains,
    field,
    CardDef,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

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
    @field someString = contains(StringField);
  }

  export class ExportedCardInheritLocalCard extends LocalCard {
    static displayName = 'exported card extends local card';
  }

  class LocalField extends FieldDef {
    static displayName = 'local field';
  }
  export class ExportedField extends FieldDef {
    static displayName = 'exported field';
    @field someString = contains(StringField);
  }

  export class ExportedFieldInheritLocalField extends LocalField {
    static displayName = 'exported field extends local field';
  }

  export default class DefaultClass {}
`;

const friendCardSource = `
  import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Friend extends CardDef {
    static displayName = 'Friend';
    @field name = contains(StringField);
    @field friend = linksTo(() => Friend);
    @field title = contains(StringField, {
      computeVia: function (this: Friend) {
        return this.name;
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-friend-card={{@model.name}}>
          <p>Friend name: <@fields.name /></p>
          <div data-test-friend-link>
            <@fields.friend />
          </div>
        </div>
        <style scoped>
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

const brokenCountryCardSource = countryCardSource.replace(
  'return this.name',
  'return intentionalError(this.name)',
);

const brokenAdoptionInstance = `{
  "data": {
    "type": "card",
    "attributes": {
      "name": "El Campo"
    },
    "meta": {
      "adoptsFrom": {
        "module": "./broken-country",
        "name": "Country"
      }
    }
  }
}
`;

const notFoundAdoptionInstance = `{
  "data": {
    "type": "card",
    "attributes": {
      "firstName": "Alice",
      "lastName": "Enwunder",
      "body": "xyz"
    },
    "meta": {
      "adoptsFrom": {
        "module": "./non-card",
        "name": "Author"
      }
    }
  }
}
`;

let personalRealmURL: string;

module('Acceptance | code submode tests', function (_hooks) {
  module('multiple realms', function (hooks) {
    let additionalRealmURL: string;
    let catalogRealmURL: string;

    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  let { setActiveRealms, createAndJoinRoom } = mockMatrixUtils;
  let defaultMatrixRoomId: string;
  let snapshot = setupSnapshotRealm<{
    personalRealmURL: string;
    additionalRealmURL: string;
    catalogRealmURL: string;
  }>(hooks, {
    mockMatrixUtils,
    acceptanceTest: true,
    async build({ loader, isInitialBuild }) {
      if (isInitialBuild || !defaultMatrixRoomId) {
        defaultMatrixRoomId = createAndJoinRoom({
          sender: '@testuser:localhost',
          name: 'room-test',
        });
      }

      let realmServerService = getService('realm-server');
      personalRealmURL = `${realmServerService.url}testuser/personal/`;
      additionalRealmURL = `${realmServerService.url}testuser/aaa/`;
      catalogRealmURL = `${realmServerService.url}catalog/`;
      setActiveRealms([catalogRealmURL, additionalRealmURL, personalRealmURL]);

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        realmURL: personalRealmURL,
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'hello.txt': txtSource,
          '.realm.json': {
            name: `Test User's Workspace`,
            backgroundURL: 'https://i.postimg.cc/NjcjbyD3/4k-origami-flock.jpg',
            iconURL: 'https://i.postimg.cc/Rq550Bwv/T.png',
          },
        },
      });
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        realmURL: additionalRealmURL,
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'hello.txt': txtSource,
          '.realm.json': {
            name: `Additional Workspace`,
            backgroundURL: 'https://i.postimg.cc/4ycXQZ94/4k-powder-puff.jpg',
            iconURL: 'https://i.postimg.cc/BZwv0LyC/A.png',
          },
        },
      });
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        realmURL: catalogRealmURL,
        permissions: {
          '*': ['read'],
        },
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'hello.txt': txtSource,
          '.realm.json': {
            name: `Catalog Realm`,
            backgroundURL: 'https://i.postimg.cc/zXsXLmqb/C.png',
            iconURL: 'https://i.postimg.cc/qv4pyPM0/4k-watercolor-splashes.jpg',
          },
        },
      });
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        realmURL: testRealmURL,
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
        },
      });
      return { personalRealmURL, additionalRealmURL, catalogRealmURL };
    },
  });

  async function openNewFileModal(menuSelection: string) {
    await waitFor('[data-test-new-file-button]');
    await click('[data-test-new-file-button]');
    await click(`[data-test-boxel-menu-item-text="${menuSelection}"]`);
  }

  hooks.beforeEach(function () {
    let snapshotState = snapshot.get();
    personalRealmURL = snapshotState.personalRealmURL;
    additionalRealmURL = snapshotState.additionalRealmURL;
    catalogRealmURL = snapshotState.catalogRealmURL;
    removePlaygroundSelections();
    removeSpecSelection();
    window.localStorage.removeItem(ModuleInspectorSelections);
    window.localStorage.removeItem(PlaygroundSelections);
    window.localStorage.removeItem(SpecSelection);
    setActiveRealms([catalogRealmURL, additionalRealmURL, personalRealmURL]);
  });

    test('default realm is the personal realm', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
      });

      await waitFor('[data-test-file]');
      assert
        .dom('[data-test-card-url-bar-realm-info]')
        .containsText(`in Test User's Workspace`);
    });

    test('first item in add file realm dropdown is the currently displayed realm', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
      });

      await waitFor('[data-test-file]');
      await openNewFileModal('Card Definition');
      assert
        .dom('[data-test-selected-realm]')
        .containsText(
          `Test User's Workspace`,
          'the selected (default) realm is correct',
        );
      await click('[data-test-cancel-create-file]');

      await visitOperatorMode({
        submode: 'code',
        codePath: `${additionalRealmURL}hello.txt`,
      });
      await openNewFileModal('Card Definition');
      assert
        .dom('[data-test-selected-realm]')
        .containsText(`Additional Workspace`, 'the selected realm is correct');
    });
  });

  module('single realm', function (hooks) {
    let realm: Realm;
    let monacoService: MonacoService;

    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom, setActiveRealms } = mockMatrixUtils;
  let defaultMatrixRoomId: string;
  let snapshot = setupSnapshotRealm<{
    monacoService: MonacoService;
    realm: Realm;
  }>(hooks, {
    mockMatrixUtils,
    acceptanceTest: true,
    async build({ loader, isInitialBuild }) {
      if (isInitialBuild || !defaultMatrixRoomId) {
        defaultMatrixRoomId = createAndJoinRoom({
          sender: '@testuser:localhost',
          name: 'room-test',
        });
      }

      monacoService = getService('monaco-service');

      // this seeds the loader used during index which obtains url mappings
      // from the global loader
      ({ realm } = await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
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
          'broken-country.gts': brokenCountryCardSource,
          'broken-adoption-instance.json': brokenAdoptionInstance,
          'not-found-adoption-instance.json': notFoundAdoptionInstance,
          'person-entry.json': {
            data: {
              type: 'card',
              attributes: {
                title: 'Person',
                description: 'Spec',
                specType: 'card',
                ref: {
                  module: `./person`,
                  name: 'Person',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
                },
              },
            },
          },
          'pet-entry.json': {
            data: {
              type: 'card',
              attributes: {
                specType: 'card',
                ref: {
                  module: `./pet`,
                  name: 'Pet',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
                },
              },
            },
          },
          'pet-entry-2.json': {
            data: {
              type: 'card',
              attributes: {
                specType: 'card',
                ref: {
                  module: `./pet`,
                  name: 'Pet',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
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
          'Friend/amy.json': {
            data: {
              attributes: {
                name: 'Amy',
              },
              relationships: {
                friend: {
                  links: {
                    self: `${testRealmURL}Friend/bob`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}friend`,
                  name: 'Friend',
                },
              },
            },
          },
          'Friend/bob.json': {
            data: {
              attributes: {
                name: 'Bob',
              },
              relationships: {},
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}friend`,
                  name: 'Friend',
                },
              },
            },
          },
          'Person/with-friends.json': {
            data: {
              attributes: {
                firstName: 'With',
                lastName: 'Friends',
              },
              relationships: {
                'friends.0': {
                  links: {
                    self: `${testRealmURL}Friend/amy`,
                  },
                },
                'friends.1': {
                  links: {
                    self: `${testRealmURL}Friend/bob`,
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
          'BrokenCountry/broken-country.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'Broken Country',
              },
              meta: {
                adoptsFrom: {
                  module: '../broken-country',
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

      return { monacoService, realm };
    },
  });

  hooks.beforeEach(function () {
    ({ monacoService, realm } = snapshot.get());
    setActiveRealms([testRealmURL]);
  });

    test('defaults to inheritance view and can toggle to file view', async function (assert) {
      await visitOperatorMode({
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
      });

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
      await visitOperatorMode({
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
      });

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

      assert.dom('[data-test-definition-header]').includesText('File');

      assert
        .dom('[data-test-definition-realm-name]')
        .hasText('in Test Workspace B');
      assert.dom('[data-test-action-button="Delete"]').exists();
    });

    test('invalid JSON is shown as just a file with empty schema editor', async function (assert) {
      await visitOperatorMode({
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
      });

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
      await waitFor('[data-test-error-details]');
      assert
        .dom('[data-test-error-details]')
        .includesText('Parse Error at broken.gts:1:6: 1:10');

      assert.dom('[data-test-ai-assistant-panel]').doesNotExist();
      await click('[data-test-send-error-to-ai-assistant]');
      assert.dom('[data-test-ai-assistant-panel]').exists();
      assertMessages(assert, [
        {
          from: 'testuser',
          message: `In the attachment file, I encountered an error that needs fixing: Syntax Error Stack trace: Error: Parse Error at broken.gts:1:6: 1:10`,
          files: [
            { name: 'broken.gts', sourceUrl: `${testRealmURL}broken.gts` },
          ],
        },
      ]);
      let roomId = getService('matrix-service').currentRoomId;
      let lastEvent = mockMatrixUtils.getRoomEvents(roomId!).pop();
      assert.ok(
        JSON.parse(lastEvent!.content.data).context.agentId,
        'message has agentId context so that AI assistant knows not to respond to it',
      );
      assert.dom('[data-test-send-error-to-ai-assistant]').exists();

      let originalWriteText = navigator.clipboard.writeText;
      let copiedText;
      navigator.clipboard.writeText = async (text: string) => {
        copiedText = text;
        return Promise.resolve();
      };
      await click('[data-test-boxel-copy-button]');
      const expected =
        '{"message":"","stack":"Error: Parse Error at broken.gts:1:6: 1:10';
      assert.ok(
        copiedText!.startsWith(expected),
        `clipboard text starts with ${expected}`,
      );
      navigator.clipboard.writeText = originalWriteText;
    });

    test('it shows card preview errors', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}not-found-adoption-instance.json`,
      });

      await waitFor('[data-test-card-error]');

      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-details]')
        .includesText(`${testRealmURL}non-card not found`);

      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}broken-adoption-instance.json`,
      });

      await waitFor('[data-test-card-error]');

      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-details]')
        .includesText(
          'Stack trace: Error: Encountered error rendering HTML for card: intentionalError is not defined at render',
        );

      await percySnapshot(assert);
    });

    test('it shows card preview errors and fix it button in playground panel', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}broken-country.gts`,
      });

      await click('[data-test-module-inspector-view="preview"]');
      await waitFor('[data-test-card-error]');
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-details]')
        .includesText(
          'Stack trace: Error: Encountered error rendering HTML for card: intentionalError is not defined at render',
        );

      assert.dom('[data-test-ai-assistant-panel]').doesNotExist();
      await click('[data-test-send-error-to-ai-assistant]');
      assert.dom('[data-test-ai-assistant-panel]').exists();
      assertMessages(assert, [
        {
          from: 'testuser',
          message: `In the attachment file, I encountered an error that needs fixing: Card Error Encountered error rendering HTML for card: intentionalError is not defined`,
          files: [
            {
              name: 'broken-country.gts',
              sourceUrl: `${testRealmURL}broken-country.gts`,
            },
          ],
        },
      ]);
      assert.dom('[data-test-send-error-to-ai-assistant]').exists();
    });

    test('erroring cards attached as files instead and errors are included in AI context', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}broken-country.gts`,
        aiAssistantOpen: true,
        moduleInspector: 'preview',
      });

      assert.dom('[data-test-ai-assistant-panel]').exists();
      let roomId = mockMatrixUtils.getRoomIds().pop()!;
      let instanceId = document
        .querySelector('[data-test-card-error]')
        ?.getAttribute('data-test-card-error');
      if (!instanceId) {
        assert.ok(false, 'could not find instance ID for the instance error');
      } else {
        await fillIn(
          '[data-test-message-field]',
          `Please try to fix the problem`,
        );
        await click('[data-test-send-message-btn]');

        assertMessages(assert, [
          {
            from: 'testuser',
            message: `Please try to fix the problem`,
            files: [
              {
                name: 'broken-country.gts',
                sourceUrl: `${testRealmURL}broken-country.gts`,
              },
              {
                name: instanceId.split('/').pop()!,
                sourceUrl: `${instanceId}.json`,
              },
            ],
          },
        ]);
      }
      let matrixEvents = mockMatrixUtils.getRoomEvents(roomId);
      let lastEvent = matrixEvents[matrixEvents.length - 1];
      let aiContext = JSON.parse(lastEvent.content.data).context;
      assert.strictEqual(
        aiContext.errorsDisplayed[0].message,
        'Encountered error rendering HTML for card: intentionalError is not defined',
      );
      assert.ok(aiContext.errorsDisplayed[0].stack.match(/at render/));
      assert.strictEqual(
        aiContext.errorsDisplayed[0].sourceUrl,
        `${testRealmURL}broken-country.gts`,
      );
    });

    test('it shows card preview errors and fix it button in module inspector', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}BrokenCountry/broken-country.json`,
      });

      assert.dom('[data-test-error-display]').exists();
      assert
        .dom('[data-test-error-display] [data-test-error-message]')
        .hasText(
          'Encountered error rendering HTML for card: intentionalError is not defined',
        );

      assert.dom('[data-test-ai-assistant-panel]').doesNotExist();
      await click('[data-test-send-error-to-ai-assistant]');
      assert.dom('[data-test-ai-assistant-panel]').exists();
      assertMessages(assert, [
        {
          from: 'testuser',
          message: `In the attachment file, I encountered an error that needs fixing: Card Error Encountered error rendering HTML for card: intentionalError is not defined`,
          files: [
            {
              name: 'broken-country.gts',
              sourceUrl: `${testRealmURL}broken-country.gts`,
            },
          ],
        },
      ]);
    });

    test('empty state displays default realm info', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
      });

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
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}perso`, // purposely misspelled
      });

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
    module('with connection to test realm', function (hooks) {
      hooks.beforeEach(function () {
        setActiveRealms([testRealmURL, 'http://localhost:4202/test/']);
      });
      test('code submode handles binary files', async function (assert) {
        await visitOperatorMode({
          submode: 'code',
          codePath: `http://localhost:4202/test/mango.png`,
        });

        await waitFor('[data-test-binary-info]');
        await waitFor('[data-test-definition-file-extension]');
        assert.dom('[data-test-definition-file-extension]').hasText('.png');
        await waitFor('[data-test-definition-realm-name]');
        assert
          .dom('[data-test-definition-realm-name]')
          .hasText('in Test Workspace A');
        assert
          .dom('[data-test-definition-info-text]')
          .containsText('Last saved');
        assert
          .dom('[data-test-binary-info] [data-test-file-name]')
          .hasText('mango.png');
        assert
          .dom('[data-test-binary-info] [data-test-size]')
          .hasText('114.71 kB');
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
    });

    test('can handle error when user puts unidentified domain in card URL bar', async function (assert) {
      await visitOperatorMode({
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
      });

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
      await visitOperatorMode({
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
      });

      await waitFor('[data-test-card-resource-loaded]');

      assert
        .dom('[data-test-code-mode-card-renderer-header]')
        .hasText('Person - Fadhlan');
      assert
        .dom('[data-test-code-mode-card-renderer-body]')
        .includesText('Fadhlan');

      assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');

      await click('[data-test-format-chooser="fitted"]');
      assert.dom('[data-test-format-chooser="fitted"]').hasClass('active');
      assert
        .dom(
          '[data-test-code-mode-card-renderer-body ] .field-component-card.fitted-format',
        )
        .exists();

      await click('[data-test-format-chooser="embedded"]');
      assert.dom('[data-test-format-chooser="embedded"]').hasClass('active');
      assert
        .dom(
          '[data-test-code-mode-card-renderer-body ] .field-component-card.embedded-format',
        )
        .exists();

      await click('[data-test-format-chooser="atom"]');
      assert.dom('[data-test-format-chooser="atom"]').hasClass('active');
      assert
        .dom('[data-test-code-mode-card-renderer-body] .atom-format')
        .exists();
      assert
        .dom('[data-test-code-mode-card-renderer-body] .atom-format')
        .includesText('Fadhlan');

      await click('[data-test-format-chooser="edit"]');
      assert.dom('[data-test-format-chooser="edit"]').hasClass('active');

      assert
        .dom(
          '[data-test-code-mode-card-renderer-body ] .field-component-card.edit-format',
        )
        .exists();

      // Only preview is shown in the right column when viewing an instance, no schema editor
      assert.dom('[data-test-card-schema]').doesNotExist();
    });

    test('displays clear message when a schema-editor incompatible item is selected within a valid file type', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}employee.gts`,
      });

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
        .dom('[data-test-schema-editor-file-incompatibility-message]')
        .hasText(
          `No tools are available for the selected item: function "isHourly". Select a card or field definition in the inspector.`,
        );

      await click('[data-test-boxel-selector-item-text="Isolated"]');
      await waitFor('[data-test-loading-indicator]', { count: 0 });

      assert
        .dom(
          '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected]',
        )
        .hasText('Isolated class');
      assert
        .dom('[data-test-schema-editor-file-incompatibility-message]')
        .hasText(
          `No tools are available for the selected item: class "Isolated". Select a card or field definition in the inspector.`,
        );

      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}employee.gts`,
      });

      await waitFor('[data-test-loading-indicator]', { count: 0 });
      assert
        .dom('[data-test-schema-editor-file-incompatibility-message]')
        .exists();
    });

    test('displays clear message on schema-editor when file is completely unsupported', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}hello.txt`,
      });

      await waitFor('[data-test-file-incompatibility-message]');
      assert
        .dom('[data-test-file-incompatibility-message]')
        .hasText(
          'No tools are available to be used with this file type. Choose a file representing a card instance or module.',
        );

      await waitFor('[data-test-definition-file-extension]');
      assert.dom('[data-test-definition-file-extension]').hasText('.txt');
    });

    test('Clicking card in search panel opens card JSON in editor', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}employee.gts`,
      });

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await fillIn('[data-test-search-field]', 'Mango');

      assert.dom('[data-test-search-sheet]').hasClass('results'); // Search open

      await waitFor(`[data-test-search-result="${testRealmURL}Pet/mango"]`, {
        timeout: 2000,
      });

      // Click on search result
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('results'); // Search sheet is closed
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

    test('clicking a linksTo field in card renderer panel opens the linked card JSON', async function (assert) {
      let operatorModeStateService = getService(
        'operator-mode-state-service',
      ) as OperatorModeStateService;

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Friend/amy`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        codePath: `${testRealmURL}Friend/amy.json`,
      });
      await waitFor('[data-test-code-mode-card-renderer-body]');
      assert.dom(`[data-test-card="${testRealmURL}Friend/amy"]`).exists();

      // Click the rendered linked friend card (linksTo field)
      await waitFor(`[data-test-card="${testRealmURL}Friend/bob"]`);
      await click(`[data-test-card="${testRealmURL}Friend/bob"]`);

      await waitUntil(() =>
        operatorModeStateService.state?.codePath?.href?.endsWith(
          'Friend/bob.json',
        ),
      );

      assert.strictEqual(
        operatorModeStateService.state?.codePath?.href,
        `${testRealmURL}Friend/bob.json`,
      );
      assert.deepEqual(JSON.parse(getMonacoContent()), {
        data: {
          attributes: {
            name: 'Bob',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}friend`,
              name: 'Friend',
            },
          },
          relationships: {},
        },
      });
    });

    test('clicking a linksToMany field in card renderer panel opens the linked card JSON', async function (assert) {
      let operatorModeStateService = getService(
        'operator-mode-state-service',
      ) as OperatorModeStateService;

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/with-friends`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        codePath: `${testRealmURL}Person/with-friends.json`,
      });
      await waitFor('[data-test-code-mode-card-renderer-body]');
      assert
        .dom(`[data-test-card="${testRealmURL}Person/with-friends"]`)
        .exists();

      // Click one of the rendered linked friend cards (linksToMany field)
      await waitFor(`[data-test-card="${testRealmURL}Friend/bob"]`);
      await click(`[data-test-card="${testRealmURL}Friend/bob"]`);

      await waitUntil(() =>
        operatorModeStateService.state?.codePath?.href?.endsWith(
          'Friend/bob.json',
        ),
      );

      assert.strictEqual(
        operatorModeStateService.state?.codePath?.href,
        `${testRealmURL}Friend/bob.json`,
      );
      assert.deepEqual(JSON.parse(getMonacoContent()), {
        data: {
          attributes: {
            name: 'Bob',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}friend`,
              name: 'Friend',
            },
          },
          relationships: {},
        },
      });
    });

    test('clicking a linksTo field in playground panel opens the linked card JSON', async function (assert) {
      let operatorModeStateService = getService(
        'operator-mode-state-service',
      ) as OperatorModeStateService;

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Friend/amy`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        codePath: `${testRealmURL}friend.gts`,
      });
      await click('[data-test-module-inspector-view="preview"]');
      assert.dom(`[data-test-card="${testRealmURL}Friend/amy"]`).exists();
      await click(`[data-test-card="${testRealmURL}Friend/bob"]`);

      await waitUntil(() =>
        operatorModeStateService.state?.codePath?.href?.endsWith(
          'Friend/bob.json',
        ),
      );

      assert.strictEqual(
        operatorModeStateService.state?.codePath?.href,
        `${testRealmURL}Friend/bob.json`,
      );
      assert.deepEqual(JSON.parse(getMonacoContent()), {
        data: {
          attributes: {
            name: 'Bob',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}friend`,
              name: 'Friend',
            },
          },
          relationships: {},
        },
      });
    });

    test('clicking a linksToMany field in playground panel opens the linked card JSON', async function (assert) {
      let operatorModeStateService = getService(
        'operator-mode-state-service',
      ) as OperatorModeStateService;

      setPlaygroundSelections({
        [`${testRealmURL}person/Person`]: {
          cardId: `${testRealmURL}Person/with-friends`,
          format: 'isolated',
        },
      });
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/with-friends`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        codePath: `${testRealmURL}person.gts`,
      });
      await click('[data-test-module-inspector-view="preview"]');
      assert
        .dom(`[data-test-card="${testRealmURL}Person/with-friends"]`)
        .exists();

      // Click one of the rendered linked friend cards (linksToMany field)
      await waitFor(`[data-test-card="${testRealmURL}Friend/amy"]`);
      await click(`[data-test-card="${testRealmURL}Friend/amy"]`);

      await waitUntil(() =>
        operatorModeStateService.state?.codePath?.href?.endsWith(
          'Friend/amy.json',
        ),
      );

      assert.strictEqual(
        operatorModeStateService.state?.codePath?.href,
        `${testRealmURL}Friend/amy.json`,
      );
      assert.deepEqual(JSON.parse(getMonacoContent()), {
        data: {
          attributes: {
            name: 'Amy',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}friend`,
              name: 'Friend',
            },
          },
          relationships: {
            friend: {
              links: {
                self: `${testRealmURL}Friend/bob`,
              },
            },
          },
        },
      });
    });

    test('changes cursor position when selected module declaration is changed', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}in-this-file.gts`,
      });

      await waitFor('[data-test-card-inspector-panel]');
      await waitFor('[data-test-current-module-name]');
      await waitFor('[data-test-in-this-file-selector]');
      //default is the last index
      let elementName = 'default (DefaultClass) class';
      assert
        .dom('[data-test-boxel-selector-item]:nth-of-type(11)')
        .hasText(elementName);
      assert
        .dom('[data-test-boxel-selector-item-selected]')
        .hasText(elementName);
      assert.true(
        monacoService.getLineCursorOn()?.includes('DefaultClass'),
        'cursor is on DefaultClass line',
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
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}in-this-file.gts`,
      });

      await waitFor('[data-test-card-inspector-panel]');
      await waitFor('[data-test-current-module-name]');
      await waitFor('[data-test-in-this-file-selector]');
      //default is the last index
      let elementName = 'default (DefaultClass) class';
      assert
        .dom('[data-test-boxel-selector-item]:nth-of-type(11)')
        .hasText(elementName);
      assert
        .dom('[data-test-boxel-selector-item-selected]')
        .hasText(elementName);
      assert.true(monacoService.getLineCursorOn()?.includes('DefaultClass'));

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

    test('the monaco cursor position is maintained during an auto-save', async function (assert) {
      assert.expect(2);
      // we only want to change this for this particular test so we emulate what the non-test env sees
      monacoService.serverEchoDebounceMs = 5000;

      try {
        await visitOperatorMode({
          submode: 'code',
          codePath: `${testRealmURL}in-this-file.gts`,
        })!;

        let originalPosition: MonacoSDK.Position | undefined | null;

        setMonacoContent(`// This is a change \n${inThisFileSource}`);
        monacoService.updateCursorPosition(new MonacoSDK.Position(45, 0));
        originalPosition = monacoService.getCursorPosition();

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
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}employee.gts`,
      });

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
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}employee.gts`,
      });

      await waitFor(`[data-boxel-selector-item-text="Employee"]`);
      await click(`[data-boxel-selector-item-text="Employee"]`);
      assert.true(monacoService.hasFocus);

      await fillIn(
        '[data-test-card-url-bar] input',
        `${testRealmURL}person.gts`,
      );
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
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Pet/mango.json`,
      });

      await waitFor('[data-test-code-mode-card-renderer-body]');

      await scrollTo('[data-test-code-mode-card-renderer-body]', 0, 100);
      await click('[data-test-format-chooser="edit"]');
      await click('[data-test-format-chooser="isolated"]');
      let element = document.querySelector(
        '[data-test-code-mode-card-renderer-body]',
      )!;
      assert.strictEqual(
        element.scrollTop,
        100,
        'the scroll position is correct',
      );
    });

    // TODO: restore in CS-8200
    skip('updates values in preview panel must be represented in editor panel', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/fadhlan.json`,
      });
      await waitFor('[data-test-code-mode-card-renderer-body]');

      await click('[data-test-format-chooser="edit"]');

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
      await click(`[data-test-select="${testRealmURL}Country/united-states"]`);
      await click(`[data-test-card-catalog-go-button]`);

      await waitFor('[data-test-saved]');
      await waitFor('[data-test-save-idle]');
      await settled();

      let content = getMonacoContent();
      await waitUntil(() => content.includes('Ridhwanallah'));
      assert.ok(
        content.includes('Ridhwanallah'),
        'content includes Ridhwanallah',
      );
      assert.ok(
        content.includes('Unknown Address'),
        'content includes Unknown Address',
      );
      assert.ok(content.includes('Bandung'), 'content includes Bandung');
      assert.ok(content.includes('12345'), 'content includes 12345');
      assert.ok(content.includes('1234'), 'content includes 1234');
      assert.ok(
        content.includes(`${testRealmURL}Country/united-states`),
        'content includes Country/united-states',
      );
    });

    test('monaco editor live updates when index changes', async function (assert) {
      await visitOperatorMode({
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
      });
      await waitUntil(() => getMonacoContent().includes('Fadhlan'));

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

      await waitUntil(() => getMonacoContent().includes('FadhlanXXX'));
      assert.true(
        getMonacoContent().includes('FadhlanXXX'),
        'monaco editor updated from index event',
      );
    });

    test('card preview live updates when index changes', async function (assert) {
      await visitOperatorMode({
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
      });
      await waitFor('[data-test-card-resource-loaded]');

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

      await waitUntil(() =>
        document
          .querySelector('[data-test-code-mode-card-renderer-body]')
          ?.textContent?.includes('FadhlanXXX'),
      );
      assert
        .dom('[data-test-code-mode-card-renderer-body]')
        .includesText('FadhlanXXX');
    });

    test('card preview live updates when there is a change in module', async function (assert) {
      const personGts = `
        import { contains, containsMany, field, linksTo, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { Friend } from './friend';
        import { Pet } from "./pet";
        import { Address } from './address';
        import { Trips } from './trips';

        export class Person extends CardDef {
          static displayName = 'Person';
          @field firstName = contains(StringField);
          @field lastName = contains(StringField);
          @field title = contains(StringField, {
            computeVia: function (this: Person) {
              return [this.firstName, this.lastName].filter(Boolean).join(' ');
            },
          });
          @field pet = linksTo(Pet);
          @field friends = linksToMany(Friend);
          @field address = containsMany(StringField);
          @field addressDetail = contains(Address);
          @field trips = contains(Trips);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-person>
                Hello <@fields.firstName />
              </div>
              <style scoped>
                div {
                  color: blue;
                }
              </style>
            </template>
          };
        };
      `;
      const getElementColor = (selector: string) => {
        let element = document.querySelector(selector);
        if (!element) {
          return;
        }
        return window.getComputedStyle(element).color;
      };

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}Person/1.json`,
      });
      await waitFor('[data-test-card-resource-loaded]');
      assert.dom('[data-test-person]').containsText('First name: Hassan');
      assert.strictEqual(
        getElementColor('[data-test-person]'),
        'rgb(0, 128, 0)',
      );

      await realm.write('person.gts', personGts);

      await waitUntil(
        () =>
          document
            .querySelector('[data-test-person]')
            ?.textContent?.includes('Hello'),
        { timeout: 5_000 },
      );

      assert.dom('[data-test-person]').includesText('Hello Hassan');
      assert.strictEqual(
        getElementColor('[data-test-person]'),
        'rgb(0, 0, 255)',
      );

      await click('[data-test-file-browser-toggle]');
      await click('[data-test-file="Person/1.json"]');
      assert.dom('[data-test-person]').includesText('Hello Hassan');
      assert.strictEqual(
        getElementColor('[data-test-person]'),
        'rgb(0, 0, 255)',
      );
    });

    test('card preview live updates with error', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/fadhlan.json`,
      });
      await waitFor('[data-test-card-resource-loaded]');
      assert
        .dom('[data-test-card-error]')
        .doesNotExist('card error state is not displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            relationships: {
              'friends.0': {
                links: { self: './missing' },
              },
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

      await waitFor('[data-test-card-error]');
      assert
        .dom('[data-test-card-error]')
        .exists('card error state is displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            relationships: {
              'friends.0': {
                links: { self: null },
              },
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

      await waitFor('[data-test-card-error]', { count: 0 });
      assert
        .dom('[data-test-card-error]')
        .doesNotExist('card error state is not displayed');
    });

    test('card-catalog does not offer to "create new card" when editing linked fields in code mode', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/fadhlan.json`,
      })!;
      await waitFor('[data-test-card-resource-loaded]');
      assert
        .dom(
          `[data-test-code-mode-card-renderer-header="${testRealmURL}Person/fadhlan"]`,
        )
        .exists();

      await click('[data-test-format-chooser="edit"]');

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

    test('closes the top-most modal first when clicking overlay background', async function (assert) {
      await visitOperatorMode({
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
      });

      await waitFor('[data-test-code-mode][data-test-save-idle]');
      await waitFor('[data-test-new-file-button]');
      await click('[data-test-new-file-button]');
      await click(`[data-test-boxel-menu-item-text="Card Instance"]`);
      await waitFor(`[data-test-create-file-modal][data-test-ready]`);

      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-catalog-modal]');
      await percySnapshot(assert);
      let cardCatalogModalOverlay = document.querySelector(
        '[data-test-card-catalog-modal]',
      )?.previousElementSibling;
      assert.dom(cardCatalogModalOverlay).exists();
      await click(cardCatalogModalOverlay!);
      assert.dom('[data-test-card-catalog-modal]').doesNotExist();

      let createFileModalOverlay = document.querySelector(
        '[data-test-create-file-modal]',
      )?.previousElementSibling;
      assert.dom(createFileModalOverlay).exists();
      await click(createFileModalOverlay!);
      assert.dom('[data-test-create-file-modal]').doesNotExist();
    });

    test('restores and remembers module inspector view from operator mode state', async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}pet.gts`,
        moduleInspector: 'preview',
      });

      assert.dom('[data-test-active-module-inspector-view="preview"]').exists();

      assert.strictEqual(
        window.localStorage.getItem(ModuleInspectorSelections),
        JSON.stringify({
          [`${testRealmURL}pet.gts`]: 'preview',
        }),
      );
    });

    test('remembers open module inspector panel via local storage', async function (assert) {
      let accordionSelections = {
        [`${testRealmURL}address.gts`]: 'spec',
        [`${testRealmURL}country.gts`]: null,
        [`${testRealmURL}person.gts`]: 'schema',
        [`${testRealmURL}pet-person.gts`]: 'preview',
      };
      window.localStorage.setItem(
        ModuleInspectorSelections,
        JSON.stringify(accordionSelections),
      );

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}pet.gts`,
      });

      assert
        .dom('[data-test-active-module-inspector-view="schema"]')
        .exists('defaults to schema-editor view');

      await click('[data-test-module-inspector-view="preview"]');
      assert.dom('[data-test-active-module-inspector-view="preview"]').exists();

      await click('[data-test-file-browser-toggle]');
      await click('[data-test-file="address.gts"]');
      assert.dom('[data-test-active-module-inspector-view="spec"]').exists();

      await click('[data-test-file="country.gts"]');
      assert.dom('[data-test-module-inspector="card-or-field"]').exists();
      assert.dom('[data-test-active-module-inspector-view="schema"]').exists();

      await click('[data-test-file="person.gts"]');
      assert.dom('[data-test-active-module-inspector-view="schema"]').exists();

      await click('[data-test-file="pet-person.gts"]');
      assert.dom('[data-test-active-module-inspector-view="preview"]').exists();

      await click('[data-test-module-inspector-view="spec"]');
      assert.dom('[data-test-active-module-inspector-view="spec"]').exists();

      let currentSelections = window.localStorage.getItem(
        ModuleInspectorSelections,
      );
      assert.strictEqual(
        currentSelections,
        JSON.stringify({
          [`${testRealmURL}address.gts`]: 'spec',
          [`${testRealmURL}country.gts`]: 'schema',
          [`${testRealmURL}person.gts`]: 'schema',
          [`${testRealmURL}pet-person.gts`]: 'spec',
          [`${testRealmURL}pet.gts`]: 'preview',
        }),
      );
    });

    test('module inspector query parameter takes precendence over local storage when loading', async function (assert) {
      window.localStorage.setItem(
        ModuleInspectorSelections,
        JSON.stringify({
          [`${testRealmURL}address.gts`]: 'spec',
        }),
      );

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}address.gts`,
        moduleInspector: 'preview',
      });

      assert.dom('[data-test-active-module-inspector-view="preview"]').exists();
    });

    test('Open in Interact and Edit Template buttons work correctly', async function (assert) {
      await visitOperatorMode({
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
      });

      await waitFor('[data-test-card-resource-loaded]');

      // Verify the buttons are rendered
      assert
        .dom('[data-test-edit-template-button]')
        .exists('Edit Template button is rendered');
      assert
        .dom('[data-test-open-in-interact-button]')
        .exists('Open in Interact button is rendered');
      assert
        .dom('.preview-text')
        .hasText('Preview', 'Preview text is displayed');

      // Test Open in Interact button
      await click('[data-test-open-in-interact-button]');

      // Verify that we're now in interact mode with the card
      await waitFor('[data-test-interact-submode]');
      assert
        .dom('[data-test-interact-submode]')
        .exists('Switched to interact mode');

      // Verify the card is displayed in interact mode
      assert.dom('[data-test-person]').includesText('Fadhlan');

      // Back to code mode
      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Code"]');
      await waitFor('[data-test-code-submode]');

      // Test Edit Template button
      await click('[data-test-edit-template-button]');

      // Verify that the code path was updated to the template file
      await waitFor('[data-test-card-url-bar-input]');
      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(`${testRealmURL}person.gts`);
    });
  });
});
