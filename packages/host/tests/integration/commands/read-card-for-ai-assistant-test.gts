import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common';

import ReadCardForAiAssistantCommand from '@cardstack/host/commands/read-card-for-ai-assistant';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
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

module('Integration | commands | read-card-for-ai-assistant', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': `
            import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            import NumberField from "https://cardstack.com/base/number";

            export class Person extends CardDef {
              @field firstName = contains(StringField);
              @field hourlyRate = contains(NumberField);
              @field title = contains(StringField, {
                computeVia: function (this: Person) {
                  return this.firstName;
                },
              });
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
                </template>
              }
              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <h1> Embedded Card Person: <@fields.firstName/></h1>

                  <style scoped>
                    h1 { color: red }
                  </style>
                </template>
              }
              static fitted = class Fitted extends Component<typeof this> {
                <template>
                  <h1> Fitted Card Person: <@fields.firstName/></h1>

                  <style scoped>
                    h1 { color: red }
                  </style>
                </template>
              }
            }
          `,
        'mango.json': {
          data: {
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: './person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
  });

  test('read card', async function (assert) {
    let commandService = getService('command-service');

    let command = new ReadCardForAiAssistantCommand(
      commandService.commandContext,
    );
    let result = await command.execute({
      cardId: `${testRealmURL}mango`,
    });
    assert.true(!!result.cardForAttachment.contentHash);
    assert.strictEqual(
      result.cardForAttachment.contentType,
      SupportedMimeType.CardJson,
    );
    assert.strictEqual(result.cardForAttachment.name, 'Mango');
    assert.strictEqual(
      result.cardForAttachment.sourceUrl,
      `${testRealmURL}mango`,
    );
    assert.true(!!result.cardForAttachment.url);
  });
});
