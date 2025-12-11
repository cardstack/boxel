import Owner from '@ember/owner';
import {
  RenderingTestContext,
  click,
  render,
  settled,
  waitFor,
} from '@ember/test-helpers';
import { getService } from '@universal-ember/test-support';

import { waitUntil } from '@ember/test-helpers';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import percySnapshot from '@percy/ember';
import { module, test } from 'qunit';

import {
  SEPARATOR_MARKER,
  SEARCH_MARKER,
  REPLACE_MARKER,
} from '@cardstack/runtime-common';

import FormattedAiBotMessage from '@cardstack/host/components/ai-assistant/message/aibot-message';

import {
  makeCodeDiffStats,
  parseHtmlContent,
} from '@cardstack/host/lib/formatted-message/utils';
import CardService from '@cardstack/host/services/card-service';
import MonacoService from '@cardstack/host/services/monaco-service';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';
import { setupSnapshotRealm } from '../../helpers';

module('Integration | Component | FormattedAiBotMessage', function (hooks) {
  setupRenderingTest(hooks);
  setupSnapshotRealm(hooks, {
    mockMatrixUtils: undefined as any,
    build: async () => ({}),
  });

  let monacoService: MonacoService;
  let cardService: CardService;

  let roomId = '!abcd';
  let eventId = '1234';

  hooks.beforeEach(async function (this: RenderingTestContext) {
    monacoService = getService('monaco-service');

    cardService = getService('card-service');

    cardService.getSource = async () => {
      return Promise.resolve({
        status: 200,
        content: 'let a = 1;\nlet b = 2;',
      });
    };

    getService('matrix-service').fetchMatrixHostedFile = async (_url) => {
      return new Response('let a = 1;\nlet b = 2;');
    };
  });

  async function renderFormattedAiBotMessage(testScenario: any) {
    let monacoSDK = await monacoService.getMonacoContext();

    await render(<template>
      <FormattedAiBotMessage
        class='test-component'
        @monacoSDK={{monacoSDK}}
        @roomId={{testScenario.roomId}}
        @eventId={{testScenario.eventId}}
        @htmlParts={{testScenario.htmlParts}}
        @isStreaming={{testScenario.isStreaming}}
        @isLastAssistantMessage={{testScenario.isLastAssistantMessage}}
      />
      <style scoped>
        .test-component {
          max-width: 350px; /* to observe overflow */
        }
      </style>
    </template>);
  }

  test('it renders content with monaco editor in place of pre tags', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<p>Hey there, for Valentine's day I made you a code block!</p>
<pre data-code-language="c">
print("🖤")
</pre>
<p>I hope you like it! But here is another one!</p>
<pre data-code-language="ruby">
puts "💎"
</pre>
<p>I hope you like this one too!</p>
`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });
    let messageElement = (this as RenderingTestContext).element.querySelector(
      '.message',
    ) as HTMLElement;
    let directChildren = messageElement.children;
    assert.strictEqual(directChildren[0]?.tagName, 'P');
    assert.strictEqual(directChildren[1]?.tagName, 'SECTION');
    assert.true(directChildren[1]?.classList.contains('code-block'));

    assert.strictEqual(directChildren[2]?.tagName, 'P');
    assert.strictEqual(directChildren[3]?.tagName, 'SECTION');
    assert.true(directChildren[3]?.classList.contains('code-block'));
    assert.strictEqual(directChildren[4]?.tagName, 'P');

    assert.dom('.monaco-editor').exists({ count: 2 });
    assert.dom('pre').doesNotExist();
  });

  test('it will not render apply code button when code patch block is detected but no file url is provided', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<pre data-code-language="css">
          background: #ff7f24;
</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render an incomplete code patch block in human readable format when search part is not complete', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<pre data-code-language="typescript">
${SEARCH_MARKER}
          let a = 1;
          let b = 2;
          let c = 3;
</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });
    await waitUntil(() => document.querySelectorAll('.view-line').length > 3);

    assert.strictEqual(
      (document.getElementsByClassName('view-lines')[0] as HTMLElement)
        .innerText,
      '// existing code ... \nlet a = 1;\nlet b = 2;\nlet c = 3;',
    );

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render an incomplete code patch block in human readable format when replace part is not complete', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<pre data-code-language="typescript">
${SEARCH_MARKER}
          let a = 1;
          let c = 3;
${SEPARATOR_MARKER}
          let a = 2;
</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    await waitUntil(() => document.querySelectorAll('.view-line').length > 4);

    assert.strictEqual(
      (document.getElementsByClassName('view-lines')[0] as HTMLElement)
        .innerText,
      '// existing code ... \nlet a = 1;\nlet c = 3;\n// new code ... \nlet a = 2;',
    );

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render a diff editor when search and replace block is complete', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<pre data-code-language="typescript">
https://example.com/file.ts
${SEARCH_MARKER}
let a = 1;
let b = 2;
${SEPARATOR_MARKER}
let a = 3;
${REPLACE_MARKER}
</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    // monaco diff editor is rendered when the diff block is complete (i.e. code block streaming has finished)
    // the diff editor will have .line-delete and .line-insert classes to show the changes
    await waitUntil(
      () =>
        document.querySelectorAll('.code-block-diff .cdr.line-delete').length >
        1,
    );
    await waitFor('.code-block-diff .cdr.line-insert');

    assert.dom('.cdr.line-delete').exists({ count: 2 });
    assert.dom('.cdr.line-insert').exists({ count: 1 });
    assert.dom('[data-test-apply-code-button]').exists();

    await percySnapshot(assert);
  });

  test('it will render one diff editor and one standard code block if one search replace block is complete and another is not', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<pre data-code-language="typescript">
https://example.com/diff-editor-preview-code-block-file.ts
${SEARCH_MARKER}
let a = 1;
let b = 2;
${SEPARATOR_MARKER}
let a = 3;
${REPLACE_MARKER}
</pre>
<p>the above block is now complete, now I am sending you another one:</p>
<pre data-code-language="typescript">
https://example.com/code-editor-preview-code-block-file.ts
${SEARCH_MARKER}
let a = 1;
let c = 3;
</pre>
`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    // First editor is a diff editor
    assert
      .dom('[data-test-code-block-index="0"] [data-test-code-diff-editor]')
      .exists();
    assert
      .dom('[data-test-code-block-index="0"] [data-test-file-mode]')
      .hasText('Edit');
    assert
      .dom('[data-test-code-block-index="0"] [data-test-file-name]')
      .containsText('file.ts');
    await waitFor('[data-test-code-block-index="0"] [data-test-removed-lines]');
    assert
      .dom('[data-test-code-block-index="0"] [data-test-removed-lines]')
      .hasText('-2');
    assert
      .dom('[data-test-code-block-index="0"] [data-test-added-lines]')
      .hasText('+1');
    assert
      .dom('[data-test-code-block-index="0"] [data-test-apply-code-button]')
      .exists();

    // The second is a standard code block
    assert.dom('[data-test-code-block-index="1"] [data-test-editor]').exists();
    assert
      .dom('[data-test-code-block-index="1"] [data-test-file-mode]')
      .hasText('Edit');
    assert
      .dom('[data-test-code-block-index="1"] [data-test-removed-lines]')
      .doesNotExist();
    assert
      .dom('[data-test-code-block-index="1"] [data-test-added-lines]')
      .doesNotExist();
    assert
      .dom('[data-test-code-block-index="1"] [data-test-file-name]')
      .containsText('file.ts');
    assert
      .dom('[data-test-code-block-index="1"] [data-test-apply-code-button]')
      .doesNotExist();
    assert.dom('[data-test-code-block-index="1"] [data-test-editor]').exists();

    await waitUntil(
      () =>
        document.querySelectorAll(
          '[data-test-code-block-index="0"] .cdr.line-delete',
        ).length >= 2,
    );
    await waitUntil(
      () =>
        document.querySelectorAll(
          '[data-test-code-block-index="0"] .cdr.line-insert',
        ).length >= 1,
    );

    await waitUntil(
      () =>
        document.querySelectorAll('[data-test-code-block-index="1"] .view-line')
          .length >= 3,
    );
    await waitUntil(() => {
      const lines = document.querySelector(
        '[data-test-code-block-index="1"] .view-lines',
      ) as HTMLElement | null;
      return (
        lines?.innerText === '// existing code ... \nlet a = 1;\nlet c = 3;'
      );
    });

    await percySnapshot(assert);
  });

  test('unincremental updates are handled gracefully', async function (assert) {
    let monacoSDK = await monacoService.getMonacoContext();

    let component = null;

    class TestComponent extends Component {
      @tracked htmlParts = parseHtmlContent(
        '<p>Howdy!</p> <p>How are you today?</p>',
        roomId,
        eventId,
      );

      constructor(owner: Owner, args: any) {
        super(owner, args);
        component = this;
      }

      <template>
        <FormattedAiBotMessage
          @monacoSDK={{monacoSDK}}
          @htmlParts={{this.htmlParts}}
          @roomId='!abcd'
          @eventId='1234'
          @isStreaming={{true}}
          @isLastAssistantMessage={{true}}
        />
      </template>
    }

    await renderComponent(TestComponent);
    assert.dom('.message').containsText('Howdy! How are you today?');

    // Keep in mind that this test isn't as simple as it looks. Html is not directly rendered
    // but the component will react to its change and parse out groups, for example text and code,
    // and then render them separately (check the HtmlDidUpdate modifier in the component for more info).
    // Most of the time, streaming html updates are incremental, meaning the next html is an appended version of the previous one.
    // But not always! For example when the html is replaced with an error message, the new html is not an appended version of the previous one.
    // This is a regression test for this particular case.
    component!.htmlParts = parseHtmlContent(
      '<p>There was an error processing your request, please try again later.</p>',
      roomId,
      eventId,
    );
    await settled();

    assert
      .dom('.message')
      .containsText(
        'There was an error processing your request, please try again later.',
      );
  });

  test('it will render either standard code editor or diff editor during streaming depending on whether the individual search/replace blocks are complete', async function (assert) {
    let monacoSDK = await monacoService.getMonacoContext();
    let component: any = null;

    class TestComponent extends Component {
      @tracked htmlParts = [];
      @tracked isStreaming = false;

      constructor(owner: Owner, args: any) {
        super(owner, args);
        component = this;
      }

      <template>
        <FormattedAiBotMessage
          @monacoSDK={{monacoSDK}}
          @htmlParts={{this.htmlParts}}
          @roomId='!abcd'
          @eventId='1234'
          @isStreaming={{this.isStreaming}}
          @isLastAssistantMessage={{true}}
        />
      </template>
    }

    await renderComponent(TestComponent);

    if (!component) {
      throw new Error('Component not found');
    }

    // By assigning html to the component, we are simulating streaming html updates

    component.isStreaming = true;
    component.htmlParts = parseHtmlContent(
      `<pre data-code-language="typescript">
https://example.com/file.ts
${SEARCH_MARKER}
let a = 1;
${SEPARATOR_MARKER}
let a = 2;`,
      roomId,
      eventId,
    ); // incomplete code block - the ending >>>>>> REPLACE is missing

    await settled();
    assert.dom('.code-block').exists();
    assert.dom('.code-block-diff').doesNotExist();
    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[0] as HTMLElement)
          .innerText ==
        '// existing code ... \nlet a = 1;\n// new code ... \nlet a = 2;',
    );
    component.htmlParts = parseHtmlContent(
      `<pre data-code-language="typescript">
https://example.com/file.ts
${SEARCH_MARKER}
let a = 1;
${SEPARATOR_MARKER}
let a = 2;
${REPLACE_MARKER}
</pre>
`,
      roomId,
      eventId,
    ); // complete code block

    component.isStreaming = false;

    // Here we are testing the reactivity mechanism of when we detect that a search/replace
    // block during streaming is complete - at that point CodeDiffResource will react to it
    // by preparing the original and patched code, and the diff editor will be rendered,
    // which shows which lines are deleted and which are inserted, or changed.

    await settled();
    await waitFor('.code-block-diff');
    assert.dom('.code-block-diff').exists();

    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[0] as HTMLElement)
          .innerText == 'let a = 1;\nlet b = 2;',
    );
    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[1] as HTMLElement)
          .innerText == 'let a = 1;',
    );
    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[2] as HTMLElement)
          .innerText == 'let a = 2;\nlet b = 2;',
    );
  });

  test('it will text code clocks as they are sent, without hiding the first line url as it streams', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `<pre data-code-language="text">https://example.com/some-url</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    assert.dom('.code-block').exists();
    assert.dom('.code-block-diff').doesNotExist();
    await waitUntil(() => document.querySelectorAll('.view-line').length == 1);

    assert.strictEqual(
      (document.getElementsByClassName('view-lines')[0] as HTMLElement)
        .innerText,
      'https://example.com/some-url',
    );
  });

  test('it will render an error message when file url is missing', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `<pre data-code-language="typescript">
malformed file url
${SEARCH_MARKER}
let a = 1;
let b = 2;
${SEPARATOR_MARKER}
let a = 3;
${REPLACE_MARKER}
</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    assert
      .dom(
        `[data-test-error-message="Failed to load code from malformed file url"]`,
      )
      .exists();
  });

  test('it will render an error message when code diff does not apply', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `
<pre data-code-language="typescript">
https://example.com/file.ts
${SEARCH_MARKER}
🍄 hallucinated code 🍄
${SEPARATOR_MARKER}
let a = 1;
${REPLACE_MARKER}
</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
      isLastAssistantMessage: true,
    });

    await click('[data-test-attached-file-dropdown-button="file.ts"]');

    assert
      .dom('[data-test-boxel-menu-item-text="Restore Generated Content"]')
      .hasAttribute('disabled');

    assert
      .dom(
        `[data-test-error-message="Unable to process the code patch due to invalid code coming from AI (search pattern not found in the target source file)"]`,
      )
      .exists();
  });

  test('utils: makeCodeDiffStats', function (assert) {
    // A couple of real world examples where I got lineChanges from the monaco
    // diff editor (using editor.getLineChanges()) and I counted
    // the green and red lines manually and compared the results.

    let lineChanges = [
      {
        originalStartLineNumber: 308,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 309,
        modifiedEndLineNumber: 309,
        charChanges: [],
      },
    ];
    assert.deepEqual(makeCodeDiffStats(lineChanges), {
      linesAdded: 1,
      linesRemoved: 0,
    });

    lineChanges = [
      {
        originalStartLineNumber: 83,
        originalEndLineNumber: 84,
        modifiedStartLineNumber: 83,
        modifiedEndLineNumber: 85,
        charChanges: [],
      },
      {
        originalStartLineNumber: 90,
        originalEndLineNumber: 90,
        modifiedStartLineNumber: 91,
        modifiedEndLineNumber: 92,
        charChanges: [],
      },
      {
        originalStartLineNumber: 96,
        originalEndLineNumber: 96,
        modifiedStartLineNumber: 98,
        modifiedEndLineNumber: 99,
        charChanges: [],
      },
    ];
    assert.deepEqual(makeCodeDiffStats(lineChanges), {
      linesAdded: 7,
      linesRemoved: 4,
    });
  });
});
