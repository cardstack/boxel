import { module, test } from 'qunit';

import { decodeScopedCSSRequest } from '@cardstack/runtime-common';
import { transpileJS } from '@cardstack/runtime-common/transpile';

import RealmCompartmentModuleRuntime, {
  sandboxRealmURLArgument,
} from '@cardstack/host/lib/realm-compartment-module-runtime';
import { validateCompartmentCSS } from '@cardstack/host/services/realm-sandbox';
import { validateCompartmentInlineStyle } from '@cardstack/host/services/realm-sandbox';

const MODULE_ID = 'https://realm.example/cards/article.js';
const TEMPLATE_BLOCK = JSON.stringify([
  [['Append', 'A compartment-owned template']],
  [],
]);
const FITTED_TEMPLATE_BLOCK = JSON.stringify([
  [['Append', 'A fitted compartment-owned template']],
  [],
]);
const SCOPED_GTS_CARD_SOURCE = `
  import {
    CardDef,
    Component,
  } from 'https://cardstack.com/base/card-api';

  export class RecipeCard extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <article>
          <h2>Ask the story</h2>
          <h3>Ingredients</h3>
        </article>
        <style scoped>
          article { color: #272019; }
        </style>
      </template>
    };
  }
`;

function runtimeFor(sources: Record<string, string>) {
  let fetchModule = async (input: RequestInfo | URL) => {
    let url = input instanceof Request ? input.url : String(input);
    let source = sources[url];
    return source === undefined
      ? new Response('not granted', { status: 403 })
      : new Response(source, { status: 200 });
  };
  return new RealmCompartmentModuleRuntime('https://realm.example/cards/', {
    fetch: fetchModule,
    resolveImport: (moduleIdentifier) =>
      moduleIdentifier.startsWith('@')
        ? `https://packages.example/${moduleIdentifier}`
        : moduleIdentifier,
    validateInlineStyle: validateCompartmentInlineStyle,
  });
}

