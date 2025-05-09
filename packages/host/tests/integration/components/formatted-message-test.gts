import Owner from '@ember/owner';
import { htmlSafe } from '@ember/template';
import {
  RenderingTestContext,
  render,
  settled,
  waitFor,
} from '@ember/test-helpers';

import { waitUntil } from '@ember/test-helpers';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import percySnapshot from '@percy/ember';
import { module, test } from 'qunit';

import FormattedMessage from '@cardstack/host/components/ai-assistant/formatted-message';

import CardService from '@cardstack/host/services/card-service';
import MonacoService from '@cardstack/host/services/monaco-service';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | FormattedMessage', function (hooks) {
  setupRenderingTest(hooks);

  let monacoService: MonacoService;
  let cardService: CardService;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    cardService = this.owner.lookup('service:card-service') as CardService;

    cardService.getSource = async () => {
      return {
        status: 200,
        content: 'let a = 1;\nlet b = 2;',
      };
    };
  });

  async function renderFormattedMessage(testScenario: any) {
    let monacoSDK = await monacoService.getMonacoContext();

    await render(<template>
      <FormattedMessage
        @renderCodeBlocks={{testScenario.renderCodeBlocks}}
        @monacoSDK={{monacoSDK}}
        @html={{testScenario.html}}
        @isStreaming={{testScenario.isStreaming}}
      />
    </template>);
  }

  test('it renders content without monaco editor when renderCodeBlocks is false', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: false,
      html: `
<p>Hey there, for Valentine's day I made you a code block!</p>
<pre data-code-language="haskell">
import Data.List (intercalate)
main :: IO ()
main = putStrLn "🖤"
</pre>
<p>I hope you like it!</p>
`,
      isStreaming: false,
    });

    let messageElement = (this as RenderingTestContext).element.querySelector(
      '.message',
    );

    assert.ok(
      messageElement?.innerHTML.includes(
        `<p>Hey there, for Valentine's day I made you a code block!</p>\n<pre data-code-language="haskell">import Data.List (intercalate)\nmain :: IO ()\nmain = putStrLn "🖤"\n</pre>\n<p>I hope you like it!</p>`,
      ),
      'message should render html without monaco editor',
    );

    assert.dom('.monaco-editor').doesNotExist();
  });

  test('it renders content with monaco editor in place of pre tags when renderCodeBlocks is true', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
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
      isStreaming: false,
    });

    let messageElement = (this as RenderingTestContext).element.querySelector(
      '.message',
    ) as HTMLElement;
    let directChildren = messageElement.children;

    assert.ok(directChildren[0]?.tagName == 'P');
    assert.ok(
      directChildren[1]?.tagName == 'DIV' &&
        directChildren[1]?.classList.contains('code-block-actions'),
    );
    assert.ok(
      directChildren[2]?.tagName == 'DIV' &&
        directChildren[2]?.classList.contains('code-block'),
    );
    assert.ok(directChildren[3]?.tagName == 'P');
    assert.ok(
      directChildren[4]?.tagName == 'DIV' &&
        directChildren[4]?.classList.contains('code-block-actions'),
    );
    assert.ok(
      directChildren[5]?.tagName == 'DIV' &&
        directChildren[5]?.classList.contains('code-block'),
    );
    assert.ok(directChildren[6]?.tagName == 'P');
    assert.dom('.monaco-editor').exists({ count: 2 });
    assert.dom('pre').doesNotExist();
  });

  test('it will not render apply code button when code patch block is detected but no file url is provided', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="css">
          background: #ff7f24;
</pre>`,
      isStreaming: false,
    });

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render an incomplete code patch block in human readable format when search part is not complete', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
<<<<<<< SEARCH
          let a = 1;
          let b = 2;
          let c = 3;
</pre>`,
      isStreaming: false,
    });
    await waitUntil(() => document.querySelectorAll('.view-line').length > 3);

    assert.equal(
      (document.getElementsByClassName('view-lines')[0] as HTMLElement)
        .innerText,
      '// existing code ... \nlet a = 1;\nlet b = 2;\nlet c = 3;',
    );

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render an incomplete code patch block in human readable format when replace part is not complete', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
<<<<<<< SEARCH
          let a = 1;
          let c = 3;
=======
          let a = 2;
