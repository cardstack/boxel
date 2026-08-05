import 'ses';

import { module, test } from 'qunit';

import CapsuleModuleEvaluator, {
  ensureCapsuleLockdown,
} from '@cardstack/host/lib/capsule-module-evaluator';

import { createCapsuleCompartment } from '../../../workers/capsule-module-registration-evaluator';

const moduleId = 'https://example.test/cards/article.js';
const isolatedBlock = JSON.stringify([[['Append', 'Capsule isolated']], []]);
const fittedBlock = JSON.stringify([[['Append', 'Capsule fitted']], []]);

function evaluatorFor(sources: Record<string, string>) {
  return new CapsuleModuleEvaluator('https://example.test/cards/', {
    fetch: async (input) => {
      let url = input instanceof Request ? input.url : String(input);
      let source = sources[url];
      return source === undefined
        ? new Response('not granted', { status: 403 })
        : new Response(source, { status: 200 });
    },
    resolveImport: (moduleIdentifier) =>
      moduleIdentifier.startsWith('@')
        ? `https://packages.example/${moduleIdentifier}`
        : moduleIdentifier,
  });
}

module('Unit | Capsule module registration', function () {
  test('AMD registration executes inside a compartment without browser authority', function (assert) {
    ensureCapsuleLockdown();
    let capsule = createCapsuleCompartment('test-capsule', {});
    let registration = capsule.moduleEvaluator(
      `define('fixture', ['exports'], function (exports) {
        exports.answer = 42;
        exports.ambient = {
          window: typeof window,
          document: typeof document,
          fetch: typeof fetch
        };
      });`,
      'https://example.test/fixture.js',
    );
    let exports: Record<string, unknown> = {};
    registration.implementation(exports);
    assert.strictEqual(exports.answer, 42);
    assert.deepEqual(exports.ambient, {
      window: 'undefined',
      document: 'undefined',
      fetch: 'undefined',
    });
  });

  test('one retained Capsule evaluates an authored module once across formats', async function (assert) {
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      if (import.meta.loader !== undefined) {
        throw new Error('host Loader leaked through import.meta');
      }
      export class ArticleCard extends CardDef {}
      ArticleCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'article-isolated',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        isStrictMode: true,
      }), ArticleCard.isolated);
      ArticleCard.fitted = class Fitted extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'article-fitted',
        block: ${JSON.stringify(fittedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        isStrictMode: true,
      }), ArticleCard.fitted);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let isolated = await evaluator.evaluateTemplate(
        moduleId,
        'ArticleCard',
        'isolated',
      );
      let fitted = await evaluator.evaluateTemplate(
        moduleId,
        'ArticleCard',
        'fitted',
      );
      let isolatedAgain = await evaluator.evaluateTemplate(
        moduleId,
        'ArticleCard',
        'isolated',
      );

      assert.strictEqual(
        isolated.templates[isolated.root]?.id,
        'article-isolated',
      );
      assert.strictEqual(fitted.templates[fitted.root]?.id, 'article-fitted');
      assert.deepEqual(isolatedAgain, isolated);
      assert.deepEqual(evaluator.stats, {
        moduleEvaluations: 1,
        moduleCacheHits: 2,
      });
      assert.deepEqual(evaluator.ambientReport, {
        window: 'undefined',
        document: 'undefined',
        localStorage: 'undefined',
        fetch: 'undefined',
        XMLHttpRequest: 'undefined',
        URL: 'function',
        URLSearchParams: 'function',
      });
    } finally {
      evaluator.destroy();
    }
  });
});
