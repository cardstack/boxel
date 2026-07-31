import { render, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import monaco from '@cardstack/host/modifiers/monaco';

import type MonacoService from '@cardstack/host/services/monaco-service';

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

  test('a newly selected file replaces the model during the server echo debounce', async function (assert) {
    let monacoService = getService('monaco-service') as MonacoService;
    let originalDebounce = monacoService.serverEchoDebounceMs;
    monacoService.serverEchoDebounceMs = 5_000;
    let source = new TrackedObject({
      content: 'first file',
      identity: 'https://realm.example/first.gts',
    });
    let contentChanged = () => {};

    try {
      await render(
        <template>
          <div
            {{monaco
              content=source.content
              contentIdentity=source.identity
              contentChanged=contentChanged
              monacoSDK=MonacoSDK
            }}
          ></div>
        </template>,
      );

      let model = MonacoSDK.editor.getModels()[0]!;
      model.setValue('unsaved first file');
      source.content = 'second file';
      source.identity = 'https://realm.example/second.gts';
      await settled();

      assert.strictEqual(
        model.getValue(),
        'second file',
        'route navigation is not mistaken for a save echo',
      );
    } finally {
      monacoService.serverEchoDebounceMs = originalDebounce;
    }
  });
});
