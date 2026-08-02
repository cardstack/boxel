import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Service from '@ember/service';
import { click, settled, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ri, rri } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardRenderer from '@cardstack/host/components/card-renderer';
import RealmSandboxRender from '@cardstack/host/components/realm-sandbox-render';
import {
  getOpaqueRealmCardState,
  opaqueRealmCardState,
} from '@cardstack/host/lib/realm-sandbox-boundary';

import { percySnapshot, testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type {
  BaseDef,
  BaseDefComponent,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';

let cardApi: typeof import('@cardstack/base/card-api');
let string: typeof import('@cardstack/base/string');

class MockLocalIndexer extends Service {
  url = new URL(testRealmURL);
}

module('Integration | preview', function (hooks) {
  let loader: Loader;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');
    this.owner.register('service:local-indexer', MockLocalIndexer);
  });

  test('renders card', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class TestCard extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-firstName><@fields.firstName /></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}test-cards`, { TestCard });
    let card = new TestCard({ firstName: 'Mango ' });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><CardRenderer @card={{card}} /></template>
      },
    );
    await waitFor('[data-test-firstName]'); // we need to wait for the card instance to load
    assert.dom('[data-test-firstName]').hasText('Mango');
  });

  test('trusts Base and Catalog Realm types and sandboxes user realm types', function (assert) {
    let sandbox = getService('realm-sandbox');
    let loaderService = getService('loader-service');

    assert.false(
      sandbox.shouldUseOpaqueCard({
        module: rri('https://cardstack.com/base/card-api'),
        name: 'CardDef',
      }),
      'Base Realm definitions stay on the trusted host runtime',
    );
    assert.false(
      sandbox.shouldUseOpaqueCard({
        module: rri('@cardstack/catalog/fields/workflow'),
        name: 'WorkflowField',
      }),
      'Catalog Realm definitions stay on the trusted host runtime',
    );
    assert.true(
      sandbox.shouldUseOpaqueCard({
        module: rri(`${testRealmURL}article-card`),
        name: 'ArticleCard',
      }),
      'ordinary realm definitions become opaque sandbox records',
    );

    let catalogRef = {
      module: rri('@cardstack/catalog/fields/workflow'),
      name: 'WorkflowField',
    };
    let catalogLoader = sandbox.loaderForTrustedCard(catalogRef);
    assert.notStrictEqual(
      loaderService.baseLoader,
      loaderService.loader,
      'Base has a loader separate from the host authored-module loader',
    );
    assert.strictEqual(
      sandbox.loaderForTrustedCard({
        module: rri('https://cardstack.com/base/card-api'),
        name: 'CardDef',
      }),
      loaderService.baseLoader,
      'Base cards use the app-wide Base loader',
    );
    assert.strictEqual(
      sandbox.loaderForTrustedCard(catalogRef),
      catalogLoader,
      'trusted realm cards reuse one loader for their realm',
    );
    assert.notStrictEqual(
      catalogLoader,
      loaderService.baseLoader,
      'a non-Base trusted realm does not evaluate into the Base loader',
    );
  });

  test('deserializes a regular realm card without importing its type into the host', async function (assert) {
    let moduleURL = `${testRealmURL}authoritative-sandbox-card`;
    let id = `${testRealmURL}authoritative-sandbox-instance`;
    let resource = {
      id: rri(id),
      type: 'card' as const,
      attributes: {
        title: 'Opaque until the compartment renders it',
        count: 3,
      },
      meta: {
        adoptsFrom: {
          module: rri(moduleURL),
          name: 'AuthoritativeSandboxCard',
        },
        realmURL: ri(testRealmURL),
      },
    };
    let doc = { data: resource };

    assert.false(loader.isModuleLoaded(moduleURL));
    let card = await getService('store').add(doc, {
      doNotPersist: true,
      relativeTo: new URL(id),
    });

    assert.false(
      loader.isModuleLoaded(moduleURL),
      'Store did not evaluate the realm module in the host Loader',
    );
    assert.strictEqual(
      (card as unknown as { title: string }).title,
      resource.attributes.title,
    );
    let snapshot = getOpaqueRealmCardState(card)?.snapshot;
    assert.deepEqual(
      Object.fromEntries(Object.entries(snapshot ?? {})),
      {
        id: rri(id),
        title: resource.attributes.title,
        count: 3,
      },
      'the enumerable opaque snapshot remains plain card data',
    );
    assert.strictEqual(
      (snapshot?.constructor as { displayName?: string }).displayName,
      'AuthoritativeSandboxCard',
      'templates receive inert constructor presentation metadata',
    );
    assert.false(
      Object.keys(snapshot ?? {}).includes('constructor'),
      'constructor metadata does not enter JSON-only compartment args',
    );
  });

  test('renders an inert compartment template with trusted scoped styles', async function (assert) {
    let { CardDef } = cardApi;
    class TestCard extends CardDef {}
    class InertTemplate extends GlimmerComponent<{
      Args: { model: { title: string } };
    }> {
      readonly trustedHostTemplate = true;

      <template>
        <p class='sandbox-style-proof' data-test-sandbox-style-proof>
          {{@model.title}}
        </p>
      </template>
    }
    let card = new TestCard({});
    let sandbox = {
      component: InertTemplate as unknown as BaseDefComponent,
      model: { title: 'Compartment template' },
      fields: {},
      styles: ['.sandbox-style-proof { color: rgb(1 2 3); }'],
      principal: testRealmURL,
      markerBacked: false,
      theme: {
        css: ':root { --background: #f7f8fa; --foreground: #16161a; }',
        id: `${testRealmURL}Theme/editorial`,
        scope: `${testRealmURL}Theme/editorial-test-scope`,
      },
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <RealmSandboxRender
            @card={{card}}
            @format='fitted'
            @sandbox={{sandbox}}
          />
        </template>
      },
    );

    assert
      .dom('[data-test-sandbox-style-proof]')
      .hasText('Compartment template');
    assert
      .dom(document.head.querySelector('[data-realm-sandbox-stylesheet]'))
      .includesText('.sandbox-style-proof { color: rgb(1 2 3); }');
    assert
      .dom('.realm-sandbox-render')
      .hasClass('boxel-card-container--themed')
      .hasAttribute(
        'data-boxel-theme-scope',
        `${testRealmURL}Theme/editorial-test-scope`,
      );
    let containerStyle = getComputedStyle(
      document.querySelector('.realm-sandbox-render')!,
    );
    assert.strictEqual(containerStyle.containerName, 'fitted-card');
    assert.strictEqual(containerStyle.containerType, 'size');
    assert.strictEqual(containerStyle.minHeight, '40px');
    assert.strictEqual(containerStyle.maxHeight, '600px');
    assert.strictEqual(containerStyle.overflow, 'hidden');
    assert.strictEqual(
      containerStyle.contain,
      'content',
      'the host box traps positioned descendants and clips authored paint',
    );
    assert.strictEqual(
      containerStyle.isolation,
      'isolate',
      'authored blending and z-index stay in the card stacking context',
    );
    assert
      .dom('[data-boxel-theme-style]')
      .includesText('--background: #f7f8fa');
  });

  test('[SOAK-03] rendered cross-realm navigation releases departed runtimes and styles', async function (assert) {
    let { CardDef } = cardApi;
    class TestCard extends CardDef {}
    let templateForNavigation = () =>
      class InertTemplate extends GlimmerComponent<{
        Args: { model: { navigation: number } };
      }> {
        <template>
          <p data-test-rendered-soak>{{@model.navigation}}</p>
        </template>
      };
    let realmSandbox = getService('realm-sandbox') as unknown as {
      compartmentRuntimeFor(principal: string): unknown;
      evictIdleRealmRuntimes(): void;
      metricsSnapshot(): {
        activeCompartments: number;
        activeCompartmentLoads: number;
        cachedCompartmentTemplates: number;
      };
    };
    let collectGarbage = (globalThis as typeof globalThis & { gc?: () => void })
      .gc;
    let memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number };
      }
    ).memory;
    let warmHeap: number | undefined;

    let driver!: TestDriver;
    class TestDriver extends GlimmerComponent {
      @tracked renderState?: {
        card: BaseDef;
        sandbox: {
          component: BaseDefComponent;
          model: { navigation: number };
          fields: Record<string, BaseDefComponent>;
          styles: string[];
          principal: string;
          markerBacked: boolean;
        };
      };

      constructor(owner: Owner, args: Record<string, never>) {
        super(owner, args);
        driver = this;
      }

      navigate(
        card: BaseDef,
        sandbox: NonNullable<this['renderState']>['sandbox'],
      ) {
        this.renderState = { card, sandbox };
      }

      clear() {
        this.renderState = undefined;
      }

      <template>
        {{#if this.renderState}}
          <RealmSandboxRender
            @card={{this.renderState.card}}
            @format='fitted'
            @sandbox={{this.renderState.sandbox}}
          />
        {{/if}}
      </template>
    }

    await renderComponent(TestDriver);
    for (let navigation = 0; navigation < 512; navigation++) {
      let principal = `https://rendered-realm-${navigation}.example/`;
      let card = new TestCard({});
      Object.defineProperty(card, opaqueRealmCardState, {
        value: {
          typeRef: { module: `${principal}card`, name: 'Card' },
          principal,
          document: { data: { type: 'card' } },
          snapshot: {},
          presentation: { headerColor: null, prefersWideFormat: false },
        },
      });
      realmSandbox.compartmentRuntimeFor(principal);
      driver.navigate(card, {
        component: templateForNavigation() as unknown as BaseDefComponent,
        model: { navigation },
        fields: {},
        styles: [
          `[data-scopedcss-render-soak-${navigation % 8}] { color: rgb(${navigation % 255} 0 0); }`,
        ],
        principal,
        markerBacked: false,
      });
      await settled();
      realmSandbox.evictIdleRealmRuntimes();

      if (navigation % 64 === 0) {
        assert.dom('[data-test-rendered-soak]').hasText(String(navigation));
        assert.strictEqual(
          realmSandbox.metricsSnapshot().activeCompartments,
          1,
          `navigation ${navigation} retains only its rendered realm`,
        );
        assert.strictEqual(
          document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
          1,
          `navigation ${navigation} retains one authored stylesheet`,
        );
      }
      if (navigation === 63 && collectGarbage && memory) {
        collectGarbage();
        collectGarbage();
        warmHeap = memory.usedJSHeapSize;
      }
    }

    driver.clear();
    await settled();
    realmSandbox.evictIdleRealmRuntimes();
    let final = realmSandbox.metricsSnapshot();
    assert.strictEqual(final.activeCompartments, 0, 'all runtimes exit');
    assert.strictEqual(final.activeCompartmentLoads, 0, 'no loads remain');
    assert.strictEqual(
      final.cachedCompartmentTemplates,
      0,
      'no templates remain',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      0,
      'all rendered sandbox styles exit',
    );
    if (warmHeap != null && collectGarbage && memory) {
      collectGarbage();
      collectGarbage();
      let growth = memory.usedJSHeapSize - warmHeap;
      let growthMB = (growth / 1024 / 1024).toFixed(2);
      console.log(
        `REALM_SANDBOX_RENDER_SOAK navigations=512 heap_growth_mb=${growthMB} active_compartments=${final.activeCompartments} active_loads=${final.activeCompartmentLoads} cached_templates=${final.cachedCompartmentTemplates}`,
      );
      assert.true(
        growth <= 16 * 1024 * 1024,
        `rendered steady-state heap grows by at most 16 MiB (actual ${growthMB} MiB)`,
      );
    }
  });

  test('routes sandbox navigation through a realm-relative viewCard capability', async function (assert) {
    let { CardDef } = cardApi;
    class TestCard extends CardDef {}
    class InertNavigation extends GlimmerComponent<{
      Args: {
        viewCard: (
          target: Parameters<ViewCardFn>[0],
          format?: Parameters<ViewCardFn>[1],
          optionsOrEvent?: Parameters<ViewCardFn>[2] | Event,
        ) => void;
      };
    }> {
      target = new URL(
        'Article/one',
        testRealmURL,
      ) as Parameters<ViewCardFn>[0];
      outsideTarget = new URL(
        'https://other-realm.example/Article/two',
      ) as Parameters<ViewCardFn>[0];

      <template>
        <button
          type='button'
          data-test-sandbox-view-card
          {{on 'click' (fn @viewCard this.target 'isolated')}}
        >
          Open card
        </button>
        <button
          type='button'
          data-test-sandbox-view-card-outside-realm
          {{on 'click' (fn @viewCard this.outsideTarget 'isolated')}}
        >
          Open outside-realm card
        </button>
      </template>
    }
    let card = new TestCard({});
    let sandbox = {
      component: InertNavigation as unknown as BaseDefComponent,
      model: {},
      fields: {},
      styles: [],
      principal: testRealmURL,
      markerBacked: false,
    };
    let calls: Array<Parameters<ViewCardFn>> = [];

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        viewCard: ViewCardFn = (...args) => calls.push(args);

        <template>
          <RealmSandboxRender
            @card={{card}}
            @sandbox={{sandbox}}
            @viewCard={{this.viewCard}}
          />
        </template>
      },
    );

    await click('[data-test-sandbox-view-card]');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.[0], rri(`${testRealmURL}Article/one`));
    assert.strictEqual(calls[0]?.[1], 'isolated');

    await click('[data-test-sandbox-view-card-outside-realm]');
    assert.strictEqual(
      calls.length,
      1,
      'the host boundary rejects a cross-realm navigation effect',
    );
  });

  test('renders head meta tags preview for a card head format', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class HeadCard extends CardDef {
      @field cardTitle = contains(StringField);
      @field cardDescription = contains(StringField);
      @field image = contains(StringField);
      @field url = contains(StringField);

      static head = class Head extends Component<typeof this> {
        <template>
          {{! template-lint-disable no-forbidden-elements }}
          <title>{{@model.cardTitle}}</title>
          <meta name='description' content={{@model.cardDescription}} />
          <meta property='og:url' content={{@model.url}} />
          <meta property='og:image' content={{@model.image}} />
          <meta name='twitter:card' content='summary' />
        </template>
      };
    }

    let headCard = new HeadCard({
      cardTitle: 'Preview Title',
      cardDescription: 'Preview description',
      image: 'https://example.com/cover.png',
      url: 'https://example.com/post',
    });

    class TestDriver extends GlimmerComponent<{ Args: { format?: Format } }> {
      card = headCard;

      <template>
        <CardRenderer @card={{this.card}} @format={{@format}} />
      </template>
    }

    await renderComponent(TestDriver, 'head');

    await percySnapshot(assert);

    assert.dom('.google-title').hasText('Preview Title');
    assert.dom('.google-description').hasText('Preview description');
    assert.dom('.google-site-name').hasText('example.com');
    assert.dom('.google-breadcrumb').includesText('example.com');
    assert.dom('.google-breadcrumb').includesText('post');
    assert
      .dom('.facebook-image img')
      .hasAttribute('src', 'https://example.com/cover.png');
    assert
      .dom('.twitter-image img')
      .hasAttribute('src', 'https://example.com/cover.png');
    assert
      .dom('[data-test-head-markup]')
      .includesText(
        '<meta property="og:url" content="https://example.com/post">',
      );
    assert
      .dom('[data-test-head-markup]')
      .includesText('<meta name="description" content="Preview description">');

    let rawMarkup =
      document.querySelector('[data-test-head-markup]')?.textContent ?? '';
    assert.notOk(
      rawMarkup.includes('boxel-card-container'),
      'raw head markup does not include the card container wrapper',
    );
  });

  test('renders head preview fallbacks without image or favicon', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class FallbackHeadCard extends CardDef {
      @field cardTitle = contains(StringField);
      @field url = contains(StringField);

      static head = class Head extends Component<typeof this> {
        <template>
          {{! template-lint-disable no-forbidden-elements }}
          <title>{{@model.cardTitle}}</title>
          <meta property='og:type' content='article' />
          <meta property='og:url' content={{@model.url}} />
        </template>
      };
    }

    let fallbackCard = new FallbackHeadCard({
      cardTitle: 'Fallback Title',
      url: 'https://example.com/no-image',
    });

    class TestDriver extends GlimmerComponent<{ Args: { format?: Format } }> {
      card = fallbackCard;

      <template>
        <CardRenderer @card={{this.card}} @format={{@format}} />
      </template>
    }

    await renderComponent(TestDriver, 'head');

    assert.dom('.google-title').hasText('Fallback Title');
    assert
      .dom('.google-description')
      .hasText('Add title and description meta tags to see them here.');
    assert.dom('.facebook-domain').hasText('example.com');
    assert.dom('.twitter-domain').includesText('example.com');
    assert.dom('.google-favicon img').doesNotExist();
    assert.dom('.google-favicon span').hasText('E');
    assert.dom('.facebook-image img').doesNotExist();
    assert.dom('.twitter-image img').doesNotExist();
    assert
      .dom('[data-test-head-markup]')
      .includesText('<meta property="og:type" content="article">');
  });

  test('toggling between isolated and edit reuses the component instance when the templates are reference-equal', async function (assert) {
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;

    class SharedTemplate extends GlimmerComponent<{
      Args: { format: Format };
    }> {
      @tracked counter = 0;
      bump = () => this.counter++;
      <template>
        <div data-test-shared>
          <span data-test-shared-format>{{@format}}</span>
          <span data-test-shared-counter>{{this.counter}}</span>
          <button {{on 'click' this.bump}} data-test-shared-bump>bump</button>
        </div>
      </template>
    }
    class SharedTemplateCard extends CardDef {
      @field firstName = contains(StringField);
      static isolated = SharedTemplate;
      static edit = SharedTemplate;
    }
    loader.shimModule(`${testRealmURL}shared-template-card`, {
      SharedTemplateCard,
    });

    let cardInstance = new SharedTemplateCard({ firstName: 'Mango' });

    class TestDriver extends GlimmerComponent {
      @tracked format: Format = 'isolated';
      card = cardInstance;
      flip = () => {
        this.format = this.format === 'isolated' ? 'edit' : 'isolated';
      };
      <template>
        <button {{on 'click' this.flip}} data-test-flip-format>flip</button>
        <CardRenderer @card={{this.card}} @format={{this.format}} />
      </template>
    }

    await renderComponent(TestDriver);
    await waitFor('[data-test-shared]');

    let initialNode = document.querySelector('[data-test-shared]');
    assert.dom('[data-test-shared-format]').hasText('isolated');
    assert.dom('[data-test-shared-counter]').hasText('0');

    await click('[data-test-shared-bump]');
    assert.dom('[data-test-shared-counter]').hasText('1');

    await click('[data-test-flip-format]');

    assert.dom('[data-test-shared-format]').hasText('edit');
    assert
      .dom('[data-test-shared-counter]')
      .hasText(
        '1',
        'tracked component state survives the format flip (no remount)',
      );
    assert.strictEqual(
      document.querySelector('[data-test-shared]'),
      initialNode,
      'the same DOM node is reused across the format toggle',
    );

    await click('[data-test-flip-format]');
    assert.dom('[data-test-shared-format]').hasText('isolated');
    assert
      .dom('[data-test-shared-counter]')
      .hasText('1', 'state still survives flipping back to isolated');
  });

  test('toggling between isolated and edit remounts when the templates are different', async function (assert) {
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;

    class IsolatedTemplate extends GlimmerComponent {
      @tracked counter = 0;
      bump = () => this.counter++;
      <template>
        <div data-test-isolated-template>
          <span data-test-isolated-counter>{{this.counter}}</span>
          <button {{on 'click' this.bump}} data-test-isolated-bump>bump</button>
        </div>
      </template>
    }
    const EditTemplate = <template>
      <div data-test-edit-template>edit mode</div>
    </template>;
    class DistinctTemplateCard extends CardDef {
      @field firstName = contains(StringField);
      static isolated = IsolatedTemplate;
      static edit = EditTemplate;
    }
    loader.shimModule(`${testRealmURL}distinct-template-card`, {
      DistinctTemplateCard,
    });

    let cardInstance = new DistinctTemplateCard({ firstName: 'Mango' });

    class TestDriver extends GlimmerComponent {
      @tracked format: Format = 'isolated';
      card = cardInstance;
      flip = () => {
        this.format = this.format === 'isolated' ? 'edit' : 'isolated';
      };
      <template>
        <button {{on 'click' this.flip}} data-test-flip-format>flip</button>
        <CardRenderer @card={{this.card}} @format={{this.format}} />
      </template>
    }

    await renderComponent(TestDriver);
    await waitFor('[data-test-isolated-template]');

    await click('[data-test-isolated-bump]');
    assert.dom('[data-test-isolated-counter]').hasText('1');

    await click('[data-test-flip-format]');

    assert.dom('[data-test-isolated-template]').doesNotExist();
    assert.dom('[data-test-edit-template]').exists();

    await click('[data-test-flip-format]');

    assert.dom('[data-test-edit-template]').doesNotExist();
    assert.dom('[data-test-isolated-template]').exists();
    assert
      .dom('[data-test-isolated-counter]')
      .hasText(
        '0',
        'distinct templates remount; tracked counter resets on each toggle',
      );
  });

  test('toggling a card format keeps a contained field mounted when its embedded and edit slots are reference-equal', async function (assert) {
    let { field, contains, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;

    class SharedFieldTemplate extends GlimmerComponent<{
      Args: { format: Format };
    }> {
      @tracked counter = 0;
      bump = () => this.counter++;
      <template>
        <div data-test-shared-field>
          <span data-test-shared-field-format>{{@format}}</span>
          <span data-test-shared-field-counter>{{this.counter}}</span>
          <button {{on 'click' this.bump}} data-test-shared-field-bump>
            bump
          </button>
        </div>
      </template>
    }
    class SharedFormatField extends FieldDef {
      @field name = contains(StringField);
      static embedded = SharedFieldTemplate;
      static edit = SharedFieldTemplate;
    }
    class FieldHostTemplate extends Component<typeof FieldHostCard> {
      <template>
        <div data-test-field-host>
          <@fields.detail />
        </div>
      </template>
    }
    class FieldHostCard extends CardDef {
      @field detail = contains(SharedFormatField);
      static isolated = FieldHostTemplate;
      static edit = FieldHostTemplate;
    }
    loader.shimModule(`${testRealmURL}field-host-card`, {
      SharedFormatField,
      FieldHostCard,
    });

    let cardInstance = new FieldHostCard({
      detail: new SharedFormatField({ name: 'Mango' }),
    });

    class TestDriver extends GlimmerComponent {
      @tracked format: Format = 'isolated';
      card = cardInstance;
      flip = () => {
        this.format = this.format === 'isolated' ? 'edit' : 'isolated';
      };
      <template>
        <button {{on 'click' this.flip}} data-test-flip-format>flip</button>
        <CardRenderer @card={{this.card}} @format={{this.format}} />
      </template>
    }

    await renderComponent(TestDriver);
    await waitFor('[data-test-shared-field]');

    let initialNode = document.querySelector('[data-test-shared-field]');
    assert.dom('[data-test-shared-field-format]').hasText('embedded');

    await click('[data-test-shared-field-bump]');
    assert.dom('[data-test-shared-field-counter]').hasText('1');

    await click('[data-test-flip-format]');

    assert.dom('[data-test-shared-field-format]').hasText('edit');
    assert
      .dom('[data-test-shared-field-counter]')
      .hasText(
        '1',
        'tracked field state survives the format flip when embedded === edit',
      );
    assert.strictEqual(
      document.querySelector('[data-test-shared-field]'),
      initialNode,
      'the same field DOM node is reused across the format toggle',
    );
  });

  test('getComponent returns a stable BoxComponent reference for the same model across calls', async function (assert) {
    // Regression test for the Box.create cache. `card-renderer.gts`'s
    // `renderedCard` getter calls `getComponent(card)` on every reactive
    // re-render. Without the WeakMap of root Boxes, each call constructs
    // a fresh Box → `componentCache` (keyed on Box) misses → a brand-new
    // FieldComponent class is returned. Glimmer's `<this.renderedCard />`
    // then sees a different class reference and remounts the entire card
    // tree, defeating the identity short-circuit downstream.
    //
    // This test fails (returns two different classes) if Box.create stops
    // caching root boxes, regardless of any DOM-level Glimmer behavior.
    let { field, contains, CardDef, Component, getComponent } = cardApi;
    let { default: StringField } = string;

    class StableCard extends CardDef {
      @field name = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-stable><@fields.name /></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}stable-card`, { StableCard });

    let card = new StableCard({ name: 'Mango' });

    let firstCall = getComponent(card);
    let secondCall = getComponent(card);
    let thirdCall = getComponent(card);

    assert.strictEqual(
      firstCall,
      secondCall,
      'second getComponent call returns the same reference (cache hit)',
    );
    assert.strictEqual(
      secondCall,
      thirdCall,
      'third getComponent call returns the same reference (cache hit)',
    );

    // Different model → different reference (sanity check that we are
    // caching by model, not globally).
    let other = new StableCard({ name: 'Pinto' });
    assert.notStrictEqual(
      getComponent(other),
      firstCall,
      'a different model returns a different component reference',
    );
  });
});
