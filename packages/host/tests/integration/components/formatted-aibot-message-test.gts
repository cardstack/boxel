import type Owner from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { render, settled, waitUntil } from '@ember/test-helpers';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import FormattedAiBotMessage from '@cardstack/host/components/ai-assistant/message/aibot-message';

import { parseHtmlContent } from '@cardstack/host/lib/formatted-message/utils';
import type MonacoService from '@cardstack/host/services/monaco-service';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | FormattedAiBotMessage', function (hooks) {
  setupRenderingTest(hooks);

  let monacoService: MonacoService;

  let roomId = '!abcd';
  let eventId = '1234';

  hooks.beforeEach(async function (this: RenderingTestContext) {
    monacoService = getService('monaco-service');
  });

  async function renderFormattedAiBotMessage(testScenario: any) {
    let monacoSDK = await monacoService.getMonacoContext();

    await render(
      <template>
        <FormattedAiBotMessage
          class='test-component'
          @monacoSDK={{monacoSDK}}
          @roomId={{testScenario.roomId}}
          @eventId={{testScenario.eventId}}
          @htmlParts={{testScenario.htmlParts}}
          @isStreaming={{testScenario.isStreaming}}
        />
        <style scoped>
          .test-component {
            max-width: 350px; /* to observe overflow */
          }
        </style>
      </template>,
    );
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

  test('it will text code clocks as they are sent, without hiding the first line url as it streams', async function (assert) {
    await renderFormattedAiBotMessage({
      htmlParts: parseHtmlContent(
        `<pre data-code-language="text">https://example.com/some-url</pre>`,
        roomId,
        eventId,
      ),
      isStreaming: false,
    });

    assert.dom('.code-block').exists();
    await waitUntil(() => document.querySelectorAll('.view-line').length == 1);

    assert.strictEqual(
      (document.getElementsByClassName('view-lines')[0] as HTMLElement)
        .innerText,
      'https://example.com/some-url',
    );
  });
});
