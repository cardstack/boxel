import { RenderingTestContext, render, waitFor } from '@ember/test-helpers';

import percySnapshot from '@percy/ember';
import { module, test } from 'qunit';

import FormattedMessage from '@cardstack/host/components/ai-assistant/formatted-message';

import CardService from '@cardstack/host/services/card-service';
import MonacoService from '@cardstack/host/services/monaco-service';

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
      return Promise.resolve('let a = 1;\nlet b = 2;');
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

    await waitFor('.view-lines');

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

    await waitFor('.view-lines');

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

    await waitFor('.code-block-diff .cdr.line-delete');

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
});
