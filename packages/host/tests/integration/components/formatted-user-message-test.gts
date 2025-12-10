import type { RenderingTestContext } from '@ember/test-helpers';
import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import FormattedUserMessage from '@cardstack/host/components/ai-assistant/message/user-message';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | FormattedUserMessage', function (hooks) {
  setupRenderingTest(hooks);

  async function renderFormattedUserMessage(testScenario: any) {
    await render(<template>
      <FormattedUserMessage @html={{testScenario.html}} />
    </template>);
  }

  test('it renders content without monaco editor', async function (assert) {
    await renderFormattedUserMessage({
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
});
