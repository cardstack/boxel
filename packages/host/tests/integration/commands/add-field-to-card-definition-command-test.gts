import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import AddFieldToCardDefinitionCommand from '@cardstack/host/commands/add-field-to-card-definition';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

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

    let mockMatrixUtils = setupMockMatrix(hooks);
    let snapshot = setupSnapshotRealm(hooks, {
      mockMatrixUtils,
      async build({ loader }) {
        let loaderService = getService('loader-service');
        loaderService.loader = loader;
        await setupIntegrationTestRealm({
          mockMatrixUtils,
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
          realmURL: testRealmURL,
          loader,
        });
        return {};
      },
    });

    hooks.beforeEach(function (this: RenderingTestContext) {
      getOwner(this)!.register('service:realm', StubRealmService);
    });

    hooks.beforeEach(function () {
      snapshot.get();
    });

    test('adds a field to a card definition', async function (assert) {
      let commandService = getService('command-service');
      let cardService = getService('card-service');
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
      let response = (
        await cardService.getSource(new URL('person.gts', testRealmURL))
      ).content;
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
      let commandService = getService('command-service');
      let cardService = getService('card-service');
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

      let response = (
        await cardService.getSource(new URL('person.gts', testRealmURL))
      ).content;
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
