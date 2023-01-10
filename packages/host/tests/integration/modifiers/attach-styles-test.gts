import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { Loader, baseRealm } from '@cardstack/runtime-common';
import { renderCard } from '../../helpers/render-component';
import {  click, shadowQuerySelector } from '../../helpers/shadow-assert';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { attachStyles, initStyleSheet } from '@cardstack/boxel-ui/attach-styles';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");

module('Integration | Modifier | attach-styles', function (hooks) {
  setupRenderingTest(hooks);

  hooks.before(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    cardApi = await Loader.import(`${baseRealm.url}card-api`);
    string = await Loader.import(`${baseRealm.url}string`);
  });

  test('can correctly add and teardown constructable stylesheets in shadow root', async function (assert) {
    let { field, contains, Card, Component } = cardApi;
    let { default: StringCard} = string;

    let sheet = initStyleSheet(`this { color: magenta; }`);

    class Isolated extends Component<typeof Person> {
      @tracked applyStyles = false;
      toggleStyles = () => { this.applyStyles = !this.applyStyles };

      @tracked applyStyles2 = false;
      toggleStyles2 = () => { this.applyStyles2 = !this.applyStyles2 };

      <template>
        <div data-test-name><@fields.name/></div>
        <button {{on "click" this.toggleStyles}} data-test-button-1>
          Toggle Styles 1
        </button>
        {{#if this.applyStyles}}
          <div {{attachStyles sheet}}>
            <p data-test-styles-1>Styles 1</p>
          </div>
        {{/if}}
        <button {{on "click" this.toggleStyles2}} data-test-button-2>
          Toggle Styles 2
        </button>
        {{#if this.applyStyles2}}
          <div {{attachStyles sheet}}>
            <p data-test-styles-2>Styles 2</p>
          </div>
        {{/if}}
      </template>
    }

    class Person extends Card {
      @field name = contains(StringCard);
      static isolated = Isolated;
    }

    let person = new Person({ name: 'Jackie' });
    let root = await renderCard(person, 'isolated');

    assert.shadowDOM('[data-test-name]').hasText('Jackie');
    assert.strictEqual(root.adoptedStyleSheets.length, 0, 'no stylesheets attached');

    await click('[data-test-button-1]');
    assert.strictEqual(root.adoptedStyleSheets.length, 1, 'stylesheet 1 attached');
    assert.ok( [...root.adoptedStyleSheets][0].cssRules[0].cssText.includes('{ color: magenta; }'), 'sheet 1 rule matches');

    await click('[data-test-button-1]');
    assert.strictEqual(root.adoptedStyleSheets.length, 0, 'stylesheet 1 removed');

    await click('[data-test-button-2]');
    assert.strictEqual(root.adoptedStyleSheets.length, 1, 'stylesheet 2 attached');

    await click('[data-test-button-2]');
    assert.strictEqual(root.adoptedStyleSheets.length, 0, 'stylesheet 2 removed');

    await click('[data-test-button-1]');
    await click('[data-test-button-2]');
    assert.strictEqual(root.adoptedStyleSheets.length, 2, 'both stylesheets attached');

    await click('[data-test-button-1]');
    assert.strictEqual(root.adoptedStyleSheets.length, 1, 'stylesheet 1 removed');
    assert.ok([...root.adoptedStyleSheets][0].cssRules[0].cssText.includes('{ color: magenta; }'), 'sheet 2 rule matches');

    await click('[data-test-button-2]');
    assert.strictEqual(root.adoptedStyleSheets.length, 0, 'no stylesheets remain');
  });

  test('can correctly add and teardown constructable stylesheets in nested shadow roots', async function (assert) {
    let { field, contains, Card, Component } = cardApi;
    let { default: StringCard} = string;
    let postStyles = initStyleSheet(`
      this { background-color: lightpink; color: darkred; padding: 1rem; }
      p { color: blue; font-weight: bold; }
    `);
    let authorStyles = initStyleSheet(`
      this { background-color: lightyellow; }
    `);
    let personStyles = initStyleSheet(`
      this { background-color: lightblue; color: darkblue; padding: 1rem; }
    `);
    class Person extends Card {
      @field name = contains(StringCard);
      static embedded = class Embedded extends Component<typeof Person> {
        <template>
          <div {{attachStyles personStyles}} data-test-person>
            <p data-test-name><@fields.name/></p>
          </div>
        </template>
      };
    }
    class Isolated extends Component<typeof Post> {
      @tracked applyStyles = false;
      toggleStyles = () => { this.applyStyles = !this.applyStyles };
      @tracked applyAuthorStyles = false;
      toggleAuthorStyles = () => { this.applyAuthorStyles = !this.applyAuthorStyles };
      <template>
        <h1 data-test-intro>Latest Post</h1>
        <button {{on "click" this.toggleStyles}} data-test-post-button>
          Reveal Title
        </button>
        {{#if this.applyStyles}}
          <div {{attachStyles postStyles}}>
            <h1 data-test-title><@fields.title/></h1>
          </div>
        {{/if}}
        <button {{on "click" this.toggleAuthorStyles}} data-test-author-button>
          Reveal Author
        </button>
        {{#if this.applyAuthorStyles}}
          <p {{attachStyles authorStyles}} data-test-author>
            Author:
            <@fields.author/>
          </p>
        {{/if}}
      </template>
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = Isolated;
    }

    let author = new Person({ name: 'Human' });
    let post = new Post({ title: 'Weather Report', author });
    let root = await renderCard(post, 'isolated');

    assert.shadowDOM('[data-test-intro]').hasText('Latest Post');
    assert.strictEqual(root.adoptedStyleSheets.length, 0, 'no stylesheets in root');

    await click('[data-test-post-button]');
    assert.strictEqual(root.adoptedStyleSheets.length, 1, 'post styles added');
    assert.ok([...root.adoptedStyleSheets][0].cssRules[0].cssText.includes('background-color: lightpink;'), 'first rule is correct');
    assert.ok([...root.adoptedStyleSheets][0].cssRules[1].cssText.includes(`p { color: blue; font-weight: bold; }`), 'second rule is correct');

    await click('[data-test-author-button]');

    assert.strictEqual(root.adoptedStyleSheets.length, 2, 'author styles added');
    assert.ok([...root.adoptedStyleSheets][1].cssRules[0].cssText.includes('lightyellow'), 'author rules are correct');
    let personRoot = shadowQuerySelector('[data-test-person]').parentNode! as ShadowRoot;
    assert.strictEqual(personRoot.adoptedStyleSheets.length, 1, 'embedded person styles are present only in person root');
    assert.ok([...personRoot.adoptedStyleSheets][0].cssRules[0].cssText.includes('lightblue'), 'embedded person rules are correct');

    await click('[data-test-post-button]');
    assert.strictEqual(root.adoptedStyleSheets.length, 1, 'post styles removed');
    assert.ok([...root.adoptedStyleSheets][0].cssRules[0].cssText.includes('lightyellow'), 'author styles remain');
    assert.strictEqual(personRoot.adoptedStyleSheets.length, 1, 'person styles remain');
    assert.ok([...personRoot.adoptedStyleSheets][0].cssRules[0].cssText.includes('lightblue'), 'person styles are correct');

    await click('[data-test-author-button]');
    assert.strictEqual(root.adoptedStyleSheets.length, 0, 'no stylesheets remain');
  });
});
