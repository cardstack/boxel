import { render } from '@ember/test-helpers';

import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import monaco from '@cardstack/host/modifiers/monaco';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | modifier | monaco', function (hooks) {
  setupRenderingTest(hooks);

  test('publishes the in-memory buffer before the debounced save callback', async function (assert) {
    let previewBuffers: string[] = [];
    let savedBuffers: string[] = [];
    let preview = new TrackedObject({ content: '' });
    let contentChanging = (content: string) => {
      previewBuffers.push(content);
      preview.content = content;
    };
    let contentChanged = (content: string) => savedBuffers.push(content);

    await render(
      <template>
        <output data-test-current-preview-buffer>{{preview.content}}</output>
        <div
          {{monaco
            content='initial source'
            contentChanging=contentChanging
            contentChanged=contentChanged
            monacoSDK=MonacoSDK
          }}
        ></div>
      </template>,
    );

    assert.deepEqual(
      previewBuffers,
      ['initial source'],
      'a private preview loader receives the initial file buffer',
    );
    assert
      .dom('[data-test-current-preview-buffer]')
      .hasText('initial source', 'initial publication lands after render');
    assert.deepEqual(savedBuffers, [], 'initial setup is not an autosave');

    MonacoSDK.editor.getModels()[0]!.setValue('draft source');

    assert.deepEqual(
      previewBuffers,
      ['initial source', 'draft source'],
      'the draft is delivered synchronously from Monaco model change',
    );
    assert.deepEqual(
      savedBuffers,
      [],
      'the ordinary write remains behind the existing debounce',
    );
  });
});
