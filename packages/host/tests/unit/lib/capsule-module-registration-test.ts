import 'ses';

import { module, test } from 'qunit';

import { normalizeCodeRef } from '@cardstack/runtime-common';
import type {
  LooseCardResource,
  LooseSingleCardDocument,
  RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import CapsuleModuleEvaluator, {
  capsuleSetCapabilityArgument,
  capsuleViewCardCapabilityArgument,
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

  test('Capsule components retain state and emit only granted Host effects', async function (assert) {
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class CounterCard extends CardDef {}
      CounterCard.isolated = class Counter extends Component {
        constructor(owner, args) {
          super(owner, args);
          this.count = 0;
        }

        increment() {
          this.count++;
          this.args.viewCard('https://example.test/Card/two', 'isolated');
          this.args.set(this.count);
          return this.count;
        }
      };
      setComponentTemplate(createTemplateFactory({
        id: 'counter-isolated',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        isStrictMode: true,
      }), CounterCard.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'CounterCard',
        'isolated',
      );
      let component = bundle.templates[bundle.root]!.instance;
      let instance = evaluator.instantiateComponent(component.handle, {
        [capsuleViewCardCapabilityArgument]: true,
        [capsuleSetCapabilityArgument]: true,
      });

      let first = await evaluator.invokeComponentAction(
        instance.handle,
        'increment',
        [],
      );
      let second = await evaluator.invokeComponentAction(
        instance.handle,
        'increment',
        [],
      );

      assert.strictEqual(first.returnValue, 1);
      assert.strictEqual(second.returnValue, 2);
      assert.strictEqual(second.state.count, 2, 'state stays in the Capsule');
      assert.deepEqual(first.effects, [
        {
          type: 'view-card',
          target: 'https://example.test/Card/two',
          format: 'isolated',
        },
        { type: 'set', value: 1 },
      ]);

      let ungranted = evaluator.instantiateComponent(component.handle, {});
      assert.throws(
        () =>
          evaluator.invokeComponentAction(ungranted.handle, 'increment', []),
        /viewCard is not a function/,
        'the same authored method receives no ambient Host capability',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('Capsule projects linked snapshots and getters while Base owns missing formats', async function (assert) {
    let source = `
      import { CardDef } from 'https://cardstack.com/base/card-api';

      export class Flight extends CardDef {
        get cardTitle() {
          return this.route.origin + ' → ' + this.route.destination;
        }

        get projectedCost() {
          return this.route.baseCost * this.scenario.costFactor;
        }
      }
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    let runtime = new CapsuleBoxelRuntime(evaluator);
    let ref = {
      module: '../../article.js' as RealmResourceIdentifier,
      name: 'Flight',
    };
    let resource = {
      type: 'card',
      id: 'https://example.test/Flight/one',
      attributes: {},
      relationships: {
        route: { data: { type: 'card', id: 'route:ord-lhr' } },
        scenario: { data: { type: 'card', id: 'scenario:base' } },
      },
      meta: { adoptsFrom: ref },
    } as LooseCardResource;
    let document = {
      data: resource,
      included: [
        {
          type: 'card',
          id: 'route:ord-lhr',
          attributes: {
            origin: 'ORD',
            destination: 'LHR',
            baseCost: 1200,
          },
        },
        {
          type: 'card',
          id: 'scenario:base',
          attributes: { costFactor: 1.25 },
        },
      ],
    } as unknown as LooseSingleCardDocument;

    try {
      let card = await runtime.createFromSerialized(
        resource,
        document,
        resource.id as RealmResourceIdentifier,
        'host-display',
      );
      let record = await runtime.buildRenderRecord(card);
      let serialized = await runtime.serializeCard(card);
      let slot = await runtime.getRenderSlot(card, 'isolated');

      assert.strictEqual(record.presentation.title, 'ORD → LHR');
      assert.strictEqual(
        normalizeCodeRef(record.boxel.ref).module,
        moduleId,
        'portable relative adoptsFrom is resolved at the execution boundary',
      );
      assert.strictEqual(
        serialized.data.attributes?.projectedCost,
        1500,
        'authored getters execute in the Capsule over a bounded linked snapshot',
      );
      assert.strictEqual(
        slot.owner,
        'capsule',
        'the missing authored format resolves to a Host-owned Base fallback without direct execution',
      );
    } finally {
      runtime.destroy();
    }
  });
});
