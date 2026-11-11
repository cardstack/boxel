import { on } from '@ember/modifier';
import { click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { CodeEditor } from '@cardstack/pretui/components/code-editor';
import { module, test } from 'qunit';

import cmContext from '@cardstack/host/lib/codemirror-context';

import {
  codeEditorView,
  typeInCodeEditor,
  waitForCodeEditor,
} from '../../helpers/code-editor';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const SOURCE = [
  '// Counts the cards.',
  'const { cards } = await realm.cards.search({});',
  "console.log('cards', cards.length);",
].join('\n');

module('Integration | pretui code editor', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    (globalThis as any).__loadCodeMirror = async () => cmContext;
  });
  hooks.afterEach(function () {
    delete (globalThis as any).__loadCodeMirror;
  });

  test('the host context makes a code editor state with a language, line numbers and read-only', async function (assert) {
    let state = cmContext.createCodeEditorState({
      doc: SOURCE,
      language: 'javascript',
      readOnly: true,
    });
    assert.strictEqual(state.doc.toString(), SOURCE);
    assert.true(state.readOnly);
    let element = document.createElement('div');
    document.body.append(element);
    let view = new cmContext.EditorView({ state, parent: element });
    try {
      assert.ok(
        element.querySelector('.cm-lineNumbers'),
        'line numbers are on by default',
      );
      assert.ok(
        element.querySelector('.tok-keyword'),
        'JavaScript tokens are tagged for the host component to colour',
      );
      assert.strictEqual(
        element.querySelector('.cm-content')?.getAttribute('contenteditable'),
        'false',
        'a read-only editor is not editable',
      );
    } finally {
      view.destroy();
      element.remove();
    }
  });

  test('it edits JavaScript in CodeMirror and reports each change', async function (assert) {
    class Driver extends GlimmerComponent {
      @tracked value = SOURCE;
      reported: string[] = [];
      onInput = (value: string) => {
        this.reported.push(value);
        this.value = value;
      };
      <template>
        <label for='script-source'>Script</label>
        <CodeEditor
          @value={{this.value}}
          @language='javascript'
          @controlId='script-source'
          @onInput={{this.onInput}}
        />
        <output data-test-value>{{this.value}}</output>
      </template>
    }
    await renderComponent(Driver);
    await waitForCodeEditor();

    assert.dom('.pretui-code-editor').hasAttribute('data-loaded', 'true');
    assert
      .dom('[data-test-pretui-code-editor-host] .cm-content')
      .hasAttribute('id', 'script-source', 'the label can point at it');
    assert.dom('.cm-lineNumbers').exists('line numbers show');

    let view = codeEditorView();
    await typeInCodeEditor('[data-test-pretui-code-editor]', '\nreturn cards;');
    assert.dom('[data-test-value]').hasText(`${SOURCE}\nreturn cards;`);
    assert.strictEqual(
      view.state.doc.toString(),
      `${SOURCE}\nreturn cards;`,
      'the echo leaves the document as typed',
    );
    assert.strictEqual(
      view.state.selection.main.head,
      view.state.doc.length,
      'the caret stays where the user left it',
    );
  });

  test('a value from outside replaces the document in the same editor', async function (assert) {
    class State {
      @tracked value = SOURCE;
    }
    let state = new State();
    class Driver extends GlimmerComponent {
      setValue = (value: string) => (state.value = value);
      replace = () => (state.value = 'export const replaced = true;');
      <template>
        <CodeEditor
          @value={{state.value}}
          @language='javascript'
          @onInput={{this.setValue}}
        />
        <button type='button' {{on 'click' this.replace}} data-test-replace>
          Replace
        </button>
      </template>
    }
    await renderComponent(Driver);
    await waitForCodeEditor();
    let view = codeEditorView();

    await click('[data-test-replace]');
    assert.strictEqual(
      view.state.doc.toString(),
      'export const replaced = true;',
    );
    assert.strictEqual(
      codeEditorView(),
      view,
      'the same view took the new text',
    );
  });

  test('read-only shows the code and refuses edits', async function (assert) {
    await renderComponent(
      class Driver extends GlimmerComponent {
        <template>
          <CodeEditor
            @value={{SOURCE}}
            @language='javascript'
            @readOnly={{true}}
          />
        </template>
      },
    );
    await waitForCodeEditor();
    let view = codeEditorView();
    assert.true(view.state.readOnly);
    assert
      .dom('[data-test-pretui-code-editor-host] .cm-content')
      .hasAttribute('contenteditable', 'false')
      .hasAttribute('aria-readonly', 'true');
  });
});
