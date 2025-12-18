import Service from '@ember/service';
import { waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type { Format } from 'https://cardstack.com/base/card-api';

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

  test('renders head meta tags preview for a card head format', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class HeadCard extends CardDef {
      @field title = contains(StringField);
      @field description = contains(StringField);
      @field image = contains(StringField);
      @field url = contains(StringField);

      static head = class Head extends Component<typeof this> {
        <template>
          {{! template-lint-disable no-forbidden-elements }}
          <title>{{@model.title}}</title>
          <meta name='description' content={{@model.description}} />
          <meta property='og:url' content={{@model.url}} />
          <meta property='og:image' content={{@model.image}} />
          <meta name='twitter:card' content='summary' />
        </template>
      };
    }

    let headCard = new HeadCard({
      title: 'Preview Title',
      description: 'Preview description',
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
      @field title = contains(StringField);
      @field url = contains(StringField);

      static head = class Head extends Component<typeof this> {
        <template>
          {{! template-lint-disable no-forbidden-elements }}
          <title>{{@model.title}}</title>
          <meta property='og:type' content='article' />
          <meta property='og:url' content={{@model.url}} />
        </template>
      };
    }

    let fallbackCard = new FallbackHeadCard({
      title: 'Fallback Title',
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
});
