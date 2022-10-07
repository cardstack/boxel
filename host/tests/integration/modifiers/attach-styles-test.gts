import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { Loader, baseRealm } from '@cardstack/runtime-common';
import { renderCard } from '../../helpers/render-component';
import { waitFor } from '../../helpers/shadow-assert';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");
let attach: typeof import ("https://cardstack.com/base/attach-styles");

module('Integration | Modifier | attach-styles', function (hooks) {
  setupRenderingTest(hooks);

  hooks.before(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    cardApi = await Loader.import(`${baseRealm.url}card-api`);
    string = await Loader.import(`${baseRealm.url}string`);
    attach = await Loader.import(`${baseRealm.url}attach-styles`);
  });

  test('renders card schema view', async function (assert) {
    let { field, contains, Card, Component } = cardApi;
    let { default: StringCard} = string;
    let { attachStyles, initStyleSheet } = attach;

    let sheet = initStyleSheet(`this { color: magenta; }`);

    class Isolated extends Component<typeof Person> {
      @tracked applyStyles = false;
      toggleStyles = () => { this.applyStyles = !this.applyStyles };

      @tracked applyStyles2 = false;
      toggleStyles2 = () => { this.applyStyles2 = !this.applyStyles2 };

      <template>
        <button {{on "click" this.toggleStyles}} type="button">Toggle Styles 1</button>
        {{#if this.applyStyles}}
          <div {{attachStyles sheet}}>
            <h2 data-test-name><@fields.name/> 1</h2>
          </div>
        {{/if}}

        <button {{on "click" this.toggleStyles2}} type="button">Toggle Styles 2</button>
        {{#if this.applyStyles2}}
          <div {{attachStyles sheet}}>
            <h2 data-test-name><@fields.name/> 2</h2>
          </div>
        {{/if}}
      </template>
    }

    class Person extends Card {
      @field name = contains(StringCard);
      static isolated = Isolated;
    }

    let author = new Person({ name: 'Jackie' });
    await renderCard(author, 'isolated');

    await this.pauseTest();
    await waitFor('[data-test-name]');

    assert.shadowDOM('[data-test-name]').hasText('Jackie', 'renders the card');
  });
});
