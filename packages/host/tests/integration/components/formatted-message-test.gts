import { RenderingTestContext, render, waitFor } from '@ember/test-helpers';

import percySnapshot from '@percy/ember';

import { module, test } from 'qunit';

import FormattedMessage from '@cardstack/host/components/ai-assistant/formatted-message';

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

  test('it will render apply code button when code patch block is detected and file url is provided', async function (assert) {
    let originalGetSource = cardService.getSource;
    cardService.getSource = async () => {
      return Promise.resolve('const x = 1;');
    };

    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="css">
// File url: https://my-realm-server.com/my-realm/basketball.gts
<<<<<<< SEARCH
          background: #2ecc71;
=======
          background: #ff7f24;
>>>>>>> REPLACE
</pre>`,
      isStreaming: false,
    });

    assert.dom('[data-test-apply-code-button]').exists();
    cardService.getSource = originalGetSource;
  });

  test('it will not render apply code button when code is streaming, code patch block is detected and file url is provided', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="css">
// File url: https://my-realm-server.com/my-realm/basketball.gts
<<<<<<< SEARCH
          background: #2ecc71;
=======
          background: #ff7f24;
>>>>>>> REPLACE
</pre>`,
      isStreaming: true,
    });

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will not render apply code button when code patch block is detected but no file url is provided', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="css">
<<<<<<< SEARCH
          background: #2ecc71;
=======
          background: #ff7f24;
>>>>>>> REPLACE
</pre>`,
      isStreaming: false,
    });

    assert.dom('[data-test-apply-code-button]').doesNotExist();
  });

  test('it will render a code block with diff decorations', async function (assert) {
    await renderFormattedMessage({
      renderCodeBlocks: true,
      html: `
<pre data-code-language="typescript">
// File url: https://my-realm-server.com/my-realm/basketball.gts
<<<<<<< SEARCH
          let a = 1;
          let b = Math.max(a, 2);
=======
          let a = 2;
          let b = Math.max(a, 3);
>>>>>>> REPLACE
</pre>`,
      isStreaming: true,
    });

    await waitFor('.view-line');
    let viewLines = document.querySelectorAll('.view-line');
    assert.ok(viewLines.length === 4, 'There should be exactly 4 code lines');

    let [firstLineSpans, secondLineSpans] = [0, 1].map((i) =>
      viewLines[i].querySelectorAll('span span'),
    );
    [firstLineSpans, secondLineSpans].forEach((spans) => {
      spans.forEach((span) => {
        assert.ok(
          span.classList.contains('line-to-be-replaced'),
          'Code line should have line-to-be-replaced class',
        );
      });
    });

    let [thirdLineSpans, fourthLineSpans] = [2, 3].map((i) =>
      viewLines[i].querySelectorAll('span span'),
    );
    [thirdLineSpans, fourthLineSpans].forEach((spans) => {
      spans.forEach((span) => {
        assert.ok(
          span.classList.contains('line-to-be-replaced-with'),
          'Code line should have line-to-be-replaced-with class',
        );
      });
    });

    // snapshot to assert first 2 lines are red and last 2 lines are green
    await percySnapshot(assert);
  });
});
