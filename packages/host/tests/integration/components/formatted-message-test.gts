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
      return Promise.resolve('const x = 1;');
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
});
