import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  SearchCardsByQueryCommand,
  SearchCardsByTypeAndTitleCommand,
} from '@cardstack/host/commands/search-cards';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import {
  StringField,
  NumberField,
  field,
  contains,
  CardDef,
  Component,
  FieldDef,
  containsMany,
  linksTo,
  linksToMany,
} from '../../helpers/base-realm';

module('Integration | commands | search', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Operator Mode Workspace';
  let loader: Loader;

  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () =>
      await getService('loader-service').loader.import(
        `${baseRealm.url}card-api`,
      ),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      class CustomAuthor extends CardDef {
        static displayName = 'CustomAuthor';
        @field firstName = contains(StringField);
        @field lastName = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: CustomAuthor) {
            return [this.firstName, this.lastName].filter(Boolean).join(' ');
          },
        });
      }
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'custom-author.gts': { CustomAuthor },
          'CustomAuthor/r2.json': new CustomAuthor({ firstName: 'R2-D2' }),
          'CustomAuthor/mark.json': new CustomAuthor({
            firstName: 'Mark',
            lastName: 'Jackson',
          }),
          '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-o.png" }`,
        },
        loader,
      });
      return {};
    },
  });

  test('search for a title', async function (assert) {
    let commandService = getService('command-service');
    let searchCommand = new SearchCardsByTypeAndTitleCommand(
      commandService.commandContext,
    );
    let result = await searchCommand.execute({
      title: 'Mark Jackson',
      cardType: undefined,
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(
      result.cardIds[0],
      'http://test-realm/test/CustomAuthor/mark',
    );
  });

  test('search for a card type', async function (assert) {
    let commandService = getService('command-service');
    let searchCommand = new SearchCardsByTypeAndTitleCommand(
      commandService.commandContext,
    );
    let result = await searchCommand.execute({
      cardType: 'CustomAuthor',
      title: undefined,
    });
    assert.ok(result.cardIds.length > 0, 'Should return at least one result');
    assert.ok(
      result.cardIds.every((id) => id.includes('CustomAuthor')),
      'All results should be Custom Author cards',
    );
  });

  test('search with a query', async function (assert) {
    let commandService = getService('command-service');
    let searchCommand = new SearchCardsByQueryCommand(
      commandService.commandContext,
    );
    let result = await searchCommand.execute({
      query: {
        filter: {
          eq: { firstName: 'R2-D2' },
          on: {
            module: 'http://test-realm/test/custom-author',
            name: 'CustomAuthor',
          },
        },
      },
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(
      result.cardIds[0],
      'http://test-realm/test/CustomAuthor/r2',
    );
  });
});
