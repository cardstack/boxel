import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SearchAndChooseCommand from '@cardstack/host/commands/search-and-choose';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
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

module('Integration | commands | search-and-choose', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let capturedMessages: Array<{ role: string; content: string }> | undefined =
    undefined;

  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        const body = await req.json();

        if (body.url === 'https://openrouter.ai/api/v1/chat/completions') {
          capturedMessages = JSON.parse(body.requestBody).messages;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify([`${testRealmURL}Choice/alpha`]),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  ]);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    capturedMessages = undefined;
  });

  let searchAndChooseCommand: SearchAndChooseCommand;
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    const choiceSource = `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

// choice-source-marker
export class Choice extends CardDef {
  static displayName = 'Choice';
  @field cardTitle = contains(StringField);
}`;
    const contextSource = `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

// context-source-marker
export class ContextCard extends CardDef {
  static displayName = 'ContextCard';
  @field cardTitle = contains(StringField);
}`;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'choice.gts': choiceSource,
          'context-card.gts': contextSource,
          'Choice/alpha.json': {
            data: {
              type: 'card',
              attributes: {
                cardTitle: 'Alpha choice',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}choice.gts`,
                  name: 'Choice',
                },
              },
            },
          },
          'Choice/beta.json': {
            data: {
              type: 'card',
              attributes: {
                cardTitle: 'Beta choice',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}choice.gts`,
                  name: 'Choice',
                },
              },
            },
          },
        },
      }),
    );

    const commandService = getService('command-service');
    searchAndChooseCommand = new SearchAndChooseCommand(
      commandService.commandContext,
    );
  });

  test('uses sourceContextCodeRef source instead of the searched type source', async function (assert) {
    let result = await searchAndChooseCommand.execute({
      candidateTypeCodeRef: {
        module: `${testRealmURL}choice.gts`,
        name: 'Choice',
      },
      sourceContextCodeRef: {
        module: `${testRealmURL}context-card.gts`,
        name: 'ContextCard',
      },
      max: 1,
      additionalSystemPrompt: 'Pick the best matching option.',
    });

    assert.deepEqual(result.selectedIds, [`${testRealmURL}Choice/alpha`]);
    assert.strictEqual(
      result.selectedCards[0]?.id,
      `${testRealmURL}Choice/alpha`,
    );

    let userMessage =
      capturedMessages?.find((message) => message.role === 'user')?.content ??
      '';
    assert.true(
      userMessage.includes('context-source-marker'),
      'LLM request includes the context module source',
    );
    assert.false(
      userMessage.includes('choice-source-marker'),
      'LLM request does not include the searched type source',
    );
  });
});
