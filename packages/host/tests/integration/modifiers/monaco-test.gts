import { render, settled } from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import monacoModifier from '@cardstack/host/modifiers/monaco';

import { setupRenderingTest } from '../../helpers/setup';

class EditorArgs {
  @tracked content = 'opened';
  sent: string[] = [];
  contentChanged = (text: string) => {
    this.sent.push(text);
  };
}

module('Integration | modifier | monaco', function (hooks) {
  setupRenderingTest(hooks);

  async function renderEditor(state: EditorArgs) {
    let monacoSDK = await getService('monaco-service').getMonacoContext();
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          style='height: 10rem'
          {{monacoModifier
            content=state.content
            contentChanged=state.contentChanged
            language='plaintext'
            monacoSDK=monacoSDK
          }}
        ></div>
      </template>,
    );
    let model = monacoSDK.editor.getEditors()[0].getModel()!;
    return {
      value: () => model.getValue(),
      async type(text: string) {
        model.setValue(text);
        await settled();
      },
    };
  }

  test('it shows a change made somewhere else right after the editor opens', async function (assert) {
    let args = new EditorArgs();
    let editor = await renderEditor(args);

    args.content = 'changed elsewhere';
    await settled();

    assert.strictEqual(editor.value(), 'changed elsewhere');
  });

  test('it shows a change made somewhere else soon after the user edits', async function (assert) {
    let args = new EditorArgs();
    let editor = await renderEditor(args);

    await editor.type('my edit');
    assert.deepEqual(args.sent, ['my edit'], 'the edit was sent');
    args.content = 'my edit'; // the save comes back
    await settled();

    args.content = 'changed elsewhere';
    await settled();

    assert.strictEqual(editor.value(), 'changed elsewhere');
  });

  test('a save that comes back after newer typing does not replace it', async function (assert) {
    let args = new EditorArgs();
    let editor = await renderEditor(args);

    await editor.type('first edit');
    await editor.type('newer edit');
    assert.deepEqual(args.sent, ['first edit', 'newer edit']);

    args.content = 'first edit'; // the earlier save comes back late
    await settled();
    assert.strictEqual(editor.value(), 'newer edit', 'newer typing is kept');

    args.content = 'newer edit';
    await settled();
    args.content = 'changed elsewhere';
    await settled();
    assert.strictEqual(
      editor.value(),
      'changed elsewhere',
      'a later change from somewhere else is still shown',
    );
  });
});
