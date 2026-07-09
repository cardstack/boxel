import { on } from '@ember/modifier';
import Service from '@ember/service';
import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
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

module('Integration | preview', function (hooks) {
  let loader: Loader;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
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
