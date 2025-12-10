import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

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
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | search', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Operator Mode Workspace';
  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Author) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'author.gts': { Author },
        'Author/r2.json': new Author({ firstName: 'R2-D2' }),
        'Author/mark.json': new Author({
          firstName: 'Mark',
          lastName: 'Jackson',
        }),
        '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-o.png" }`,
      },
    });
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
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/mark');
  });

  test('search for a card type', async function (assert) {
    let commandService = getService('command-service');
    let searchCommand = new SearchCardsByTypeAndTitleCommand(
      commandService.commandContext,
    );
    let result = await searchCommand.execute({
      cardType: 'Author',
      title: undefined,
    });
    assert.ok(result.cardIds.length > 0, 'Should return at least one result');
    assert.ok(
      result.cardIds.every((id) => id.includes('Author')),
      'All results should be Author cards',
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
          on: { module: 'http://test-realm/test/author', name: 'Author' },
        },
      },
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/r2');
  });
});
