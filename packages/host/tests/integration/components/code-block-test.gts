import { RenderingTestContext, render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import FormattedMessage from '@cardstack/host/components/ai-assistant/formatted-message';

import MonacoService from '@cardstack/host/services/monaco-service';

import { setupRenderingTest } from '../../helpers/setup';
import CodeBlock from '@cardstack/host/components/ai-assistant/code-block';

module('Integration | Component | FormattedMessage', function (hooks) {
  setupRenderingTest(hooks);

  let monacoService: MonacoService;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;
  });

  async function renderCodeBlock(testScenario: any) {
    let monacoSDK = await monacoService.getMonacoContext();

    await render(<template>
      <CodeBlock
        @monacoSDK={{monacoSDK}}
        @language={{testScenario.language}}
        @originalCode={{testScenario.originalCode}}
        @modifiedCode={{testScenario.modifiedCode}}
        as |codeBlock|
      >
        <codeBlock.diffEditor />
      </CodeBlock>
    </template>);
  }

  test('it renders a diff editor', async function (assert) {
    await renderCodeBlock({
      language: 'typescript',
      originalCode: `let x = 1;`,
      modifiedCode: `let x = 2;`,
    });
    await this.pauseTest();
    assert.dom('.code-block').exists();
  });
});
