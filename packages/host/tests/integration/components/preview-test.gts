import { on } from '@ember/modifier';
import Service from '@ember/service';
import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { relativeTo, rri } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardRenderer from '@cardstack/host/components/card-renderer';

import { percySnapshot, testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { Format } from '@cardstack/base/card-api';

let cardApi: typeof import('@cardstack/base/card-api');
let string: typeof import('@cardstack/base/string');

class MockLocalIndexer extends Service {
  url = new URL(testRealmURL);
}

function containsExecutableValue(value: unknown): boolean {
  if (typeof value === 'function') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsExecutableValue);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsExecutableValue);
  }
  return false;
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

  test('Direct runtime keeps component definitions local and emits a cloneable semantic record', async function (assert) {
    let { field, contains, CardDef, CardInfoField, Component } = cardApi;
    let { default: StringField } = string;

    class RuntimeCard extends CardDef {
      static displayName = 'Runtime Card';
      static headerColor = '#112233';
      static prefersWideFormat = true;

      @field firstName = contains(StringField, {
        description: 'The name shown by the card',
        configuration: function (this: RuntimeCard) {
          return { label: `Name for ${this.firstName}` };
        },
      });
      @field greeting = contains(StringField, {
        computeVia: function (this: RuntimeCard) {
          return `Hello, ${this.firstName}`;
        },
      });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-runtime-card><@fields.greeting /></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}direct-runtime-card`, { RuntimeCard });

    let card = new RuntimeCard({
      firstName: 'Mango',
      cardInfo: new CardInfoField({
        name: 'Mango Runtime',
        summary: 'A Direct runtime fixture',
        cardThumbnailURL: 'https://example.com/mango.png',
      }),
    });
    let runtime = getService('direct-boxel-runtime').runtime;

    let firstSlot = runtime.getRenderSlot(card);
    let secondSlot = runtime.getRenderSlot(card);
    let record = await runtime.buildRenderRecord(card);

    assert.strictEqual(
      firstSlot,
      secondSlot,
      'the Direct runtime preserves render-slot identity',
    );
    assert.strictEqual(firstSlot.owner, 'direct');
    assert.strictEqual(
      typeof firstSlot.component,
      'function',
      'the Host-local render slot owns the executable component',
    );
    assert.deepEqual(
      structuredClone(record),
      record,
      'the semantic record is structured-cloneable',
    );
    assert.false(
      containsExecutableValue(record),
      'the semantic record does not contain executable values',
    );
    assert.strictEqual(record.boxel.boxelKind, 'card');
    assert.strictEqual(record.boxel.presentation.displayName, 'Runtime Card');
    assert.strictEqual(record.boxel.presentation.headerColor, '#112233');
    assert.true(record.boxel.presentation.prefersWideFormat);
    assert.strictEqual(record.presentation.title, 'Mango Runtime');
    assert.strictEqual(record.presentation.summary, 'A Direct runtime fixture');
    assert.strictEqual(
      record.presentation.thumbnailURL,
      'https://example.com/mango.png',
    );

    let firstName = record.instance.fields.find(
      (field) => field.fieldName === 'firstName',
    );
    let greeting = record.instance.fields.find(
      (field) => field.fieldName === 'greeting',
    );
    assert.deepEqual(firstName?.resolvedConfiguration, {
      label: 'Name for Mango',
    });
    assert.deepEqual(firstName?.presentation, {
      description: 'The name shown by the card',
    });
    assert.strictEqual(greeting?.value, 'Hello, Mango');

    let isolated = record.boxel.formats.find(
      (format) => format.format === 'isolated',
    );
    let edit = record.boxel.formats.find((format) => format.format === 'edit');
    assert.strictEqual(isolated?.provider.kind, 'authored');
    assert.strictEqual(edit?.provider.kind, 'trusted-base');

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><CardRenderer @card={{card}} /></template>
      },
    );
    await waitFor('[data-test-runtime-card]');
    assert
      .dom('[data-test-runtime-card]')
      .hasText('Hello, Mango', 'CardRenderer renders the Direct-owned slot');
  });

  test('Capsule field portals keep Base native and route authored FieldDefs through an explicit boundary', async function (assert) {
    let { field, contains, CardDef, Component, FieldDef } = cardApi;
    let { default: StringField } = string;

    class AuthoredDetails extends FieldDef {
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span>authored details</span>
        </template>
      };
    }

    class BoundaryCard extends CardDef {
      @field name = contains(StringField);
      @field details = contains(AuthoredDetails);
    }

    loader.shimModule(`${testRealmURL}boundary-card`, {
      AuthoredDetails,
      BoundaryCard,
    });
    let card = new BoundaryCard({
      name: 'Ada',
      details: new AuthoredDetails(),
    });
    card[relativeTo] = rri(`${testRealmURL}BoundaryCard/one`);
    let direct = getService('direct-boxel-runtime').runtime;
    let directFields = direct.getRenderSlot(card)
      .component as unknown as Record<string, unknown>;
    let fields = await getService('boxel-execution').fieldPortalsFor(card);

    assert.strictEqual(
      fields.name,
      directFields.name,
      'a trusted Base StringField remains a native Host portal',
    );
    assert.notStrictEqual(
      fields.details,
      directFields.details,
      'an authored FieldDef cannot reuse the Host Direct renderer',
    );
    assert.strictEqual(
      (fields.details as unknown as { relativeTo?: string }).relativeTo,
      `${testRealmURL}BoundaryCard/one`,
      'the authored portal preserves the canonical relative module base',
    );
  });

  test('Direct runtime preserves main glimmer-scoped-css confinement', async function (assert) {
    let { CardDef, Component } = cardApi;

    class ScopedRuntimeCard extends CardDef {
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div
            class='direct-runtime-css-canary'
            data-test-direct-runtime-css-canary
          >
            Scoped card content
          </div>
          <style scoped>
            .direct-runtime-css-canary {
              outline: 7px solid rgb(1, 2, 3);
            }
          </style>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}direct-runtime-scoped-card`, {
      ScopedRuntimeCard,
    });

    let card = new ScopedRuntimeCard({});
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div class='direct-runtime-css-canary' data-test-host-css-canary>
            Host content
          </div>
          <CardRenderer @card={{card}} />
        </template>
      },
    );
    await waitFor('[data-test-direct-runtime-css-canary]');

    let cardCanary = document.querySelector<HTMLElement>(
      '[data-test-direct-runtime-css-canary]',
    );
    let hostCanary = document.querySelector<HTMLElement>(
      '[data-test-host-css-canary]',
    );
    assert.ok(cardCanary, 'the Direct-owned card component rendered');
    assert.ok(hostCanary, 'the Host canary rendered outside the card');

    let scopeAttribute = Array.from(cardCanary?.attributes ?? [])
      .map((attribute) => attribute.localName)
      .find((attributeName) => attributeName.startsWith('data-scopedcss-'));
    assert.ok(
      scopeAttribute,
      'main glimmer-scoped-css annotated the Direct-owned card element',
    );
    assert.false(
      hostCanary?.hasAttribute(scopeAttribute ?? ''),
      'the Host element does not receive the authored scope attribute',
    );
    assert.strictEqual(
      getComputedStyle(cardCanary!).outlineWidth,
      '7px',
      'the authored rule applies inside the Direct render slot',
    );
    // Assert on outline-STYLE, not outline-width: since Chrome 151,
    // getComputedStyle().outlineWidth serializes the COMPUTED width (3px —
    // the `medium` initial value) even when outline-style is `none` and
    // nothing paints, so a 0px width expectation reports a phantom "leak"
    // on a perfectly confined element. An actually leaked authored rule
    // would flip outline-style to `solid`.
    assert.strictEqual(
      getComputedStyle(hostCanary!).outlineStyle,
      'none',
      'the same class name cannot leak the authored rule into Host chrome',
    );

    // This fixture is defined in-repo, so its <style scoped> compiles
    // through the BUILD-time glimmer-scoped-css plugin — a dev serve
    // injects a plain vite style tag and a test/prod build extracts a
    // LINKED stylesheet, and only realm-served modules install through the
    // runtime loader's `maybeHandleScopedCSSRequest` (which stamps
    // `data-boxel-scoped-css`). `document.styleSheets` covers every
    // installation form, so assert on the parsed rules themselves.
    let installedSelectors: string[] = [];
    for (let sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (let rule of Array.from(rules)) {
        if (
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes(`[${scopeAttribute}]`)
        ) {
          installedSelectors.push(rule.selectorText);
        }
      }
    }
    assert.true(
      installedSelectors.length > 0,
      'the compiled scoped stylesheet was installed',
    );
    assert.true(
      installedSelectors.includes(
        `.direct-runtime-css-canary[${scopeAttribute}]`,
      ),
      'the installed selector is attribute-scoped rather than global',
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
