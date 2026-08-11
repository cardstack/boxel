import 'ses';

import { module, test } from 'qunit';

import { normalizeCodeRef } from '@cardstack/runtime-common';
import type {
  LooseCardResource,
  LooseSingleCardDocument,
  RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import { createCapsuleRenderSlot } from '@cardstack/host/lib/capsule-component';
import { DefaultCapsuleComponentRuntime } from '@cardstack/host/lib/capsule-component-runtime';
import CapsuleModuleEvaluator, {
  capsuleRealmURLArgument,
  capsuleSetCapabilityArgument,
  capsuleViewCardCapabilityArgument,
  ensureCapsuleLockdown,
} from '@cardstack/host/lib/capsule-module-evaluator';

import { createCapsuleCompartment } from '../../../workers/capsule-module-registration-evaluator';

const moduleId = 'https://example.test/cards/article.js';
const isolatedBlock = JSON.stringify([[['Append', 'Capsule isolated']], []]);
const fittedBlock = JSON.stringify([[['Append', 'Capsule fitted']], []]);

function evaluatorFor(
  sources: Record<string, string>,
  isTrustedImport?: (moduleIdentifier: string) => boolean,
) {
  return new CapsuleModuleEvaluator('https://example.test/cards/', {
    fetch: async (input) => {
      let url = input instanceof Request ? input.url : String(input);
      let source = sources[url];
      return source === undefined
        ? new Response('not granted', { status: 403 })
        : new Response(source, { status: 200 });
    },
    resolveImport: (moduleIdentifier) =>
      moduleIdentifier === 'ember-provide-consume-context'
        ? `${PACKAGES_FAKE_ORIGIN}${moduleIdentifier}`
        : moduleIdentifier.startsWith('@')
          ? `https://packages.example/${moduleIdentifier}`
          : moduleIdentifier,
    isTrustedImport,
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

      if (typeof import.meta.loader?.import !== 'function') {
        throw new Error('dynamic import policy facade is missing');
      }
      try {
        import.meta.loader.fetch('https://example.test/private');
        throw new Error('dynamic fetch policy facade did not refuse');
      } catch (error) {
        if (!String(error).includes('CAPSULE_DYNAMIC_FETCH_DENIED')) {
          throw error;
        }
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
        Intl: 'object',
        URL: 'function',
        URLSearchParams: 'function',
        structuredClone: 'function',
      });
    } finally {
      evaluator.destroy();
    }
  });

  test('Capsule structuredClone copies data without transfer authority', async function (assert) {
    let source = `
      import { CardDef } from 'https://cardstack.com/base/card-api';

      export class CloneCard extends CardDef {
        clone(value) {
          return structuredClone(value);
        }

        transfer(value) {
          return structuredClone(value, { transfer: [] });
        }
      }
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      assert.deepEqual(
        await evaluator.invokeCardMethod(moduleId, 'CloneCard', {}, 'clone', [
          { nested: { value: 42 } },
        ]),
        { returnValue: { nested: { value: 42 } } },
        'authored helpers can clone bounded data inside the Capsule',
      );
      await assert.rejects(
        evaluator.invokeCardMethod(moduleId, 'CloneCard', {}, 'transfer', [
          new Uint8Array([1, 2, 3]),
        ]),
        /does not support transfer options/,
        'the pure clone intrinsic does not expose transferable authority',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('Capsule data cloning preserves text that is unsafe to embed in source', async function (assert) {
    let source = `
      import { CardDef } from 'https://cardstack.com/base/card-api';

      export class TextCard extends CardDef {
        echo(value) {
          return value;
        }
      }
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    let value = {
      htmlComments: '<!-- authored -->',
      mermaid: 'left --> right',
      separators: 'line one\u2028line two\u2029line three',
    };
    try {
      assert.deepEqual(
        await evaluator.invokeCardMethod(moduleId, 'TextCard', {}, 'echo', [
          value,
        ]),
        { returnValue: value },
        'JSON text is parsed as data inside the compartment without source escaping',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('template capture defers component construction until render arguments exist', async function (assert) {
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      class Isolated extends Component {
        constructor(owner, args) {
          super(owner, args);
          this.selectedView = this.args.model.defaultView;
        }
      }
      export class Workspace extends CardDef {}
      Workspace.isolated = Isolated;
      setComponentTemplate(createTemplateFactory({
        id: 'args-dependent-isolated',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        isStrictMode: true,
      }), Workspace.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'Workspace',
        'isolated',
      );
      let definition = bundle.templates[bundle.root]!.instance;
      let instance = evaluator.instantiateComponent(definition.handle, {
        model: { defaultView: 'grid' },
      });

      assert.strictEqual(
        instance.state.selectedView,
        'grid',
        'the real component is constructed with projected Glimmer arguments',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('Capsule projects Base context values without exposing Host context authority', async function (assert) {
    let contextBlock = JSON.stringify([[['Append', 'Context view']], []]);
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      import { consume, provide } from 'ember-provide-consume-context';
      import {
        CardContextName,
        CardCrudFunctionsContextName,
        CardURLContextName,
        DefaultFormatsContextName,
        PermissionsContextName,
        RealmURLContextName,
      } from '@cardstack/runtime-common';

      function consumeProperty(target, property, contextName) {
        let descriptor = consume(contextName)(target, property, {
          configurable: true,
          enumerable: true,
        });
        Object.defineProperty(target, property, descriptor);
      }

      class ContextView extends Component {
        get providedFormats() {
          return this.args.providedFormats;
        }
      }
      consumeProperty(ContextView.prototype, 'cardContext', CardContextName);
      consumeProperty(
        ContextView.prototype,
        'cardCrudFunctions',
        CardCrudFunctionsContextName,
      );
      consumeProperty(ContextView.prototype, 'cardURL', CardURLContextName);
      consumeProperty(
        ContextView.prototype,
        'defaultFormats',
        DefaultFormatsContextName,
      );
      consumeProperty(
        ContextView.prototype,
        'permissions',
        PermissionsContextName,
      );
      consumeProperty(ContextView.prototype, 'realmURL', RealmURLContextName);
      consumeProperty(ContextView.prototype, 'futureContext', 'future-context');
      let providedFormatsDescriptor = Object.getOwnPropertyDescriptor(
        ContextView.prototype,
        'providedFormats',
      );
      Object.defineProperty(
        ContextView.prototype,
        'providedFormats',
        provide(DefaultFormatsContextName)(
          ContextView.prototype,
          'providedFormats',
          providedFormatsDescriptor,
        ),
      );

      export class ContextCard extends CardDef {}
      ContextCard.isolated = ContextView;
      setComponentTemplate(createTemplateFactory({
        id: 'context-isolated',
        block: ${JSON.stringify(contextBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        isStrictMode: true,
      }), ContextCard.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'ContextCard',
        'isolated',
      );
      let descriptor = bundle.templates[bundle.root]!.instance;
      let instance = evaluator.instantiateComponent(descriptor.handle, {
        model: {
          id: 'https://example.test/cards/ContextCard/one',
          [capsuleRealmURLArgument]: 'https://example.test/cards/',
        },
        format: 'edit',
        providedFormats: { cardDef: 'edit', fieldDef: 'edit' },
        [capsuleSetCapabilityArgument]: true,
        [capsuleViewCardCapabilityArgument]: true,
      });

      assert.deepEqual(
        evaluator.readComponentProperty(instance.handle, 'cardContext'),
        {},
        'the live Host CardContext does not cross the boundary',
      );
      assert.deepEqual(
        evaluator.readComponentProperty(instance.handle, 'cardCrudFunctions'),
        {},
        'functions remain explicit effects and do not serialize as data',
      );
      assert.strictEqual(
        evaluator.readComponentProperty(instance.handle, 'cardURL'),
        'https://example.test/cards/ContextCard/one',
      );
      assert.deepEqual(
        evaluator.readComponentProperty(instance.handle, 'defaultFormats'),
        { cardDef: 'edit', fieldDef: 'edit' },
      );
      assert.deepEqual(
        evaluator.readComponentProperty(instance.handle, 'permissions'),
        { canRead: true, canWrite: true },
      );
      assert.deepEqual(
        evaluator.readComponentProperty(instance.handle, 'realmURL'),
        { href: 'https://example.test/cards/' },
      );
      assert.strictEqual(
        evaluator.readComponentProperty(instance.handle, 'futureContext'),
        undefined,
        'an unavailable context is inert instead of aborting Base evaluation',
      );
      assert.deepEqual(
        evaluator.readComponentProperty(instance.handle, 'providedFormats'),
        { cardDef: 'edit', fieldDef: 'edit' },
        'trusted Base providers remain evaluable in the Capsule',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('trusted Base templates retain ordinary Glimmer features inside an authored Capsule', async function (assert) {
    let dynamicStyleBlock = JSON.stringify([[15, 'style'], []]);
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class NumberScore extends CardDef {}
      NumberScore.isolated = class Score extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'trusted-number-score',
        block: ${JSON.stringify(dynamicStyleBlock)},
        moduleName: '/number/components/score.gts',
        isStrictMode: true,
      }), NumberScore.isolated);
    `;
    let evaluator = evaluatorFor(
      { [moduleId]: source },
      (identifier) => identifier === moduleId,
    );
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'NumberScore',
        'isolated',
      );

      assert.strictEqual(
        bundle.templates[bundle.root]?.id,
        'trusted-number-score',
        'the authored boundary does not reject a Host-trusted Base template',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('authored Capsule templates may bind styles only through trusted cssVar', async function (assert) {
    let trustedHelpers = '@cardstack/boxel-ui/helpers';
    let cssVarBlock = JSON.stringify([
      [[15, 5, [28, [32, 0], [], { accent: 'navy' }]]],
      [],
    ]);
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      import { cssVar } from '${trustedHelpers}';

      export class StyledCard extends CardDef {}
      StyledCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'trusted-css-var-isolated',
        block: ${JSON.stringify(cssVarBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        scope: () => [cssVar],
        isStrictMode: true,
      }), StyledCard.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'StyledCard',
        'isolated',
      );
      assert.deepEqual(bundle.templates[bundle.root]?.scope, [
        {
          kind: 'trusted-export',
          module: trustedHelpers,
          name: 'cssVar',
        },
      ]);
    } finally {
      evaluator.destroy();
    }

    let authoredHelperSource = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      function cssVar() { return '--accent: navy'; }
      export class UnsafeStyledCard extends CardDef {}
      UnsafeStyledCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'authored-css-var-isolated',
        block: ${JSON.stringify(cssVarBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        scope: () => [cssVar],
        isStrictMode: true,
      }), UnsafeStyledCard.isolated);
    `;
    let unsafeEvaluator = evaluatorFor({ [moduleId]: authoredHelperSource });
    try {
      await assert.rejects(
        unsafeEvaluator.evaluateTemplate(
          moduleId,
          'UnsafeStyledCard',
          'isolated',
        ),
        /cannot use dynamic inline styles except the trusted Boxel cssVar helper/,
      );
    } finally {
      unsafeEvaluator.destroy();
    }
  });

  test('relative dependencies within a trusted module graph use trusted facades', async function (assert) {
    let trustedModuleId = 'https://trusted.example/base/workspace.js';
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      import { unusedTrustedExport } from './default-template.js';

      void unusedTrustedExport;
      export class Workspace extends CardDef {}
      Workspace.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'trusted-relative-isolated',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(trustedModuleId)},
        isStrictMode: true,
      }), Workspace.isolated);
    `;
    let evaluator = evaluatorFor({ [trustedModuleId]: source }, (identifier) =>
      identifier.startsWith('https://trusted.example/base/'),
    );
    try {
      let bundle = await evaluator.evaluateTemplate(
        trustedModuleId,
        'Workspace',
        'isolated',
      );

      assert.strictEqual(
        bundle.templates[bundle.root]?.id,
        'trusted-relative-isolated',
        'the relative Base dependency is facaded instead of fetched and evaluated',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('authored Capsule templates invoke trusted Cardstack components by Host-owned reference', async function (assert) {
    let trustedBaseModule =
      'https://cardstack.com/base/components/cards-grid-layout';
    let trustedPackageModule = '@cardstack/boxel-ui/components/status-pill';
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      import CardsGridLayout from '${trustedBaseModule}';
      import StatusPill from '${trustedPackageModule}';

      export class CapsuleWorkspace extends CardDef {}
      CapsuleWorkspace.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'capsule-with-trusted-components',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        scope: () => [CardsGridLayout, StatusPill],
        isStrictMode: true,
      }), CapsuleWorkspace.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'CapsuleWorkspace',
        'isolated',
      );

      assert.deepEqual(bundle.templates[bundle.root]?.scope, [
        {
          kind: 'trusted-export',
          module: trustedBaseModule,
          name: 'default',
        },
        {
          kind: 'trusted-export',
          module: trustedPackageModule,
          name: 'default',
        },
      ]);

      let loaded: string[] = [];
      let trustedComponents = new Map<string, object>([
        [trustedBaseModule, class CardsGridLayout {}],
        [trustedPackageModule, class StatusPill {}],
      ]);
      let slot = await createCapsuleRenderSlot(
        new DefaultCapsuleComponentRuntime(evaluator),
        bundle,
        async (moduleIdentifier) => {
          loaded.push(moduleIdentifier);
          return { default: trustedComponents.get(moduleIdentifier)! };
        },
      );

      assert.strictEqual(slot.owner, 'capsule');
      assert.deepEqual(
        loaded,
        [trustedBaseModule, trustedPackageModule],
        'trusted components resolve in the Host only when the render slot is built',
      );
    } finally {
      evaluator.destroy();
    }
  });

  test('resolved Cardstack package URLs remain Host-owned references', async function (assert) {
    let trustedPackageModule =
      'https://packages/@cardstack/base/currency-field';
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      import CurrencyField from '${trustedPackageModule}';

      export class CapsuleInvoice extends CardDef {}
      CapsuleInvoice.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'capsule-with-resolved-cardstack-package',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        scope: () => [CurrencyField],
        isStrictMode: true,
      }), CapsuleInvoice.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      let bundle = await evaluator.evaluateTemplate(
        moduleId,
        'CapsuleInvoice',
        'isolated',
      );

      assert.deepEqual(bundle.templates[bundle.root]?.scope, [
        {
          kind: 'trusted-export',
          module: trustedPackageModule,
          name: 'default',
        },
      ]);
    } finally {
      evaluator.destroy();
    }
  });

  test('authored executable values cannot flow out through a Capsule template scope', async function (assert) {
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      function AuthoredClosure() {}
      export class UnsafeCard extends CardDef {}
      UnsafeCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'capsule-with-authored-closure',
        block: ${JSON.stringify(isolatedBlock)},
        moduleName: ${JSON.stringify(moduleId)},
        scope: () => [AuthoredClosure],
        isStrictMode: true,
      }), UnsafeCard.isolated);
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      await assert.rejects(
        evaluator.evaluateTemplate(moduleId, 'UnsafeCard', 'isolated'),
        /scope\[0\].*cannot cross the Capsule boundary.*without a trusted module identity/,
        'the trusted component path does not become a reverse executable-object bridge',
      );
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

        get guideName() {
          return this.cardInfo.guide.name;
        }
      }
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    let evaluateCardTypeMetadata =
      evaluator.evaluateCardTypeMetadata.bind(evaluator);
    let metadataEvaluations = 0;
    evaluator.evaluateCardTypeMetadata = async (...args) => {
      metadataEvaluations++;
      return evaluateCardTypeMetadata(...args);
    };
    let runtime = new CapsuleBoxelRuntime(evaluator);
    let ref = {
      module: '../cards/article.js' as RealmResourceIdentifier,
      name: 'Flight',
    };
    let resource = {
      type: 'card',
      id: 'https://example.test/Flight/one',
      attributes: {},
      relationships: {
        route: { data: { type: 'card', id: 'route:ord-lhr' } },
        scenario: { data: { type: 'card', id: 'scenario:base' } },
        'cardInfo.guide': { data: { type: 'card', id: 'guide:release' } },
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
        {
          type: 'card',
          id: 'guide:release',
          attributes: { name: 'Release guide' },
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
      let secondCard = await runtime.createFromSerialized(
        resource,
        document,
        resource.id as RealmResourceIdentifier,
        'host-display',
      );
      await runtime.buildRenderRecord(secondCard);
      let secondSlot = await runtime.getRenderSlot(secondCard, 'isolated');

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
        serialized.data.attributes?.guideName,
        'Release guide',
        'dotted relationship paths are rebuilt as nested bounded values',
      );
      assert.strictEqual(
        slot.owner,
        'trusted-base',
        'the missing authored format resolves to an inert Host-owned Base marker',
      );
      if (slot.owner === 'trusted-base') {
        assert.deepEqual(
          normalizeCodeRef(slot.componentCodeRef),
          {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
          'the Host is instructed to render the real Base CardDef format',
        );
      }
      assert.strictEqual(
        metadataEvaluations,
        1,
        'CardDef metadata is evaluated once per warm Capsule',
      );
      assert.strictEqual(
        secondSlot,
        slot,
        'one CardDef format reuses its compiled render slot across instances',
      );
    } finally {
      runtime.destroy();
    }
  });

  test('Capsule recursively projects getters from contained authored FieldDefs', async function (assert) {
    let source = `
      import {
        CardDef,
        FieldDef,
        contains,
        field,
      } from 'https://cardstack.com/base/card-api';

      class Price extends FieldDef {
        get label() {
          return '$' + this.amount.toFixed(2);
        }
      }

      export class Catalog extends FieldDef {}
      field(Catalog.prototype, 'price', {
        initializer() { return contains(Price); }
      });

      export class Release extends CardDef {}
      field(Release.prototype, 'catalog', {
        initializer() { return contains(Catalog); }
      });
    `;
    let evaluator = evaluatorFor({ [moduleId]: source });
    try {
      assert.deepEqual(
        await evaluator.evaluateCardProjection(moduleId, 'Release', {
          catalog: { price: { amount: 24 } },
        }),
        {
          catalog: {
            price: {
              amount: 24,
              label: '$24.00',
            },
          },
        },
        'nested authored code stays in the Capsule while its JSON-safe getter result crosses the boundary',
      );
    } finally {
      evaluator.destroy();
    }
  });
});
