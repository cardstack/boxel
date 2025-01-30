import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import WriteTextFileCommand from '@cardstack/host/commands/write-text-file';
import type CommandService from '@cardstack/host/services/command-service';
import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupLoaderService,
  lookupNetworkService,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupRenderingTest } from '../../helpers/setup';
import AddFieldToCardDefinitionCommand from '@cardstack/host/commands/add-field-to-card-definition';
import {
  CardDef,
  StringField,
  contains,
  field,
} from '../../helpers/base-realm';
import CardService from '@cardstack/host/services/card-service';

let loader: Loader;
let fetch: NetworkService['fetch'];

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module(
  'Integration | commands | add-field-to-card-definition',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);

    hooks.beforeEach(function (this: RenderingTestContext) {
      getOwner(this)!.register('service:realm', StubRealmService);
      loader = lookupLoaderService().loader;
      fetch = lookupNetworkService().fetch;
    });

    hooks.beforeEach(async function () {
      await setupIntegrationTestRealm({
        loader,
        contents: {
          'person.gts': `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringCard);
          }
        `,
        },
        realmURL: 'http://test-realm/test/',
      });
    });

    test('adds a field to a card definition', async function (assert) {
      let commandService = lookupService<CommandService>('command-service');
      let cardService = lookupService<CardService>('card-service');
      let addFieldToCardDefinitionCommand = new AddFieldToCardDefinitionCommand(
        commandService.commandContext,
      );

      await addFieldToCardDefinitionCommand.execute({
        cardDefinitionToModify: {
          module: 'http://test-realm/test/person',
          name: 'Person',
        },
        fieldName: 'lastName',
        fieldDefinitionType: 'field',
        fieldRef: {
          module: 'https://cardstack.com/base/string',
          name: 'default',
        },
        fieldType: 'contains',
      });
      let response = await cardService.getSource(
        new URL('person.gts', testRealmURL),
      );
      assert.strictEqual(
        response,
        `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringCard);
            @field lastName = field(StringCard);
          }
        `,
        'lastName field was added to the card definition',
      );
    });
  },
);
