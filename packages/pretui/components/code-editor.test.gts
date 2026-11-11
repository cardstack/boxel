// CodeEditor unit tests. CodeMirror reaches the component through
// `globalThis.__loadCodeMirror`; these tests install a small stand-in that
// keeps the document in a <textarea>, so they exercise the component's own
// contract (loading, the fallback, reporting edits, outside values, read-only
// and rebuilding on a configuration change) without the host's CodeMirror.
// The host suite covers the real editor.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { fillIn, render, settled, waitFor } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CodeEditor } from './code-editor';

interface StubOptions {
  doc: string;
  language?: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  controlId?: string;
  label?: string;
  onDocChange?: (text: string) => void;
}

let created: StubOptions[] = [];

class StubView {
  dom: HTMLTextAreaElement;
  private options: StubOptions;
  constructor({ state, parent }: { state: StubOptions; parent: Element }) {
    this.options = state;
    this.dom = document.createElement('textarea');
    this.dom.setAttribute('data-test-stub-editor', '');
    this.dom.value = state.doc;
    this.dom.readOnly = Boolean(state.readOnly);
    if (state.controlId) {
      this.dom.id = state.controlId;
    }
    if (state.label) {
      this.dom.setAttribute('aria-label', state.label);
    }
    this.dom.addEventListener('input', () =>
      this.options.onDocChange?.(this.dom.value),
    );
    parent.append(this.dom);
  }
  get state() {
    let text = this.dom.value;
    return { doc: { toString: () => text, length: text.length } };
  }
  dispatch(spec: { changes: { insert: string } }) {
    this.dom.value = spec.changes.insert;
    this.options.onDocChange?.(this.dom.value);
  }
  destroy() {
    this.dom.remove();
  }
}

const stub = {
  EditorView: StubView,
  createCodeEditorState(options: StubOptions) {
    created.push(options);
    return options;
  },
};

type Loader = { __loadCodeMirror?: () => Promise<unknown> };

function installLoader(loader: (() => Promise<unknown>) | undefined) {
  let global = globalThis as Loader;
  let previous = global.__loadCodeMirror;
  if (loader) {
    global.__loadCodeMirror = loader;
  } else {
    delete global.__loadCodeMirror;
  }
  return () => {
    if (previous) {
      global.__loadCodeMirror = previous;
    } else {
      delete global.__loadCodeMirror;
    }
  };
}

const SOURCE = "const answer = 42;\nconsole.log('answer', answer);";

module('Pretui | components/code-editor', function (hooks) {
  setupCardTest(hooks);

  let restore: () => void;
  hooks.beforeEach(function () {
    created = [];
    restore = installLoader(async () => stub);
  });
  hooks.afterEach(function () {
    restore();
  });

  test('without a loader it shows the code read-only through CodeBlock', async function (assert) {
    restore();
    restore = installLoader(undefined);
    await render(
      <template>
        <CodeEditor @value={{SOURCE}} @language='javascript' />
      </template>,
    );
    assert
      .dom('.pretui-code-editor')
      .hasAttribute('data-loaded', 'false')
      .hasAttribute('data-language', 'javascript');
    assert.dom('.pretui-code-editor .pretui-code').exists('CodeBlock renders');
    assert
      .dom('.pretui-code-editor .pretui-code')
      .includesText('const answer = 42;', 'the code is never blank');
  });

  test('a loader without a code editor keeps the fallback', async function (assert) {
    restore();
    restore = installLoader(async () => ({ EditorView: StubView }));
    await render(<template><CodeEditor @value={{SOURCE}} /></template>);
    await settled();
    assert.dom('.pretui-code-editor').hasAttribute('data-loaded', 'false');
    assert.dom('[data-test-stub-editor]').doesNotExist();
  });

  test('it mounts the editor with its configuration and reports edits', async function (assert) {
    let reported: string[] = [];
    let onInput = (value: string) => reported.push(value);
    await render(
      <template>
        <CodeEditor
          @value={{SOURCE}}
          @language='typescript'
          @lineNumbers={{false}}
          @controlId='script-source'
          @label='Script'
          @onInput={{onInput}}
        />
      </template>,
    );
    await waitFor('[data-test-stub-editor]');
    assert.dom('.pretui-code-editor').hasAttribute('data-loaded', 'true');
    assert.deepEqual(
      {
        doc: created[0].doc,
        language: created[0].language,
        readOnly: created[0].readOnly,
        lineNumbers: created[0].lineNumbers,
        controlId: created[0].controlId,
        label: created[0].label,
      },
      {
        doc: SOURCE,
        language: 'typescript',
        readOnly: false,
        lineNumbers: false,
        controlId: 'script-source',
        label: 'Script',
      },
    );
    assert.dom('#script-source').exists('the control id lands on the editor');

    await fillIn('[data-test-stub-editor]', 'let x = 1;');
    assert.deepEqual(reported, ['let x = 1;']);
  });

  test('an unknown language is plain', async function (assert) {
    await render(
      <template><CodeEditor @value='x' @language='cobol' /></template>,
    );
    await waitFor('[data-test-stub-editor]');
    assert.dom('.pretui-code-editor').hasAttribute('data-language', 'plain');
    assert.strictEqual(created[0].language, 'plain');
  });

  test('a new value from outside replaces the document, and an echo of typing does not', async function (assert) {
    class State {
      @tracked value = 'one';
    }
    let state = new State();
    let builds = () => created.length;
    let onInput = (value: string) => (state.value = value);
    await render(
      <template>
        <CodeEditor @value={{state.value}} @onInput={{onInput}} />
      </template>,
    );
    await waitFor('[data-test-stub-editor]');

    // The user types; the caller passes the text straight back.
    await fillIn('[data-test-stub-editor]', 'one, two');
    await settled();
    assert.dom('[data-test-stub-editor]').hasValue('one, two');
    assert.strictEqual(builds(), 1, 'an echo neither rebuilds nor resets');

    // Another source changes the value.
    state.value = 'three';
    await settled();
    assert.dom('[data-test-stub-editor]').hasValue('three');
    assert.strictEqual(builds(), 1, 'the same view takes the new document');
  });

  test('read-only reaches the editor, and changing it rebuilds with the current text', async function (assert) {
    class State {
      @tracked readOnly = true;
    }
    let state = new State();
    await render(
      <template>
        <CodeEditor @value='draft' @readOnly={{state.readOnly}} />
      </template>,
    );
    await waitFor('[data-test-stub-editor]');
    assert.dom('.pretui-code-editor').hasAttribute('data-read-only', 'true');
    assert.dom('[data-test-stub-editor]').hasAttribute('readonly');

    state.readOnly = false;
    await settled();
    assert.strictEqual(created.length, 2, 'the view is rebuilt');
    assert.false(created[1].readOnly);
    assert.dom('[data-test-stub-editor]').hasValue('draft');
    assert.dom('[data-test-stub-editor]').doesNotHaveAttribute('readonly');
  });

  test('the height floor and ceiling are line counts on the root', async function (assert) {
    await render(
      <template>
        <CodeEditor @value='x' @minLines={{5}} @maxLines={{12}} />
      </template>,
    );
    let root = document.querySelector('.pretui-code-editor') as HTMLElement;
    assert.strictEqual(
      root.style.getPropertyValue('--pretui-code-editor-min'),
      '5',
    );
    assert.strictEqual(
      root.style.getPropertyValue('--pretui-code-editor-max'),
      '12',
    );
  });
});
