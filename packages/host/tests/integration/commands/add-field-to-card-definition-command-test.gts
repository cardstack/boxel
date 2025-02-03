import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import AddFieldToCardDefinitionCommand from '@cardstack/host/commands/add-field-to-card-definition';
import CardService from '@cardstack/host/services/card-service';
import type CommandService from '@cardstack/host/services/command-service';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupLoaderService,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

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
    });

    hooks.beforeEach(async function () {
      await setupIntegrationTestRealm({
        loader,
        contents: {
          'person.gts': `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
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
          import StringField from "https://cardstack.com/base/string";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
            @field lastName = contains(StringField);
          }
        `,
        'lastName field was added to the card definition',
      );
    });

    test('can add a computed field', async function (assert) {
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
        fieldName: 'rapName',
        fieldDefinitionType: 'field',
        fieldType: 'contains',
        fieldRef: {
          module: 'https://cardstack.com/base/string',
          name: 'default',
        },
        incomingRelativeTo: undefined,
        outgoingRelativeTo: undefined,
        outgoingRealmURL: undefined,
        computedFieldFunctionSourceCode: `
          function () {
            let prefix = this.firstName.length > 5 ? 'Big' : 'Lil';
            let nickname = this.firstName.toUpperCase();
            return \`\${prefix} \${nickname}\`;
          }`,
      });

      let response = await cardService.getSource(
        new URL('person.gts', testRealmURL),
      );
      assert.strictEqual(
        response,
        `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
            @field rapName = contains(StringField, {
              computeVia: function () {
                let prefix = this.firstName.length > 5 ? 'Big' : 'Lil';
                let nickname = this.firstName.toUpperCase();
                return \`\${prefix} \${nickname}\`;
              }
            });
          }
        `,
        'computed field was added to the card definition',
      );
    });
  },
);
