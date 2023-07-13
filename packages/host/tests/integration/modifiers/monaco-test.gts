import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';
import MonacoService, {
  MonacoContext,
} from '@cardstack/host/services/monaco-service';

module('Integration | Modifier | monaco', function (hooks) {
  let monacoContext: MonacoContext;
  let monacoService: MonacoService;

  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    monacoService = this.owner.lookup(
      'service:monaco-service'
    ) as MonacoService;
    await monacoService.ready;
    monacoContext = await monacoService.getMonacoContext();
  });

  test('content changed called', async function (assert) {
    let contentChangedCalled = false;
    //setting content
    this.setProperties({
      content: 'Sample content',
      contentChanged: (text: string) => {
        contentChangedCalled = true;
      },
      monacoContext,
    });

    await render(hbs`
      <h1>Non UI test: No display is meant to be shown here</h1>
      <div
        {{monaco
          content=this.content
          contentChanged=this.contentChanged
          monacoSDK=this.monacoContext.sdk
          language=this.monacoContext.language
          onSetup=this.monacoContext.onEditorSetup
        }}>
      </div>
    `);
    this.set('content', 'Updated content');
    assert.equal(
      contentChangedCalled,
      true,
      'contentChanged was called when content was updated'
    );
  });
});
