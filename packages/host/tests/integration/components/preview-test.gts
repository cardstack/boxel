import Service from '@ember/service';
import { waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardRenderer from '@cardstack/host/components/card-renderer';
import HeadFormatPreview from '@cardstack/host/components/head-format-preview';

import { percySnapshot, testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');

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
        <template>
          <CardRenderer @card={{card}} />
        </template>
      },
    );
    await waitFor('[data-test-firstName]'); // we need to wait for the card instance to load
    assert.dom('[data-test-firstName]').hasText('Mango');
  });

  test('renders head meta tags preview', async function (assert) {
    class HeadContent extends GlimmerComponent<{
      Args: { displayContainer?: boolean };
    }> {
      <template>
        <title>Preview Title</title>
        <meta name='description' content='Preview description' />
        <meta property='og:url' content='https://example.com/post' />
        <meta property='og:image' content='/cover.png' />
        <meta name='twitter:card' content='summary' />
      </template>
    }

    class TestDriver extends GlimmerComponent<{ Args: { format?: string } }> {
      HeadContent = HeadContent;

      <template>
        <HeadFormatPreview
          @renderedCard={{this.HeadContent}}
          @cardURL='https://example.com/post'
        />
      </template>
    }

    await renderComponent(TestDriver);
    await waitFor('.head-preview');
    await waitFor('[data-test-head-markup]');

    await percySnapshot(assert);

    assert.dom('.search-title').hasText('Preview Title');
    assert.dom('.search-description').hasText('Preview description');
    assert.dom('.domain').hasText('example.com');
    assert.dom('.path').hasText('/post');
    assert
      .dom('.preview-image img')
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
    class HeadContent extends GlimmerComponent<{
      Args: { displayContainer?: boolean };
    }> {
      <template>
        <title>Fallback Title</title>
        <meta property='og:type' content='article' />
      </template>
    }

    class TestDriver extends GlimmerComponent<{ Args: { format?: string } }> {
      HeadContent = HeadContent;

      <template>
        <HeadFormatPreview
          @renderedCard={{this.HeadContent}}
          @cardURL='https://example.com/no-image'
        />
      </template>
    }

    await renderComponent(TestDriver);
    await waitFor('.head-preview');

    assert.dom('.search-title').hasText('Fallback Title');
    assert
      .dom('.search-description')
      .hasText('Add title and description meta tags to see them here.');
    assert.dom('.facebook-preview .muted').hasText('article');
    assert.dom('.twitter-preview .muted').hasText('summary_large_image');
    assert.dom('.favicon img').doesNotExist();
    assert.dom('.favicon span').hasText('E');
    assert.dom('.preview-image img').doesNotExist();
    assert.dom('.facebook-preview .image-placeholder').hasText('Add og:image');
    assert
      .dom('.twitter-preview .image-placeholder')
      .hasText('Add twitter:image');
  });
});
