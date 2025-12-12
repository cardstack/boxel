import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { GenerateExampleCardsOneShotCommand } from '@cardstack/host/commands/generate-example-cards';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmURL,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module(
  'Integration | Command | generate-example-cards (one-shot)',
  function (hooks) {
    setupRenderingTest(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });
    let snapshot = setupSnapshotRealm(hooks, {
      mockMatrixUtils,
      async build({ loader }) {
        let loaderService = getService('loader-service');
        loaderService.loader = loader;
        await setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'test-card.gts': `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TestCard extends CardDef {
  static displayName = 'Test Card';
  @field title = contains(StringField);
  @field description = contains(StringField);
}`,
          },
          loader,
        });
        const commandService = getService('command-service');
        return {
          generateExampleCommand: new GenerateExampleCardsOneShotCommand(
            commandService.commandContext,
          ),
        };
      },
    });

    let llmResponseContent = JSON.stringify({
      attributes: {
        title: 'Generated Title',
        description: 'Generated description from LLM',
      },
    });

    setupRealmServerEndpoints(hooks, [
      {
        route: '_request-forward',
        getResponse: async (req: Request) => {
          const body = await req.json();
          if (body.url === 'https://openrouter.ai/api/v1/chat/completions') {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: llmResponseContent,
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

    let generateExampleCommand: InstanceType<
      typeof GenerateExampleCardsOneShotCommand
    >;

    hooks.beforeEach(function () {
      ({ generateExampleCommand } = snapshot.get());
    });

    test('creates a new card instance from LLM output', async function (assert) {
      const result = await generateExampleCommand.execute({
        codeRef: {
          module: `${testRealmURL}test-card.gts`,
          name: 'TestCard',
        },
        realm: testRealmURL,
      });

      assert.ok(result.createdCard, 'returns created card in result');

      const createdCard = result.createdCard!;

      const cardService = getService('card-service');
      const serialized = await cardService.serializeCard(createdCard);

      assert.strictEqual(
        serialized.data.attributes?.title,
        'Generated Title',
        'created card adopts title from LLM payload',
      );
      assert.strictEqual(
        serialized.data.attributes?.description,
        'Generated description from LLM',
        'created card adopts description from LLM payload',
      );
    });
  },
);
