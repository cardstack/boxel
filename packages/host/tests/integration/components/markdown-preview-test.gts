import Service from '@ember/service';
import { click, settled, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import MarkdownPreview from '@cardstack/host/components/operator-mode/preview-panel/markdown-preview';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let cardApi: typeof import('@cardstack/base/card-api');
let string: typeof import('@cardstack/base/string');

class MockLocalIndexer extends Service {
  url = new URL(testRealmURL);
}

module('Integration | markdown-preview', function (hooks) {
  let loader: Loader;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    this.owner.register('service:local-indexer', MockLocalIndexer);
  });

  test('defaults to source view showing raw markdown text', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class TestCard extends CardDef {
      @field title = contains(StringField);
      static markdown = class extends Component<typeof this> {
        <template># {{@model.title}}</template>
      };
    }

    loader.shimModule(`${testRealmURL}test-cards`, { TestCard });
    let card = new TestCard({ title: 'Hello World' });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><MarkdownPreview @card={{card}} /></template>
      },
    );
    await settled();

    assert
      .dom('[data-test-markdown-preview]')
      .exists('markdown preview container renders');
    assert
      .dom('[data-test-markdown-view-toggle]')
      .exists('view toggle renders');
    assert
      .dom('[data-test-markdown-view="source"]')
      .hasAttribute(
        'aria-pressed',
        'true',
        'source button is pressed by default',
      );
    assert
      .dom('[data-test-markdown-view="rendered"]')
      .hasAttribute(
        'aria-pressed',
        'false',
        'rendered button is not pressed by default',
      );
    assert
      .dom('[data-test-markdown-source]')
      .exists('source view is displayed by default');
    assert
      .dom('[data-test-markdown-rendered]')
      .doesNotExist('rendered view is not displayed by default');
  });

  test('toggling to rendered view shows HTML-rendered markdown', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class TestCard extends CardDef {
      @field title = contains(StringField);
      static markdown = class extends Component<typeof this> {
        <template># {{@model.title}}</template>
      };
    }

    loader.shimModule(`${testRealmURL}test-cards`, { TestCard });
    let card = new TestCard({ title: 'Hello World' });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><MarkdownPreview @card={{card}} /></template>
      },
    );
    await settled();

    await click('[data-test-markdown-view="rendered"]');

    assert
      .dom('[data-test-markdown-view="rendered"]')
      .hasAttribute('aria-pressed', 'true', 'rendered button is now pressed');
    assert
      .dom('[data-test-markdown-view="source"]')
      .hasAttribute(
        'aria-pressed',
        'false',
        'source button is no longer pressed',
      );
    assert
      .dom('[data-test-markdown-rendered]')
      .exists('rendered view is displayed');
    assert
      .dom('[data-test-markdown-source]')
      .doesNotExist('source view is hidden');
    assert
      .dom('[data-test-markdown-rendered] h1')
      .exists('markdown is rendered as HTML with heading');
  });

  test('toggling back to source view restores raw markdown', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class TestCard extends CardDef {
      @field title = contains(StringField);
      static markdown = class extends Component<typeof this> {
        <template># {{@model.title}}</template>
      };
    }

    loader.shimModule(`${testRealmURL}test-cards`, { TestCard });
    let card = new TestCard({ title: 'Hello World' });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><MarkdownPreview @card={{card}} /></template>
      },
    );
    await settled();

    // Switch to rendered
    await click('[data-test-markdown-view="rendered"]');
    assert
      .dom('[data-test-markdown-rendered]')
      .exists('rendered view is displayed');

    // Switch back to source
    await click('[data-test-markdown-view="source"]');

    assert
      .dom('[data-test-markdown-view="source"]')
      .hasAttribute('aria-pressed', 'true', 'source button is pressed again');
    assert.dom('[data-test-markdown-source]').exists('source view is restored');
    assert
      .dom('[data-test-markdown-rendered]')
      .doesNotExist('rendered view is hidden again');
  });

  test('source view captures markdown text from the card', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class TestCard extends CardDef {
      @field title = contains(StringField);
      // prettier-ignore
      static markdown = class extends Component<typeof this> {
        <template># {{@model.title}}

Some **bold** text.</template>
      };
    }

    loader.shimModule(`${testRealmURL}test-cards`, { TestCard });
    let card = new TestCard({ title: 'Test Title' });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><MarkdownPreview @card={{card}} /></template>
      },
    );
    await settled();

    await waitFor('[data-test-markdown-source]');
    let sourceText =
      document
        .querySelector('[data-test-markdown-source]')
        ?.textContent?.trim() ?? '';
    assert.true(
      sourceText.includes('# Test Title'),
      `source contains heading: ${sourceText}`,
    );
    assert.true(
      sourceText.includes('**bold**'),
      `source contains bold markdown syntax: ${sourceText}`,
    );
  });

  test('rendered view converts markdown to HTML', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class TestCard extends CardDef {
      @field title = contains(StringField);
      // prettier-ignore
      static markdown = class extends Component<typeof this> {
        <template># {{@model.title}}

Some **bold** text.</template>
      };
    }

    loader.shimModule(`${testRealmURL}test-cards`, { TestCard });
    let card = new TestCard({ title: 'Test Title' });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><MarkdownPreview @card={{card}} /></template>
      },
    );
    await settled();

    await click('[data-test-markdown-view="rendered"]');

    assert.dom('[data-test-markdown-rendered] h1').hasText('Test Title');
    assert.dom('[data-test-markdown-rendered] strong').hasText('bold');
  });
});
