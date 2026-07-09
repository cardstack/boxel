import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Query, rri } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  SearchCardsByQueryCommand,
  SearchCardsByTypeAndTitleCommand,
} from '@cardstack/host/tools/search-cards';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
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
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  function runTypeTitleSearch(input: {
    cardType: string | undefined;
    cardTitle: string | undefined;
  }) {
    let commandService = getService('command-service');
    let searchCommand = new SearchCardsByTypeAndTitleCommand(
      commandService.commandContext,
    );
    return searchCommand.execute(input);
  }

  function runQuerySearch(query: Query) {
    let commandService = getService('command-service');
    let searchCommand = new SearchCardsByQueryCommand(
      commandService.commandContext,
    );
    return searchCommand.execute({ query });
  }

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
      @field bio = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Author) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
    }
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'author.gts': { Author },
          'Author/r2.json': new Author({
            firstName: 'R2-D2',
            bio: 'Astromech droid who communicates in beeps and whistles.',
          }),
          'Author/mark.json': new Author({
            firstName: 'Mark',
            lastName: 'Jackson',
            bio: 'Novelist specializing in xylophone-themed mystery fiction.',
          }),
          'realm.json': realmConfigCardJSON({
            name: realmName,
            iconURL: 'https://boxel-images.boxel.ai/icons/Letter-o.png',
          }),
        },
      });
    });
  });

  test('search for a title', async function (assert) {
    let result = await runTypeTitleSearch({
      cardTitle: 'Mark Jackson',
      cardType: undefined,
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/mark');
  });

  test('search for a card type', async function (assert) {
    let result = await runTypeTitleSearch({
      cardType: 'Author',
      cardTitle: undefined,
    });
    assert.ok(result.cardIds.length > 0, 'Should return at least one result');
    assert.ok(
      result.cardIds.every((id) => id.includes('Author')),
      'All results should be Author cards',
    );
  });

  test('search with a query', async function (assert) {
    let result = await runQuerySearch({
      filter: {
        eq: { firstName: 'R2-D2' },
        on: {
          module: rri('http://test-realm/test/author'),
          name: 'Author',
        },
      },
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/r2');
  });

  test('search with a matches filter', async function (assert) {
    let result = await runQuerySearch({
      filter: { matches: 'xylophone' },
    });
    assert.strictEqual(
      result.cardIds.length,
      1,
      'only mark.json has "xylophone" in its markdown',
    );
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/mark');
  });

  test('search with matches composed inside every + eq', async function (assert) {
    let result = await runQuerySearch({
      filter: {
        on: {
          module: rri('http://test-realm/test/author'),
          name: 'Author',
        },
        every: [{ matches: 'droid' }, { eq: { firstName: 'R2-D2' } }],
      },
    });
    assert.strictEqual(
      result.cardIds.length,
      1,
      'composed matches + eq returns r2.json',
    );
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/r2');
  });
});
