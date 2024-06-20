import { setupApplicationTest } from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import RealmInfoService from '@cardstack/host/services/realm-info-service';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupServerSentEvents,
  lookupLoaderService,
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

module('Integration | realm info service tests', function (hooks) {
  let realmInfoService: RealmInfoService;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);
  setupMatrixServiceMock(hooks);

  hooks.beforeEach(async function () {
    realmInfoService = this.owner.lookup(
      'service:realm-info-service',
    ) as RealmInfoService;

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    await setupAcceptanceTestRealm({
      contents: {
        'index.gts': indexCardSource,
        'person.gts': personCardSource,
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
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
  });

  test('ensures fetch for the same realm info occurs only once', async function (assert) {
    let totalRealmInfoRequest = 0;
    lookupLoaderService().virtualNetwork.mount(
      async (req) => {
        if (req.method === 'GET' && req.url === `${testRealmURL}_info`) {
          totalRealmInfoRequest++;
        }

        return null;
      },
      { prepend: true },
    );
    await Promise.all([
      realmInfoService.fetchRealmInfo({ realmURL: new URL(testRealmURL) }),
      realmInfoService.fetchRealmInfo({ realmURL: new URL(testRealmURL) }),
      realmInfoService.fetchRealmInfo({ realmURL: new URL(testRealmURL) }),
    ]);
    assert.strictEqual(totalRealmInfoRequest, 1);
  });
});