module('Unit | realm compartment module runtime', function () {
  test('evaluates and caches a card module without browser authority', async function (assert) {
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      if (import.meta.loader !== undefined) {
        throw new Error('host loader leaked into compartment import.meta');
      }
      if (import.meta.url !== ${JSON.stringify(MODULE_ID)}) {
        throw new Error('compartment import.meta.url is incorrect');
      }
      let parsedURL = new URL('./linked?mode=details', import.meta.url);
      if (
        parsedURL.href !== 'https://realm.example/cards/linked?mode=details' ||
        !(parsedURL instanceof URL) ||
        URL.canParse('not a URL') ||
        URL.parse('not a URL') !== null
      ) {
        throw new Error('safe URL parsing globals are incorrect');
      }
      if (URL.createObjectURL !== undefined || URL.revokeObjectURL !== undefined) {
        throw new Error('ambient Blob URL authority leaked into compartment');
      }
      if (
        parsedURL.constructor !== URL ||
        Object.getPrototypeOf(parsedURL).constructor !== URL ||
        parsedURL.constructor.createObjectURL !== undefined ||
        Object.getPrototypeOf(parsedURL).constructor.createObjectURL !== undefined
      ) {
        throw new Error('native URL constructor authority leaked through an instance');
      }
      let params = new URLSearchParams(parsedURL.search);
      params.set('mode', 'history');
      if (
        !(params instanceof URLSearchParams) ||
        params.toString() !== 'mode=history' ||
        params.constructor !== URLSearchParams ||
        Object.getPrototypeOf(params).constructor !== URLSearchParams ||
        parsedURL.searchParams.constructor !== URLSearchParams
      ) {
        throw new Error('safe URLSearchParams global is incorrect');
      }

      export class ArticleCard extends CardDef {}
      ArticleCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'article-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(MODULE_ID)},
        isStrictMode: true,
      }), ArticleCard.isolated);
      ArticleCard.fitted = class Fitted extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'article-fitted',
        block: ${JSON.stringify(FITTED_TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(MODULE_ID)},
        isStrictMode: true,
      }), ArticleCard.fitted);
    `;
    let runtime = runtimeFor({ [MODULE_ID]: source });

    let first = await runtime.evaluateTemplate(
      MODULE_ID,
      'ArticleCard',
      'isolated',
    );
    let second = await runtime.evaluateTemplate(
      MODULE_ID,
      'ArticleCard',
      'fitted',
    );
    let third = await runtime.evaluateTemplate(
      MODULE_ID,
      'ArticleCard',
      'isolated',
    );

    assert.deepEqual(first, {
      root: 'component-0',
      templates: {
        'component-0': {
          id: 'article-isolated',
          block: TEMPLATE_BLOCK,
          moduleName: MODULE_ID,
          isStrictMode: true,
          stylesheets: [],
          scope: [],
          instance: {
            handle: 'sandbox-component-0',
            state: {},
            getters: [],
            actions: [],
          },
        },
      },
    });
    assert.strictEqual(
      second.templates[second.root]?.id,
      'article-fitted',
      'switches formats through the already-evaluated module',
    );
    assert.strictEqual(
      second.templates[second.root]?.block,
      FITTED_TEMPLATE_BLOCK,
      'captures the requested format template',
    );
    assert.deepEqual(third, first, 'can switch back without reevaluating');
    assert.deepEqual(runtime.stats, {
      moduleEvaluations: 1,
      moduleCacheHits: 2,
    });
    assert.deepEqual(runtime.ambientReport, {
      window: 'undefined',
      document: 'undefined',
      localStorage: 'undefined',
      fetch: 'undefined',
      XMLHttpRequest: 'undefined',
      URL: 'function',
      URLSearchParams: 'function',
    });
  });

  test('extracts only allowlisted card presentation metadata', async function (assert) {
    let moduleID = `${MODULE_ID}?presentation-metadata`;
    let source = `
      import NetworkIcon from '@cardstack/boxel-icons/network';
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class ArticleCard extends CardDef {
        static displayName = 'Realm Article';
        static headerColor = '#123456';
        static icon = NetworkIcon;
        static prefersWideFormat = true;
        static notAllowed = () => globalThis;
      }
      ArticleCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'metadata-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(moduleID)},
        isStrictMode: true,
      }), ArticleCard.isolated);
    `;
    let runtime = runtimeFor({ [moduleID]: source });

    assert.deepEqual(
      await runtime.evaluateCardTypeMetadata(moduleID, 'ArticleCard'),
      {
        displayName: 'Realm Article',
        fields: {},
        headerColor: '#123456',
        hasCustomEditTemplate: false,
        hasCustomIsolatedTemplate: true,
        authoredTemplateFormats: ['isolated'],
        icon: {
          module: '@cardstack/boxel-icons/network',
          name: 'default',
        },
        prefersWideFormat: true,
      },
      'executable and unknown statics are omitted',
    );
  });

  test('reports inherited Base templates without importing them into the compartment', async function (assert) {
    let moduleID = `${MODULE_ID}?base-template-fallbacks`;
    let source = `
      import { CardDef } from 'https://cardstack.com/base/card-api';

      export class BlankCard extends CardDef {
        static displayName = 'Blank Card';
      }
    `;
    let runtime = runtimeFor({ [moduleID]: source });

    let metadata = await runtime.evaluateCardTypeMetadata(
      moduleID,
      'BlankCard',
    );

    assert.deepEqual(
      metadata.authoredTemplateFormats,
      [],
      'the explicit metadata boundary distinguishes inherited Base templates from authored templates',
    );
    assert.false(metadata.hasCustomIsolatedTemplate);
    assert.false(metadata.hasCustomEditTemplate);
  });

  test('allows readable same-realm and cross-realm module graphs', async function (assert) {
    let childURL = 'https://realm.example/cards/child';
    let sharedURL = 'https://shared.example/ui/nav';
    let childSource = `
      import shared from '${sharedURL}';
      export default shared;
    `;
    let sharedSource = `
      import { Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      class SharedNav extends Component {}
      setComponentTemplate(createTemplateFactory({
        id: 'shared-nav',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(sharedURL)},
        isStrictMode: true,
      }), SharedNav);
      export default SharedNav;
    `;
    let source = `
      import { CardDef } from 'https://cardstack.com/base/card-api';
      import Child from './child';
      export class ArticleCard extends CardDef { static isolated = Child; }
    `;
    let runtime = runtimeFor({
      [MODULE_ID]: source,
      [childURL]: childSource,
      [sharedURL]: sharedSource,
    });

    let bundle = await runtime.evaluateTemplate(
      MODULE_ID,
      'ArticleCard',
      'isolated',
    );

    assert.strictEqual(
      bundle.templates[bundle.root]?.id,
      'shared-nav',
      'a readable cross-realm dependency can provide the card template',
    );
  });

  test('does not mint a trusted facade for a traversal-shaped package import', async function (assert) {
    let moduleID = `${MODULE_ID}?trusted-traversal`;
    let source = `
      import { CardDef } from 'https://cardstack.com/base/card-api';
      import { HostAuthority } from '@cardstack/base/../attacker/evil.gts';
      export class ArticleCard extends CardDef { static isolated = HostAuthority; }
    `;
    let runtime = runtimeFor({ [moduleID]: source });

    await assert.rejects(
      runtime.evaluateTemplate(moduleID, 'ArticleCard', 'isolated'),
      /403|not granted|Failed to load module/,
      'the traversal is fetched through the confined module graph and fails instead of becoming a trusted-export token',
    );
  });

  test('bridges only JSON component state and getter results', async function (assert) {
    let moduleID = `${MODULE_ID}?component-state`;
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      export class ArticleCard extends CardDef {}
      ArticleCard.isolated = class Isolated extends Component {
        items = ['one', 'two'];
        increment = () => { this.items.push('three'); };
        asyncIncrement = async () => {
          await Promise.resolve();
          this.items.push('four');
        };
        isCount = (expected) => this.items.length === expected;
        get count() { return this.items.length; }
        get label() { return this.args.label; }
      };
      setComponentTemplate(createTemplateFactory({
        id: 'stateful-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(moduleID)},
        isStrictMode: true,
      }), ArticleCard.isolated);
    `;
    let runtime = runtimeFor({ [moduleID]: source });
    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'ArticleCard',
      'isolated',
    );
    let instance = bundle.templates[bundle.root]!.instance;

    assert.deepEqual(instance.state, { items: ['one', 'two'] });
    assert.deepEqual(instance.getters.sort(), ['count', 'label']);
    assert.deepEqual(instance.actions, [
      'asyncIncrement',
      'increment',
      'isCount',
    ]);
    assert.strictEqual(
      runtime.readComponentProperty(instance.handle, 'count', {}),
      2,
    );
    assert.strictEqual(
      runtime.readComponentProperty(instance.handle, 'label', {
        label: 'safe arg',
      }),
      'safe arg',
    );
    let live = runtime.instantiateComponent(instance.handle, {
      label: 'persistent arg',
    });
    let updated = await runtime.invokeComponentAction(
      live.handle,
      'increment',
      [],
    );
    assert.deepEqual(updated.state, { items: ['one', 'two', 'three'] });
    assert.true(
      (await runtime.invokeComponentAction(live.handle, 'isCount', [3]))
        .returnValue,
      'a synchronous pure component method returns across the explicit boundary',
    );
    let asyncUpdated = await runtime.invokeComponentAction(
      live.handle,
      'asyncIncrement',
      [],
    );
    assert.deepEqual(
      asyncUpdated.state,
      { items: ['one', 'two', 'three', 'four'] },
      'an asynchronous component action settles before its state crosses the boundary',
    );
    assert.strictEqual(runtime.readComponentProperty(live.handle, 'count'), 4);
    assert.strictEqual(
      runtime.readComponentProperty(live.handle, 'label'),
      'persistent arg',
    );
  });

  test('returns explicit viewCard effects without exposing the host callback', async function (assert) {
    let moduleID = `${MODULE_ID}?view-card-effect`;
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';
      export class ArticleCard extends CardDef {}
      ArticleCard.isolated = class Isolated extends Component {
        openTarget = () => this.args.viewCard(
          new URL('./target-card', import.meta.url),
          'embedded',
          { openCardInRightMostStack: true },
        );
        asyncOpenTarget = async (target) => {
          await Promise.resolve();
          this.args.viewCard(target, 'isolated');
        };
      };
      setComponentTemplate(createTemplateFactory({
        id: 'view-card-effect-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(moduleID)},
        isStrictMode: true,
      }), ArticleCard.isolated);
    `;
    let runtime = runtimeFor({ [moduleID]: source });
    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'ArticleCard',
      'isolated',
    );
    let hostCallbackCalled = false;
    let live = runtime.instantiateComponent(
      bundle.templates[bundle.root]!.instance.handle,
      { viewCard: () => (hostCallbackCalled = true) },
    );
    let updated = await runtime.invokeComponentAction(
      live.handle,
      'openTarget',
      [],
    );

    assert.false(
      hostCallbackCalled,
      'the host callback itself never crosses the compartment boundary',
    );
    assert.deepEqual(updated.effects, [
      {
        type: 'view-card',
        target: 'https://realm.example/cards/target-card',
        format: 'embedded',
        options: { openCardInRightMostStack: true },
      },
    ]);

    let first = runtime.invokeComponentAction(live.handle, 'asyncOpenTarget', [
      './first',
    ]);
    let second = runtime.invokeComponentAction(live.handle, 'asyncOpenTarget', [
      './second',
    ]);
    let third = runtime.invokeComponentAction(live.handle, 'asyncOpenTarget', [
      './third',
    ]);
    let [firstResult, secondResult, thirdResult] = await Promise.all([
      first,
      second,
      third,
    ]);
    assert.deepEqual(
      firstResult.effects.map((effect) => effect.target),
      ['./first'],
      'the first async invocation retains only its own effects',
    );
    assert.deepEqual(
      secondResult.effects.map((effect) => effect.target),
      ['./second'],
      'an overlapping invocation waits for an isolated effect queue',
    );
    assert.deepEqual(
      thirdResult.effects.map((effect) => effect.target),
      ['./third'],
      'each additional invocation chains behind the previous action tail',
    );
  });

  test('provides the explicit pure runtime-common card helpers', async function (assert) {
    let moduleID = `${MODULE_ID}?runtime-common`;
    let source = `
      import {
        baseRRI,
        codeRef,
        realmURL,
        searchEntryWireQueryFromQuery,
      } from '@cardstack/runtime-common';
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class ArticleCard extends CardDef {}
      ArticleCard.isolated = class Isolated extends Component {
        get searchInputs() {
          return {
            base: baseRRI('string'),
            ref: codeRef(import.meta.url, './periodic-element', 'PeriodicElement'),
            realm: this.args.model[realmURL].href,
            wire: searchEntryWireQueryFromQuery({ page: { size: 12 } }),
          };
        }
      };
      setComponentTemplate(createTemplateFactory({
        id: 'runtime-common-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(moduleID)},
        isStrictMode: true,
      }), ArticleCard.isolated);
    `;
    let runtime = runtimeFor({ [moduleID]: source });
    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'ArticleCard',
      'isolated',
    );
    let instance = bundle.templates[bundle.root]!.instance;

    assert.deepEqual(
      runtime.readComponentProperty(instance.handle, 'searchInputs', {
        model: {
          [sandboxRealmURLArgument]: 'https://realm.example/cards/',
        },
      }),
      {
        base: '@cardstack/base/string',
        ref: {
          module: 'https://realm.example/cards/periodic-element',
          name: 'PeriodicElement',
        },
        realm: 'https://realm.example/cards/',
        wire: { page: { size: 12 } },
      },
      'the facade exposes only JSON-producing helpers and restores realm identity',
    );
  });

  test('denies a module graph dependency that the fetch authority cannot read', async function (assert) {
    let source = `
      import secret from 'https://other-realm.example/private.js';
      export class ArticleCard { static isolated = secret; }
    `;
    let runtime = runtimeFor({ [`${MODULE_ID}?denied`]: source });

    await assert.rejects(
      runtime.evaluateTemplate(
        `${MODULE_ID}?denied`,
        'ArticleCard',
        'isolated',
      ),
      /unable to fetch https:\/\/other-realm\.example\/private\.js: not granted/,
    );
  });

  test('allows trusted schema and presentation modules through hardened facades', async function (assert) {
    let source = `
      import MarkdownField from 'https://cardstack.com/base/markdown';
      import WorkflowField from '@cardstack/catalog/fields/workflow';
      import NetworkIcon from '@cardstack/boxel-icons/network';
      import BoxelButton from '@cardstack/boxel-ui/components/button';
      import { array, concat, fn, get, hash } from '@ember/helper';
      import { on } from '@ember/modifier';
      import { getMenuItems } from '@cardstack/runtime-common';
      import {
        CardDef,
        Component,
        contains,
        field,
      } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class CatalogCard extends CardDef {
        static markdownField = MarkdownField;
        static workflowField = WorkflowField;
        static networkIcon = NetworkIcon;
        static boxelButton = BoxelButton;
        static fn = fn;
        static array = array;
        static concat = concat;
        static get = get;
        static hash = hash;
        static on = on;
        [getMenuItems]() { return []; }
      }
      field(CatalogCard.prototype, 'content', {
        initializer: () => contains(MarkdownField),
      });
      CatalogCard.isolated = class Isolated extends Component {};
      setComponentTemplate(createTemplateFactory({
        id: 'catalog-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(MODULE_ID)},
        isStrictMode: true,
      }), CatalogCard.isolated);
    `;

    let moduleID = `${MODULE_ID}?base-field`;
    let runtime = runtimeFor({ [moduleID]: source });
    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'CatalogCard',
      'isolated',
    );

    assert.strictEqual(bundle.templates[bundle.root]?.id, 'catalog-isolated');
    assert.deepEqual(
      await runtime.evaluateCardTypeMetadata(moduleID, 'CatalogCard'),
      {
        displayName: undefined,
        fields: {
          content: {
            kind: 'contains',
            type: {
              module: 'https://cardstack.com/base/markdown',
              name: 'default',
            },
          },
        },
        headerColor: null,
        hasCustomEditTemplate: false,
        hasCustomIsolatedTemplate: true,
        authoredTemplateFormats: ['isolated'],
        icon: undefined,
        prefersWideFormat: false,
      },
      'trusted field identities cross as inert descriptors',
    );
  });

  test('captures an unchanged compiled GTS card template', async function (assert) {
    let source = await transpileJS(
      SCOPED_GTS_CARD_SOURCE,
      '/story-modules.gts',
    );
    let moduleID = 'https://realm.example/cards/story-modules';
    let runtime = runtimeFor({ [moduleID]: source });

    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'RecipeCard',
      'isolated',
    );
    let descriptor = bundle.templates[bundle.root]!;

    assert.true(descriptor.isStrictMode);
    assert.ok(descriptor.block.includes('Ask the story'));
    assert.ok(descriptor.block.includes('Ingredients'));
    assert.strictEqual(descriptor.stylesheets.length, 1);
    assert.true(
      descriptor.stylesheets.every((stylesheet) =>
        stylesheet.endsWith('.glimmer-scoped.css'),
      ),
    );
  });

  test('rejects unscoped styles that would affect the shared host document', async function (assert) {
    let moduleID = 'https://realm.example/cards/unscoped-style';
    let source = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';

        export class RetroCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <article>Retro card</article>
              <style>body, button { font-family: serif; }</style>
            </template>
          };
        }
      `,
      '/unscoped-style.gts',
    );
    let runtime = runtimeFor({ [moduleID]: source });

    await assert.rejects(
      runtime.evaluateTemplate(moduleID, 'RetroCard', 'isolated'),
      /SES templates must use <style scoped>/,
    );
  });

  test('validates static inline styles and rejects dynamic inline styles before rendering', async function (assert) {
    let moduleID = 'https://realm.example/cards/inline-style';
    let safeSource = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';

        export class InlineCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <article style="width: 100%; color: rebeccapurple">Safe</article>
            </template>
          };
        }
      `,
      '/inline-style.gts',
    );
    let safeRuntime = runtimeFor({ [moduleID]: safeSource });
    await safeRuntime.evaluateTemplate(moduleID, 'InlineCard', 'isolated');
    assert.step('safe literal style accepted');

    let networkSource = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';

        export class InlineCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <article style="background: url(https://evil.example/steal)">Unsafe</article>
            </template>
          };
        }
      `,
      '/inline-style.gts',
    );
    await assert.rejects(
      runtimeFor({ [moduleID]: networkSource }).evaluateTemplate(
        moduleID,
        'InlineCard',
        'isolated',
      ),
      /network-bearing value/,
    );

    let dynamicSource = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';

        export class InlineCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            style = 'color: rebeccapurple';
            <template><article style={{this.style}}>Unsafe</article></template>
          };
        }
      `,
      '/inline-style.gts',
    );
    await assert.rejects(
      runtimeFor({ [moduleID]: dynamicSource }).evaluateTemplate(
        moduleID,
        'InlineCard',
        'isolated',
      ),
      /cannot use dynamic inline styles/,
    );
    assert.verifySteps(['safe literal style accepted']);
  });

  test('rejects a scoped template that compiles a document-global rule', async function (assert) {
    let moduleID = 'https://realm.example/cards/global-style';
    let source = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';

        export class GlobalCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <article>Global card</article>
              <style scoped>
                @font-face {
                  font-family: HostOverride;
                  src: local(Arial);
                }
                article { font-family: HostOverride; }
              </style>
            </template>
          };
        }
      `,
      '/global-style.gts',
    );
    let runtime = runtimeFor({ [moduleID]: source });
    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'GlobalCard',
      'isolated',
    );
    let descriptor = bundle.templates[bundle.root]!;
    let compiledCSS = decodeScopedCSSRequest(descriptor.stylesheets[0]!).css;

    assert.throws(
      () =>
        validateCompartmentCSS(compiledCSS, {
          requireScopedSelectors: true,
        }),
      /document-global rule/,
      'scoped selector rewriting does not localize global registrations, so the shared-document boundary rejects them',
    );
  });

  test('rejects declarative top-layer escape attributes in SES templates', async function (assert) {
    let moduleID = 'https://realm.example/cards/top-layer';
    for (let [attribute, markup] of [
      ['popover', '<aside popover="auto">Host overlay</aside>'],
      [
        'popovertarget',
        '<button popovertarget="overlay">Open</button><aside id="overlay">Overlay</aside>',
      ],
      [
        'commandfor',
        '<button commandfor="overlay" command="show-modal">Open</button><dialog id="overlay">Overlay</dialog>',
      ],
    ]) {
      let source = await transpileJS(
        `
          import { CardDef, Component } from '@cardstack/base/card-api';

          export class TopLayerCard extends CardDef {
            static isolated = class Isolated extends Component<typeof this> {
              <template>${markup}</template>
            };
          }
        `,
        '/top-layer.gts',
      );
      await assert.rejects(
        runtimeFor({ [moduleID]: source }).evaluateTemplate(
          moduleID,
          'TopLayerCard',
          'isolated',
        ),
        new RegExp(`cannot use the ${attribute} attribute`),
        `${attribute} cannot bypass the Host paint-containment boundary`,
      );
    }
  });

  test('preserves HTML comments in compiled GTS templates under SES', async function (assert) {
    let moduleID = 'https://realm.example/cards/commented-template';
    let source = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';

        export class CommentedCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <article>
                <!-- ordinary authored template comment -->
                <h1>Comment-safe template</h1>
              </article>
            </template>
          };
        }
      `,
      '/commented-template.gts',
    );
    let runtime = runtimeFor({ [moduleID]: source });

    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'CommentedCard',
      'isolated',
    );
    let descriptor = bundle.templates[bundle.root]!;

    assert.ok(descriptor.block.includes('Comment-safe template'));
    assert.ok(
      descriptor.block.includes('ordinary authored template comment'),
      'the HTML comment remains template data instead of becoming JS syntax',
    );
  });

  test('represents the safe modifier as a trusted host capability', async function (assert) {
    let moduleID = 'https://realm.example/cards/safe-modifier';
    let source = await transpileJS(
      `
        import { CardDef, Component } from '@cardstack/base/card-api';
        import { safeModifier } from '@cardstack/boxel-ui/modifiers';

        export class MeasuredCard extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            updateSize = (_size: { height: number; width: number }) => {};

            <template>
              <div {{safeModifier 'observe-size' this.updateSize}}></div>
            </template>
          };
        }
      `,
      '/safe-modifier.gts',
    );
    let runtime = runtimeFor({ [moduleID]: source });

    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'MeasuredCard',
      'isolated',
    );
    let descriptor = bundle.templates[bundle.root]!;

    assert.deepEqual(
      descriptor.scope.find(
        (reference) =>
          reference.kind === 'trusted-export' &&
          reference.name === 'safeModifier',
      ),
      {
        kind: 'trusted-export',
        module: '@cardstack/boxel-ui/modifiers',
        name: 'safeModifier',
      },
      'the modifier is rehydrated by trusted Ember outside the compartment',
    );
    assert.deepEqual(descriptor.instance.actions, ['updateSize']);
  });

  test('can grant inert document event lifecycle methods without exposing the DOM', async function (assert) {
    let moduleID = 'https://realm.example/cards/document-lifecycle';
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class LifecycleCard extends CardDef {}
      LifecycleCard.isolated = class Isolated extends Component {
        constructor(owner, args) {
          super(owner, args);
          if (document.body !== undefined || document.querySelector !== undefined) {
            throw new Error('shared DOM leaked through document facade');
          }
          document.addEventListener('keydown', this.handleKeyPress);
          document.removeEventListener('keydown', this.handleKeyPress);
        }
        handleKeyPress = () => {};
      };
      setComponentTemplate(createTemplateFactory({
        id: 'document-lifecycle-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(moduleID)},
        isStrictMode: true,
      }), LifecycleCard.isolated);
    `;
    let runtime = new RealmCompartmentModuleRuntime(
      'https://realm.example/cards/',
      {
        fetch: async (input) =>
          (input instanceof Request ? input.url : String(input)) === moduleID
            ? new Response(source, { status: 200 })
            : new Response('not granted', { status: 403 }),
        resolveImport: (moduleIdentifier) =>
          moduleIdentifier.startsWith('@')
            ? `https://packages.example/${moduleIdentifier}`
            : moduleIdentifier,
        documentFacade: Object.freeze({
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      },
    );

    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'LifecycleCard',
      'isolated',
    );

    assert.ok(bundle.templates[bundle.root]);
    assert.strictEqual(runtime.ambientReport.document, 'object');
  });

  test('can grant explicit pure math randomness without other browser authority', async function (assert) {
    let moduleID = 'https://realm.example/cards/randomized';
    let source = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      import { setComponentTemplate } from '@ember/component';
      import { createTemplateFactory } from '@ember/template-factory';

      export class RandomizedCard extends CardDef {}
      RandomizedCard.isolated = class Isolated extends Component {
        roll = Math.floor(Math.random() * 10);
      };
      setComponentTemplate(createTemplateFactory({
        id: 'randomized-isolated',
        block: ${JSON.stringify(TEMPLATE_BLOCK)},
        moduleName: ${JSON.stringify(moduleID)},
        isStrictMode: true,
      }), RandomizedCard.isolated);
    `;
    let runtime = new RealmCompartmentModuleRuntime(
      'https://realm.example/cards/',
      {
        fetch: async (input) =>
          (input instanceof Request ? input.url : String(input)) === moduleID
            ? new Response(source, { status: 200 })
            : new Response('not granted', { status: 403 }),
        resolveImport: (moduleIdentifier) =>
          moduleIdentifier.startsWith('@')
            ? `https://packages.example/${moduleIdentifier}`
            : moduleIdentifier,
        mathFacade: Object.freeze({
          floor: Math.floor,
          random: () => 0.42,
        }),
      },
    );

    let bundle = await runtime.evaluateTemplate(
      moduleID,
      'RandomizedCard',
      'isolated',
    );

    assert.deepEqual(bundle.templates[bundle.root]?.instance.state, {
      roll: 4,
    });
    assert.strictEqual(runtime.ambientReport.window, 'undefined');
    assert.strictEqual(runtime.ambientReport.fetch, 'undefined');
  });

  test('captures decorated cards that use link fields and card getters', async function (assert) {
    let moduleID = 'https://realm.example/cards/style';
    let source = await transpileJS(
      `
        import {
          CardDef,
          Component,
          FieldDef,
          contains,
          containsMany,
          field,
          linksTo,
        } from '@cardstack/base/card-api';
        import { action } from '@ember/object';
        import { tracked } from '@glimmer/tracking';
        import StringField from '@cardstack/base/string';
        import MarkdownField from '@cardstack/base/markdown';
        import ImageDef from '@cardstack/base/image-file-def';
        import PaletteIcon from '@cardstack/boxel-icons/palette';

        export class IngredientField extends FieldDef {}

        export class Style extends CardDef {
          static displayName = 'Style';
          static icon = PaletteIcon;

          @field name = contains(StringField);
          @field heroImage = linksTo(() => ImageDef, { searchable: true });
          @field relatedStyle = linksTo(() => Style);
          @field definingRules = containsMany(StringField);
          @field ingredients = containsMany(IngredientField);
          @field prose = contains(MarkdownField);

          get cardTitle() {
            return this.name || this.constructor.displayName;
          }

          static isolated = class Isolated extends Component<typeof this> {
            @tracked expanded = false;

            @action toggleExpanded() {
              this.expanded = !this.expanded;
            }

            <template>
              <article>
                <h1>{{@model.name}}</h1>
                <@fields.prose />
              </article>
            </template>
          };
        }
      `,
      '/style.gts',
    );
    let runtime = runtimeFor({ [moduleID]: source });

    let bundle = await runtime.evaluateTemplate(moduleID, 'Style', 'isolated');
    let metadata = await runtime.evaluateCardTypeMetadata(moduleID, 'Style');

    assert.ok(bundle.templates[bundle.root], 'captures the isolated template');
    assert.deepEqual(metadata.fields, {
      name: {
        kind: 'contains',
        type: {
          module: '@cardstack/base/string',
          name: 'default',
        },
      },
      heroImage: {
        kind: 'linksTo',
        type: {
          module: '@cardstack/base/image-file-def',
          name: 'default',
        },
      },
      relatedStyle: {
        kind: 'linksTo',
        type: {
          module: '@cardstack/base/card-api',
          name: 'CardDef',
        },
      },
      definingRules: {
        kind: 'containsMany',
        type: {
          module: '@cardstack/base/string',
          name: 'default',
        },
      },
      ingredients: {
        kind: 'containsMany',
        type: {
          module: '@cardstack/base/card-api',
          name: 'FieldDef',
        },
      },
      prose: {
        kind: 'contains',
        type: {
          module: '@cardstack/base/markdown',
          name: 'default',
        },
      },
    });
  });
});
