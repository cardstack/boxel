import { waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Deferred, baseRealm, type Realm } from '@cardstack/runtime-common';

import type { RealmEventContent } from '@cardstack/base/matrix-event';

import {
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | file def', function (hooks) {
  let realm: Realm;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  let waitForRealmEvent = (matches: (event: RealmEventContent) => boolean) => {
    let realmEventDeferred = new Deferred<RealmEventContent>();
    let messageService = getService('message-service');
    let unsubscribe = messageService.subscribe(
      testRealmURL,
      (event: RealmEventContent) => {
        if (!matches(event)) {
          return;
        }
        unsubscribe();
        realmEventDeferred.fulfill(event);
      },
    );
    return realmEventDeferred;
  };

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    let string: typeof import('@cardstack/base/string');
    let markdown: typeof import('@cardstack/base/markdown');
    let markdownFileDef: typeof import('@cardstack/base/markdown-file-def');
    let skillModule: typeof import('@cardstack/base/skill');

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    markdown = await loader.import(`${baseRealm.url}markdown`);
    markdownFileDef = await loader.import(`${baseRealm.url}markdown-file-def`);
    skillModule = await loader.import(`${baseRealm.url}skill`);

    let { field, contains, linksTo, Component, CardDef } = cardApi;
    let { default: StringField } = string;
    let { default: MarkdownField } = markdown;
    let { MarkdownDef } = markdownFileDef;
    let { Skill } = skillModule;

    class SkillPlusMarkdown extends Skill {
      static displayName = 'Skill Plus';

      @field instructionsSource = linksTo(MarkdownDef);
      @field instructions = contains(MarkdownField, {
        computeVia: function (this: SkillPlusMarkdown) {
          return this.instructionsSource?.content;
        },
      });
      @field cardTitle = contains(StringField, {
        computeVia: function (this: SkillPlusMarkdown) {
          return this.instructionsSource?.title ?? 'Untitled Skill Plus';
        },
      });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <section>
            <h2 data-test-skill-plus-title><@fields.cardTitle /></h2>
            <div data-test-skill-plus-instructions><@fields.instructions
              /></div>
          </section>
        </template>
      };
    }

    class PlainCard extends CardDef {
      static displayName = 'Plain Card';

      @field title = contains(StringField);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-plain-card-title><@fields.title /></h2>
        </template>
      };
    }

    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'plain-card.gts': { PlainCard },
        'skill-plus-markdown.gts': { SkillPlusMarkdown },
        'PlainCard/example.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Before',
            },
            meta: {
              adoptsFrom: {
                module: '../plain-card',
                name: 'PlainCard',
              },
            },
          },
        },
        'Skill/env-indexing-operations.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: {
                name: null,
                summary: null,
                cardThumbnailURL: null,
                notes: null,
              },
            },
            relationships: {
              instructionsSource: {
                links: {
                  self: './env-indexing-operations.md',
                },
                data: {
                  type: 'file-meta',
                  id: './env-indexing-operations.md',
                },
              },
              'cardInfo.theme': {
                links: {
                  self: null,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../skill-plus-markdown',
                name: 'SkillPlusMarkdown',
              },
            },
          },
        },
        'Skill/env-indexing-operations.md': `# Initial instructions

Initial paragraph.`,
        'Skill/boxel-environment.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: {
                name: 'Boxel environment',
                summary: null,
                cardThumbnailURL: null,
                notes: null,
              },
            },
            meta: {
              adoptsFrom: {
                module: '../skill-plus-markdown',
                name: 'SkillPlusMarkdown',
              },
            },
          },
        },
      },
    }));
  });

  test('a rendered instance live updates after a linked markdown file invalidation', async function (assert) {
    let skillCardURL = `${testRealmURL}Skill/env-indexing-operations`;
    let markdownURL = `${testRealmURL}Skill/env-indexing-operations.md`;

    await visitOperatorMode({
      stacks: [[{ id: skillCardURL, format: 'isolated' }]],
    });

    await waitFor('[data-test-skill-plus-title]');
    assert
      .dom('[data-test-skill-plus-title]')
      .hasText('Initial instructions', 'initial title comes from markdown');
    assert
      .dom('[data-test-skill-plus-instructions]')
      .includesText(
        'Initial paragraph.',
        'initial instructions come from markdown',
      );

    let realmEventDeferred = waitForRealmEvent(
      (event) =>
        event.eventName === 'index' &&
        event.indexType === 'incremental' &&
        Array.isArray(
          (event as RealmEventContent & { invalidations?: string[] })
            .invalidations,
        ) &&
        (
          event as RealmEventContent & { invalidations: string[] }
        ).invalidations.includes(markdownURL),
    );

    await realm.write(
      'Skill/env-indexing-operations.md',
      `# Updated instructions

Updated paragraph.`,
    );

    let event = (await realmEventDeferred.promise) as RealmEventContent & {
      invalidations: string[];
    };
    assert.true(
      event.invalidations.includes(markdownURL),
      'realm event invalidates the markdown file',
    );
    assert.true(
      event.invalidations.includes(skillCardURL),
      'realm event invalidates the rendered skill instance',
    );

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-skill-plus-title]')
          ?.textContent?.includes('Updated instructions'),
      {
        timeout: 5000,
        timeoutMessage:
          'rendered instance did not live update after linked file invalidation',
      },
    );

    assert
      .dom('[data-test-skill-plus-title]')
      .hasText('Updated instructions', 'title live updates from markdown');
    assert
      .dom('[data-test-skill-plus-instructions]')
      .includesText(
        'Updated paragraph.',
        'instructions live update from markdown',
      );
  });

  test('a rendered card still reloads when its source file is loaded as file-meta', async function (assert) {
    let cardURL = `${testRealmURL}PlainCard/example`;
    let sourceURL = `${cardURL}.json`;
    let store = getService('store');

    await visitOperatorMode({
      stacks: [[{ id: cardURL, format: 'isolated' }]],
    });

    await waitFor('[data-test-plain-card-title]');
    assert
      .dom('[data-test-plain-card-title]')
      .hasText('Before', 'initial card content is rendered');

    await store.get(sourceURL, { type: 'file-meta' });

    let realmEventDeferred = waitForRealmEvent(
      (event) =>
        event.eventName === 'index' &&
        event.indexType === 'incremental' &&
        Array.isArray(
          (event as RealmEventContent & { invalidations?: string[] })
            .invalidations,
        ) &&
        (
          event as RealmEventContent & { invalidations: string[] }
        ).invalidations.includes(cardURL),
    );

    await realm.write(
      'PlainCard/example.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'After',
          },
          meta: {
            adoptsFrom: {
              module: '../plain-card',
              name: 'PlainCard',
            },
          },
        },
      }),
    );

    let event = (await realmEventDeferred.promise) as RealmEventContent & {
      invalidations: string[];
    };
    assert.true(
      event.invalidations.includes(cardURL),
      'realm event invalidates the rendered card instance',
    );

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-plain-card-title]')
          ?.textContent?.includes('After'),
      {
        timeout: 5000,
        timeoutMessage:
          'rendered card did not live update after card invalidation',
      },
    );

    assert
      .dom('[data-test-plain-card-title]')
      .hasText(
        'After',
        'card still live updates when its source file is loaded',
      );
  });
});
