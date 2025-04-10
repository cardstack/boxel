import { waitFor, click } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  getMonacoContent,
  lookupLoaderService,
} from '../../../helpers';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | codeblocks', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = lookupLoaderService().loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      // deterministic clock so that, for example, screenshots
      // have consistent content
      let clock = new Date(2024, 8, 19).getTime();
      return () => (clock += 10);
    })(),
  });

  let { simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-address>
            <h3 data-test-city={{@model.city}}>
              <@fields.city />
            </h3>
            <h3 data-test-country={{@model.country}}>
              <@fields.country />
            </h3>
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field address = contains(Address);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          <div data-test-addresses>Address: <@fields.address /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'address.gts': { Address },
        'person.gts': { Person },
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
        }),
        '.realm.json': `{ "name": "${realmName}" }`,
      },
    });
  });

  function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  async function openAiAssistant(): Promise<string> {
    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-settled]');
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  async function renderAiAssistantPanel(id?: string) {
    setCardInOperatorModeState(id);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('it shows the copy code to clipboard button', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        formatted_body:
          'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('button.code-copy-button')
      .exists('the copy code to clipboard button exists');

    // assert that new messages don't destabilize the RoomMessage component
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'this is another message',
        formatted_body: 'this is another message',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 13, 30).getTime(),
      },
    );
    await settled();

    assert
      .dom('button.code-copy-button')
      .exists('the copy code to clipboard button exists');

    assert.dom('[data-test-apply-code-button]').doesNotExist(); // no apply for code that is not a search/replace block

    // the chrome security model prevents the clipboard API
    // from working when tests are run in a headless mode, so we are unable to
    // assert the button actually copies contents to the clipboard
  });

  test('it renders codeblock in monaco', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        formatted_body:
          'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');
    let monacoContent = getMonacoContent();
    assert.strictEqual(
      monacoContent,
      `console.log("hello world");`,
      'monaco content is correct',
    );

    // assert that new messages don't destabilize the RoomMessage component
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'this is another message',
        formatted_body: 'this is another message',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 13, 30).getTime(),
      },
    );
    await settled();

    monacoContent = getMonacoContent();
    assert.strictEqual(
      monacoContent,
      `console.log("hello world");`,
      'monaco content is correct',
    );

    await waitFor('.monaco-editor'); // wait for the monaco editor to be rendered for percy

    await percySnapshot(assert);
  });

  test('handles nested pre tags', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    let messageWithNestedPreTags = `I'll help you create an example with pre tags in HTML. Here's a useful example that demonstrates different ways to use the pre tag:
\`\`\`html
<!-- Basic pre tag example -->
<pre>
This is preformatted text
    It preserves both spaces
        and line breaks
exactly as written
</pre>

<!-- Pre tag with code -->
<pre>
<code>
function sayHello() {
    console.log("Hello World!");
}
</code>
</pre>

<!-- Pre tag with styling -->
<pre style="background-color: #f4f4f4; padding: 15px; border-radius: 5px;">
const data = {
    name: "John",
    age: 30,
    city: "New York"
};
</pre>

<!-- Pre tag with HTML entities -->
<pre>
&lt;html&gt;
    &lt;head&gt;
        &lt;title&gt;Sample Page&lt;/title&gt;
    &lt;/head&gt;
    &lt;body&gt;
        &lt;h1&gt;Hello World!&lt;/h1&gt;
    &lt;/body&gt;
&lt;/html&gt;
</pre>
\`\`\`

\`\`\`typescript
  <<<<<<< SEARCH
    let a = 1;
    let c = 3;
  =======
    let a = 2;
\`\`\`

These examples show different ways to use the \`<pre>\` tag:
1. Basic preformatted text
2. Code display with \`<pre>\` and \`<code>\` combined
3. Styled \`<pre>\` block
4. HTML code display using entities

You can use these in your HTML documents to display formatted text, code snippets, or any content where you want to preserve spacing and line breaks exactly as written.`;

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: messageWithNestedPreTags,
        formatted_body: messageWithNestedPreTags,
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');

    assert
      .dom('.monaco-editor')
      .exists({ count: 2 }, 'Should have 2 monaco editors');

    let monacoContent = getMonacoContent();
    assert.ok(
      monacoContent.includes('Basic pre tag example'),
      'Monaco content includes the first comment',
    );
    assert.ok(
      monacoContent.includes('This is preformatted text'),
      'Monaco content includes the first nested pre content',
    );
    assert.ok(
      monacoContent.includes('function sayHello()'),
      'Monaco content includes the code block',
    );
    assert.ok(
      monacoContent.includes('const data = {'),
      'Monaco content includes the styled pre block',
    );
    assert.equal(
      (document.getElementsByClassName('view-lines')[1] as HTMLElement)
        .innerText,
      '// existing code ... \nlet a = 1;\nlet c = 3;\n// new code ... \nlet a = 2;',
    );

    assert.dom('ol li').exists({ count: 4 }, 'Should have 4 list items');

    await percySnapshot(assert);
  });

  test('handles HTML tags outside backticks', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    let messageWithHtmlOutsideBackticks = `Here's some HTML outside of code blocks:

<p>This is a paragraph with <strong>bold text</strong> and <em>italic text</em>.</p>

<ul>
  <li>List item 1</li>
  <li>List item 2 with <a href="https://example.com">a link</a></li>
</ul>

<div class="container">
  <h1>Heading 1</h1>
  <p>Another paragraph with <code>inline code</code>.</p>
</div>

And here's a code block with HTML inside:

\`\`\`html
<div class="example">
  <p>This HTML is inside a code block with language specified.</p>
</div>
\`\`\`

And another code block without language specified:

\`\`\`
<div class="example">
  <p>This HTML is inside a code block without language specified.</p>
</div>
\`\`\``;

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: messageWithHtmlOutsideBackticks,
        formatted_body: messageWithHtmlOutsideBackticks,
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');

    // Check that HTML outside backticks is displayed as actual HTML
    assert
      .dom('[data-test-ai-message-content]')
      .containsText(
        '<p>This is a paragraph with <strong>bold text</strong> and <em>italic text</em>.</p>',
        'HTML tags outside backticks should be displayed as actual HTML',
      );

    assert
      .dom('[data-test-ai-message-content]')
      .containsText(
        '<li>List item 1</li>',
        'List items should be displayed correctly',
      );

    assert
      .dom('[data-test-ai-message-content]')
      .containsText(
        '<li>List item 2 with <a href="https://example.com">a link</a></li>',
        'Links should be displayed correctly',
      );

    assert
      .dom('[data-test-ai-message-content]')
      .containsText('Heading 1', 'Headings should be displayed correctly');

    assert
      .dom('[data-test-ai-message-content]')
      .containsText(
        'Another paragraph with <code>inline code</code>.',
        'Inline code should be displayed correctly',
      );

    // Check that code blocks are preserved
    assert
      .dom('.monaco-editor')
      .exists({ count: 2 }, 'Should have 2 monaco editors');

    // Check that HTML inside code blocks is preserved
    let monacoContent = getMonacoContent();
    assert.ok(
      monacoContent.includes('<div class="example">'),
      'HTML inside code block should be preserved',
    );
    assert.ok(
      monacoContent.includes(
        'This HTML is inside a code block with language specified',
      ),
      'Content inside code block should be preserved',
    );

    await percySnapshot(assert);
  });

  test('handles HTML inside backticks without language name', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    let messageWithHtmlInBackticksNoLang = `Here's some HTML inside backticks without a language name:

\`\`\`
<div class="container">
  <h1>Hello World</h1>
  <p>This is a paragraph with <strong>bold text</strong>.</p>
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
  </ul>
</div>
\`\`\`

And here's some inline code with HTML: \`<span>inline HTML</span>\`

And some regular text with <b>HTML tags</b> that should be displayed as actual HTML.`;

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: messageWithHtmlInBackticksNoLang,
        formatted_body: messageWithHtmlInBackticksNoLang,
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');

    // Check that HTML inside backticks is preserved in code blocks
    assert
      .dom('.monaco-editor')
      .exists({ count: 1 }, 'Should have 1 monaco editor');

    let monacoContent = getMonacoContent();
    assert.ok(
      monacoContent.includes('<div class="container">'),
      'HTML inside code block should be preserved',
    );
    assert.ok(
      monacoContent.includes('<h1>Hello World</h1>'),
      'Nested HTML inside code block should be preserved',
    );
    assert.ok(
      monacoContent.includes(
        'This is a paragraph with <strong>bold text</strong>',
      ),
      'HTML with nested tags inside code block should be preserved',
    );

    // Check that inline code with HTML is preserved
    assert
      .dom('[data-test-ai-message-content]')
      .containsText(
        '<span>inline HTML</span>',
        'Inline code with HTML should be displayed correctly',
      );

    // Check that HTML outside backticks is displayed as actual HTML
    assert
      .dom('[data-test-ai-message-content]')
      .containsText(
        '<b>HTML tags</b>',
        'HTML tags outside backticks should be displayed as actual HTML',
      );

    await percySnapshot(assert);
  });
});
