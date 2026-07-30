import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import {
  AI_PROXY_URL,
  ISOLATION_PROGRAM_SOURCE,
  SECURITY_PROBE_PROGRAM_SOURCE,
  articleCardDocumentSource,
  assertAllowedAIProxyURL,
  assertURLWithinRealm,
  commentCardDocumentSource,
  recipeCardDocumentSource,
  recipeSnapshotFromCardDocument,
  sanitizeAIProxyRequest,
  sanitizeDelegationProps,
  sanitizeOwnCardPatch,
  sanitizeRecipeCommandInput,
  securityProbeCardDocumentSource,
  snapshotFromCardDocument,
  spikeCardQuery,
  videoCardDocumentSource,
} from '@cardstack/host/lib/realm-isolation-spike';
import RealmIsolationWorkerRuntime from '@cardstack/host/lib/realm-isolation-worker-runtime';

module('Unit | realm isolation spike', function () {
  test('emits syntactically valid SES program source', function (assert) {
    assert.strictEqual(
      typeof new Function(ISOLATION_PROGRAM_SOURCE),
      'function',
    );
  });

  test('evaluates a realm program in the SES worker compartment', async function (assert) {
    let runtime = new RealmIsolationWorkerRuntime(
      {
        realmURL: 'https://realms.example/alice/realm-a/',
        cardURL: 'https://realms.example/alice/realm-a/Card/1',
        programURL: 'https://realms.example/alice/realm-a/program.js',
        label: 'Realm A',
        role: 'parent',
        canUseAIProxy: false,
      },
      `(() => harden({
        inspect: () => harden({
          window: typeof window,
          document: typeof document,
          fetch: typeof fetch,
          define: typeof define,
        }),
      }))()`,
      async () => {
        throw new Error('The inspection program requested no capabilities');
      },
    );

    try {
      assert.deepEqual(
        await runtime.invoke<Record<string, string>>('inspect'),
        {
          window: 'undefined',
          document: 'undefined',
          fetch: 'undefined',
          define: 'function',
        },
      );
    } finally {
      runtime.destroy();
    }
  });

  test('runs the hostile card in SES and denies cross-realm reads and fake exfiltration', async function (assert) {
    let capabilityRequests: string[] = [];
    let runtime = new RealmIsolationWorkerRuntime(
      {
        realmURL: 'https://realms.example/alice/child/',
        cardURL:
          'https://realms.example/alice/child/SecurityProbeCard/red-team',
        programURL:
          'https://realms.example/alice/child/security-probe-program.js',
        label: 'Child Realm',
        role: 'child',
        canUseAIProxy: true,
      },
      SECURITY_PROBE_PROGRAM_SOURCE,
      async (request) => {
        capabilityRequests.push(request.operation);
        if (request.operation === 'read-own-card') {
          return {
            id: 'https://realms.example/alice/child/SecurityProbeCard/red-team',
            realmLabel: 'Child Realm',
            role: 'child',
            privateValue: 'OWN-VALUE',
            note: 'Own note',
            counter: 0,
          };
        }
        if (request.operation === 'read-card') {
          throw new Error('Denied cross-realm access');
        }
        if (request.operation === 'proxy-fetch') {
          throw new Error('AI fetch is restricted to the approved proxy');
        }
        throw new Error(`Unexpected capability: ${request.operation}`);
      },
    );

    try {
      let report = await runtime.invoke<{
        heading: string;
        payloadPreview: string;
        findings: Array<{ label: string; status: string; value: string }>;
      }>(
        'scrapeAll',
        'https://realms.example/alice/parent/ArticleCard/primary',
        'https://attacker.invalid/collect',
      );
      assert.strictEqual(report.heading, 'Exfiltration denied');
      assert.true(report.payloadPreview.includes('OWN-VALUE'));
      assert.deepEqual(capabilityRequests, [
        'read-own-card',
        'read-card',
        'proxy-fetch',
      ]);
      assert.strictEqual(
        report.findings.find((finding) => finding.label === 'window')?.value,
        'undefined',
      );
      assert.strictEqual(
        report.findings.find((finding) => finding.label === 'Parent-realm card')
          ?.status,
        'blocked',
      );
      assert.strictEqual(
        report.findings.find(
          (finding) => finding.label === 'Fake exfiltration request',
        )?.status,
        'blocked',
      );
    } finally {
      runtime.destroy();
    }
  });

  test('allows resources inside the bound realm', function (assert) {
    let target = assertURLWithinRealm(
      'https://realms.example/alice/realm-a/',
      'https://realms.example/alice/realm-a/Card/1',
    );

    assert.strictEqual(
      target.href,
      'https://realms.example/alice/realm-a/Card/1',
    );
  });

  test('denies sibling and cross-origin realms', function (assert) {
    assert.throws(
      () =>
        assertURLWithinRealm(
          'https://realms.example/alice/realm-a/',
          'https://realms.example/alice/realm-b/Card/1',
        ),
      /Denied cross-realm access/,
    );
    assert.throws(
      () =>
        assertURLWithinRealm(
          'https://realms.example/alice/realm-a/',
          'https://attacker.example/alice/realm-a/Card/1',
        ),
      /Denied cross-realm access/,
    );
  });

  test('creates a realm-pinned query', function (assert) {
    assert.deepEqual(spikeCardQuery('https://realms.example/alice/realm-a/'), {
      filter: {
        type: {
          module: rri('https://realms.example/alice/realm-a/article-card'),
          name: 'ArticleCard',
        },
      },
    });
    assert.deepEqual(
      spikeCardQuery('https://realms.example/alice/realm-b/', 'child'),
      {
        filter: {
          type: {
            module: rri('https://realms.example/alice/realm-b/story-modules'),
            name: 'CommentCard',
          },
        },
      },
    );
  });

  test('models one parent card linked to exactly three child cards', function (assert) {
    let childCards = {
      video: 'https://realms.example/child/VideoCard/field-notes',
      recipe: 'https://realms.example/child/RecipeCard/fire-roasted-beans',
      comments: 'https://realms.example/child/IsolationCard/primary',
    };
    let article = JSON.parse(
      articleCardDocumentSource('Parent Realm', 'PRIVATE', childCards),
    );
    assert.strictEqual(
      article.data.meta.adoptsFrom.name,
      'ArticleCard',
      'the parent instance is an ArticleCard',
    );
    assert.deepEqual(
      Object.keys(article.data.relationships),
      ['video', 'recipe', 'comments'],
      'the parent has exactly three linksTo relationships',
    );
    assert.strictEqual(
      JSON.parse(videoCardDocumentSource()).data.meta.adoptsFrom.name,
      'VideoCard',
    );
    assert.strictEqual(
      JSON.parse(recipeCardDocumentSource()).data.meta.adoptsFrom.name,
      'RecipeCard',
    );
    assert.strictEqual(
      JSON.parse(commentCardDocumentSource('Child Realm', 'PRIVATE')).data.meta
        .adoptsFrom.name,
      'CommentCard',
    );
  });

  test('creates an ordinary realm card for the Interact security probe', function (assert) {
    let document = JSON.parse(
      securityProbeCardDocumentSource(
        'Child Realm',
        'PRIVATE',
        'https://realms.example/alice/child/',
        'https://realms.example/alice/parent/ArticleCard/primary',
      ),
    );
    assert.strictEqual(document.data.meta.adoptsFrom.name, 'SecurityProbeCard');
    assert.strictEqual(
      document.data.attributes.sandboxProfile,
      'realm-exfiltration-probe',
    );
    assert.strictEqual(
      document.data.attributes.targetEndpoint,
      'https://attacker.invalid/collect',
    );
  });

  test('copies a Card document into a plain snapshot', function (assert) {
    assert.deepEqual(
      snapshotFromCardDocument('https://realms.example/Card/1', {
        data: {
          attributes: {
            realmLabel: 'Realm A',
            role: 'child',
            privateValue: 'ALPHA',
            note: 'Only mine',
            counter: 3,
          },
        },
      }),
      {
        id: 'https://realms.example/Card/1',
        realmLabel: 'Realm A',
        role: 'child',
        privateValue: 'ALPHA',
        note: 'Only mine',
        counter: 3,
      },
    );
  });

  test('restricts AI fetch to the single proxy endpoint', function (assert) {
    assert.strictEqual(assertAllowedAIProxyURL(AI_PROXY_URL), AI_PROXY_URL);
    assert.throws(
      () => assertAllowedAIProxyURL('https://example.com/steal-secrets'),
      /AI fetch is restricted/,
    );
  });

  test('allows only the note field in own-card writes', function (assert) {
    assert.deepEqual(sanitizeOwnCardPatch({ note: 'updated' }), {
      note: 'updated',
    });
    let persistedComment = JSON.stringify({
      kind: 'editorial-comment',
      author: 'Reader',
      body: 'This remains inside the child realm.',
    });
    assert.deepEqual(sanitizeOwnCardPatch({ note: persistedComment }), {
      note: persistedComment,
    });
    assert.throws(
      () => sanitizeOwnCardPatch({ privateValue: 'stolen' }),
      /may only change note/,
    );
    assert.throws(
      () => sanitizeOwnCardPatch({ note: 'x'.repeat(501) }),
      /at most 500 characters/,
    );
  });

  test('limits the recipe command to bounded recipe content fields', function (assert) {
    assert.deepEqual(
      sanitizeRecipeCommandInput({
        title: ' Bean stew ',
        description: ' A tomato-free supper. ',
        serves: ' Serves 8 ',
        time: ' 45 minutes ',
        ingredients: [' 2 cans chickpeas ', '1 lemon'],
        steps: [' Warm the beans. ', 'Finish with lemon.'],
      }),
      {
        title: 'Bean stew',
        description: 'A tomato-free supper.',
        serves: 'Serves 8',
        time: '45 minutes',
        ingredients: ['2 cans chickpeas', '1 lemon'],
        steps: ['Warm the beans.', 'Finish with lemon.'],
      },
    );
    assert.throws(
      () =>
        sanitizeRecipeCommandInput({
          title: 'Bean stew',
          description: 'A tomato-free supper.',
          serves: 'Serves 8',
          time: '45 minutes',
          ingredients: ['2 cans chickpeas'],
          steps: ['Warm the beans.'],
          imageURL: 'https://attacker.example/tracker.png',
        }),
      /may only change title, description, serves, time, ingredients, and steps/,
    );
    assert.throws(
      () =>
        sanitizeRecipeCommandInput({
          title: 'Bean stew',
          description: 'A tomato-free supper.',
          serves: 'Serves 8',
          time: '45 minutes',
          ingredients: [],
          steps: ['Warm the beans.'],
        }),
      /between 1 and 20 items/,
    );
  });

  test('projects only RecipeCard context needed by Ask AI', function (assert) {
    let document = JSON.parse(recipeCardDocumentSource());
    let recipe = recipeSnapshotFromCardDocument(
      'https://realms.example/child/RecipeCard/fire-roasted-beans',
      document,
    );
    assert.strictEqual(
      recipe.id,
      'https://realms.example/child/RecipeCard/fire-roasted-beans',
    );
    assert.strictEqual(recipe.ingredients.length, 5);
    assert.strictEqual(recipe.title, 'Fire-roasted tomato & white bean stew');
    assert.notOk(
      'privateValue' in recipe,
      'the projection contains no unrelated card state',
    );
  });

  test('rejects private state in delegated render props', function (assert) {
    assert.deepEqual(
      sanitizeDelegationProps({ message: 'hello', parentCounter: 2 }),
      { message: 'hello', parentCounter: 2 },
    );
    assert.throws(
      () =>
        sanitizeDelegationProps({
          message: 'hello',
          parentCounter: 2,
          privateValue: 'secret',
        }),
      /delegate private state/,
    );
  });

  test('sanitizes the AI request and fixes the model and token cap', function (assert) {
    let request = JSON.parse(
      sanitizeAIProxyRequest({
        model: 'attacker/model',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100000,
      }),
    );
    assert.strictEqual(request.model, 'anthropic/claude-haiku-4.5');
    assert.strictEqual(request.max_tokens, 900);
    assert.false(request.stream);
  });
});