</pre>`,
      isStreaming: false,
    });

    await waitUntil(() => document.querySelectorAll('.view-line').length > 4);

    assert.equal(
      (document.getElementsByClassName('view-lines')[0] as HTMLElement)
        .innerText,
      '// existing code ... \nlet a = 1;\nlet c = 3;\n// new code ... \nlet a = 2;',
    );

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render a diff editor when search and replace block is complete', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
let b = 2;
=======
let a = 3;
>>>>>>> REPLACE
</pre>`,
      isStreaming: false,
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
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
let b = 2;
=======
let a = 3;
>>>>>>> REPLACE
</pre>
<p>the above block is now complete, now I am sending you another one:</p>
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
let c = 3;
</pre>
`,
      isStreaming: false,
    });

    // First editor is a diff editor, the second is a standard code block
    assert.dom('[data-test-apply-code-button]').exists({ count: 1 });
    assert.dom('.code-block').exists({ count: 2 });
    assert.dom('.code-block-diff').exists({ count: 1 });

    await percySnapshot(assert);
  });

  test('it will render "Accept All" button when there are code patch actions and it is not streaming', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `<p>We need to fix this:</p>
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
=======
let a = 2;
>>>>>>> REPLACE
</pre>
<p>We need to fix this too:</p>
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let c = 1;
=======
let c = 2;
>>>>>>> REPLACE
</pre>
`,
      isStreaming: false,
    });

    assert.dom('[data-test-apply-all-code-patches-button]').exists();
  });

  test('it will not render "Accept All" button when there are code patch actions and it is streaming', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `<p>We need to fix this:</p>
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
=======
let a = 2;
>>>>>>> REPLACE
</pre>
<p>We need to fix this too:</p>
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let c = 1;
=======
let c = 2;
>>>>>>> REPLACE
</pre>
`,
      isStreaming: true,
    });

    assert.dom('[data-test-apply-all-code-patches-button]').doesNotExist();
  });

  test('it will render search/replace in a more human readable format when streaming', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
let b = 2;
=======
let a = 3;
</pre>
`, // note the missing >>>>>> REPLACE (this is intentional because streaming is in progress)
      isStreaming: true,
    });

    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[0] as HTMLElement)
          .innerText ==
        '// existing code ... \nlet a = 1;\nlet b = 2;\n// new code ... \nlet a = 3;',
    );

    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
=======
let a = 3;
</pre>
`, // note the missing search block - this is a case when we are creating a new file
      isStreaming: true,
    });

    // in this case where search block is empty, we omit the "existing code" and "new code" lines
    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[0] as HTMLElement)
          .innerText == 'let a = 3;',
    );

    assert.dom('.code-block').exists();
  });

  test('unincremental updates are handled gracefully', async function (assert) {
    let monacoSDK = await monacoService.getMonacoContext();

    let component = null;

    class TestComponent extends Component {
      @tracked html = '<p>Howdy!</p> <p>How are you today?</p>';

      constructor(owner: Owner, args: any) {
        super(owner, args);
        component = this;
      }

      <template>
        <FormattedMessage
          @renderCodeBlocks={{true}}
          @monacoSDK={{monacoSDK}}
          @html={{htmlSafe this.html}}
          @isStreaming={{true}}
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
    component!.html =
      '<p>There was an error processing your request, please try again later.</p>';
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
      @tracked html = '';
      @tracked isStreaming = false;

      constructor(owner: Owner, args: any) {
        super(owner, args);
        component = this;
      }

      <template>
        <FormattedMessage
          @renderCodeBlocks={{true}}
          @monacoSDK={{monacoSDK}}
          @html={{htmlSafe this.html}}
          @isStreaming={{this.isStreaming}}
        />
      </template>
    }

    await renderComponent(TestComponent);

    if (!component) {
      throw new Error('Component not found');
    }

    // By assigning html to the component, we are simulating streaming html updates

    component.isStreaming = true;
    component.html = `<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
=======
let a = 2;`; // incomplete code block - the ending >>>>>> REPLACE is missing

    await settled();
    assert.dom('.code-block').exists();
    assert.dom('.code-block-diff').doesNotExist();
    await waitUntil(
      () =>
        (document.getElementsByClassName('view-lines')[0] as HTMLElement)
          .innerText ==
        '// existing code ... \nlet a = 1;\n// new code ... \nlet a = 2;',
    );
    component.html = `<pre data-code-language="typescript">
// File url: https://example.com/file.ts
<<<<<<< SEARCH
let a = 1;
=======
let a = 2;
>>>>>>> REPLACE
</pre>
`; // complete code block

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
});
