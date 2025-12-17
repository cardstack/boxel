import { getOwner } from '@ember/owner';
import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import ApplyMarkdownEditCommand from '@cardstack/host/commands/apply-markdown-edit';
import RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  testRealmInfo,
  setupRealmServerEndpoints,
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

module('Integration | commands | apply-markdown-edit', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Markdown Editing Test Realm';

  let loader: Loader;
  let forwardRequests: any[] = [];
  let parsedRequestBodies: any[] = [];
  let nextResponseContent = '';

  const post1Segment1 = [
    '# Intro paragraph',
    '## Section one',
    '- first item',
    '- second item',
  ].join('\n');
  const post1Focus = 'Original block with tags.';
  const post1Segment2 = [
    '> A quoted thought',
    'Closing section with **bold** note.',
  ].join('\n');
  const post1 = [post1Segment1, post1Focus, post1Segment2].join('\n');

  const post2Focus =
    '<h2 id="introduction">Introduction</h2>\n\nRemote work has revolutionized the traditional workplace, offering flexibility and autonomy like never before. Whether you\'re a freelancer, an entrepreneur, or part of a company embracing flexible work arrangements, understanding how to make the most of remote work is crucial for success.';
  const post2Unchanged =
    "<h2 id='benefits-of-remote-work'>Benefits of Remote Work</h2>\n\n### Flexibility\n\nOne of the most significant advantages of remote work is the ability to **work from anywhere**. Whether you prefer the comfort of your home, a bustling coffee shop, or a serene beach, the choice is yours.";
  const post2 = [post2Focus, post2Unchanged].join('\n\n');

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
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

  let command: ApplyMarkdownEditCommand;

  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        let body = await req.json();
        forwardRequests.push(body);
        parsedRequestBodies.push(JSON.parse(body.requestBody));

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: nextResponseContent } }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
  ]);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    forwardRequests = [];
    parsedRequestBodies = [];

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'article.gts': `
          import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
          import MarkdownField from "https://cardstack.com/base/markdown";

          export class Article extends CardDef {
            static displayName = 'Article';
            @field intro = contains(MarkdownField);
            @field body = contains(MarkdownField);
          }
        `,
        'Article/ambiguous.json': {
          data: {
            type: 'card',
            attributes: {
              body: 'Repeat me.\n\nRepeat me.\n\nKeep me.',
            },
            meta: {
              adoptsFrom: {
                module: '../article',
                name: 'Article',
              },
            },
          },
        },
        'Article/1.json': {
          data: {
            type: 'card',
            attributes: { body: post1 },
            meta: {
              adoptsFrom: {
                module: '../article',
                name: 'Article',
              },
            },
          },
        },
        'Article/2.json': {
          data: {
            type: 'card',
            attributes: { intro: post2 },
            meta: {
              adoptsFrom: {
                module: '../article',
                name: 'Article',
              },
            },
          },
        },
        '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-m.png" }`,
      },
    });

    command = new ApplyMarkdownEditCommand(
      getService('command-service').commandContext,
    );
  });

  test('can apply requested content change', async function (assert) {
    assert.expect(5);
    let store = getService('store');
    nextResponseContent =
      "<h2 id=\"introduction\">Introduction</h2>\n\nThe walls of the traditional office are crumbling. Across continents and time zones, a quiet revolution is reshaping the very fabric of how we work, live, and thrive. Remote work isn't just a trend—it's a fundamental shift in human potential, liberating millions from the constraints of cubicles and commutes. Whether you're a bold freelancer carving your own path, an entrepreneur building dreams from your kitchen table, or part of a forward-thinking company embracing the future, mastering the art of remote work isn't just beneficial—it's essential for survival and success in this brave new world of work.";

    await command.execute({
      cardId: `${testRealmURL}Article/2`,
      fieldPath: 'intro',
      markdownDiff: nextResponseContent,
      currentContent: post2Focus,
      instructions:
        'Make the introduction more dramatic and compelling with stronger language and vivid imagery',
    });

    await settled();

    assert.strictEqual(
      forwardRequests.length,
      1,
      'forwards the request to the proxy with provided diff/instructions',
    );
    assert.strictEqual(
      parsedRequestBodies[0].model,
      'relace/relace-apply-3',
      'uses the relace apply model',
    );

    let messageContent = parsedRequestBodies[0].messages[0].content as string;
    let instructionContent =
      messageContent.match(/<instruction>([\s\S]*?)<\/instruction>/)?.[1] ?? '';
    let updateContent =
      messageContent.match(/<update>([\s\S]*?)<\/update>/)?.[1] ?? '';
    assert.ok(
      updateContent.includes(
        'liberating millions from the constraints of cubicles and commutes',
      ),
      'prompt includes the updated markdown diff content',
    );
    assert.ok(
      instructionContent.includes(
        'Make the introduction more dramatic and compelling',
      ),
      'instructions are sent in the <instruction> tag',
    );

    let card = (await store.get(
      `${testRealmURL}Article/2`,
    )) as unknown as CardDef & { body: string; intro: string };

    assert.strictEqual(
      card.intro,
      [nextResponseContent, post2Unchanged].join('\n\n'),
      'card is updated with model response when request succeeds',
    );
  });

  test('throws when focused content matches multiple occurrences', async function (assert) {
    assert.expect(2);

    try {
      await command.execute({
        cardId: `${testRealmURL}Article/ambiguous`,
        fieldPath: 'body',
        markdownDiff: '- Repeat me.\n+ Replace this',
        currentContent: 'Repeat me.',
        instructions: 'Update only the selected section',
      });
      assert.ok(false, 'command should have thrown');
    } catch (err: any) {
      assert.ok(
        err?.message?.includes('matches multiple places'),
        'errors when focused content is ambiguous',
      );
    }

    assert.strictEqual(
      forwardRequests.length,
      0,
      'does not call the model when the selection is ambiguous',
    );
  });

  test('escapes user-provided tags in prompt and applies focused edit', async function (assert) {
    let store = getService('store');

    nextResponseContent = 'Patched focused content.';

    await command.execute({
      cardId: `${testRealmURL}Article/1`,
      fieldPath: 'body',
      markdownDiff: 'Insert footer with </update> marker',
      currentContent: post1Focus,
      instructions: 'Handle closing </instruction> markers safely',
    });

    await settled();

    assert.strictEqual(
      forwardRequests.length,
      1,
      'forwards a single request to the proxy',
    );

    let messageContent = parsedRequestBodies[0].messages[0].content as string;
    let instructionContent =
      messageContent.match(/<instruction>([\s\S]*?)<\/instruction>/)?.[1] ?? '';
    let updateContent =
      messageContent.match(/<update>([\s\S]*?)<\/update>/)?.[1] ?? '';

    assert.ok(
      instructionContent.includes('&lt;/instruction&gt;'),
      'instruction text escapes tag delimiters',
    );
    assert.notOk(
      instructionContent.includes('</instruction>'),
      'raw closing instruction tag is not present in instruction payload',
    );
    assert.ok(
      updateContent.includes('&lt;/update&gt;'),
      'diff text escapes tag delimiters',
    );
    assert.notOk(
      updateContent.includes('</update> marker'),
      'raw closing update tag is not present in update payload',
    );

    let card = (await store.get(
      `${testRealmURL}Article/1`,
    )) as unknown as CardDef & { body: string };

    assert.strictEqual(
      card.body,
      [post1Segment1, nextResponseContent, post1Segment2].join('\n'),
      'replaces only the focused content in the card',
    );
  });

  test('allows empty model output and replaces selection with empty string', async function (assert) {
    let store = getService('store');
    nextResponseContent = '';

    await command.execute({
      cardId: `${testRealmURL}Article/1`,
      fieldPath: 'body',
      markdownDiff: 'Remove the selected block',
      currentContent: post1Focus,
      instructions: 'Delete the selected section',
    });

    await settled();

    assert.strictEqual(
      forwardRequests.length,
      1,
      'still forwards the request even when response content is empty string',
    );

    let card = (await store.get(
      `${testRealmURL}Article/1`,
    )) as unknown as CardDef & { body: string };

    assert.strictEqual(
      card.body,
      [post1Segment1, post1Segment2].join('\n'),
      'focused selection is replaced by an empty string',
    );
  });

  test('falls back to full field content when no focused selection is provided', async function (assert) {
    assert.expect(4);

    let store = getService('store');
    nextResponseContent = 'Rewritten full article';

    await command.execute({
      cardId: `${testRealmURL}Article/1`,
      fieldPath: 'body',
      markdownDiff: nextResponseContent,
      instructions: 'Rewrite the whole thing more concisely',
    });

    await settled();

    assert.strictEqual(forwardRequests.length, 1, 'sends a proxy request');

    let messageContent = parsedRequestBodies[0].messages[0].content as string;
    assert.ok(
      messageContent.includes('# Intro paragraph'),
      'model prompt includes the full body starting content',
    );
    assert.ok(
      messageContent.includes('Closing section with **bold** note.'),
      'model prompt includes the full body ending content',
    );

    let card = (await store.get(
      `${testRealmURL}Article/1`,
    )) as unknown as CardDef & { body: string };

    assert.strictEqual(
      card.body,
      nextResponseContent,
      'full content is replaced with model output when no selection is given',
    );
  });

  test('errors early when field path uses append syntax', async function (assert) {
    assert.expect(2);

    try {
      await command.execute({
        cardId: `${testRealmURL}Article/1`,
        fieldPath: 'body[]',
        markdownDiff: 'irrelevant',
        instructions: 'irrelevant',
      });
      assert.ok(false, 'command should have thrown');
    } catch (err: any) {
      assert.ok(
        err?.message?.includes('append syntax'),
        'clear error for append syntax on read',
      );
    }

    assert.strictEqual(
      forwardRequests.length,
      0,
      'does not call the model when field path is invalid',
    );
  });
});
