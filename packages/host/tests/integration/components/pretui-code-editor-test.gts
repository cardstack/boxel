import { on } from '@ember/modifier';
import { click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { CodeEditor } from '@cardstack/pretui/components/code-editor';
import { Field } from '@cardstack/pretui/components/field';
import { undo } from '@codemirror/commands';
import { module, test } from 'qunit';

import cmContext from '@cardstack/host/lib/codemirror-context';

import {
  codeEditorContentSelector,
  codeEditorView,
  setCodeEditorContent,
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
      let content = element.querySelector<HTMLElement>(
        "[aria-multiline='true']",
      );
      assert.strictEqual(
        content?.getAttribute('aria-readonly'),
        'true',
        'a read-only editor is announced as read-only',
      );
      content?.focus();
      assert.strictEqual(
        document.activeElement,
        content,
        'a read-only editor still takes keyboard focus',
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

    assert
      .dom('[data-test-pretui-code-editor]')
      .hasAttribute('data-loaded', 'true');
    assert
      .dom(codeEditorContentSelector('[data-test-pretui-code-editor-host]'))
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
    let reported: string[] = [];
    class Driver extends GlimmerComponent {
      setValue = (value: string) => {
        reported.push(value);
        state.value = value;
      };
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
    assert.deepEqual(
      reported,
      [],
      'replacing the document from outside is not reported as an edit',
    );
  });

  test('undo does not bring back what an outside value replaced', async function (assert) {
    class State {
      @tracked value = SOURCE;
    }
    let state = new State();
    class Driver extends GlimmerComponent {
      setValue = (value: string) => (state.value = value);
      replace = () => (state.value = 'export const saved = true;');
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
    await typeInCodeEditor('[data-test-pretui-code-editor]', '\n// typed');
    await click('[data-test-replace]');
    let view = codeEditorView();
    assert.strictEqual(view.state.doc.toString(), 'export const saved = true;');

    undo(view);
    assert.strictEqual(
      view.state.doc.toString(),
      'export const saved = true;',
      'undo leaves the replacement in place',
    );
    assert.strictEqual(state.value, 'export const saved = true;');
  });

  test('inside a Field, the label names the editor and the hint describes it', async function (assert) {
    await renderComponent(
      class Driver extends GlimmerComponent {
        <template>
          <Field
            @label='Script'
            @labelTag='span'
            @hint='Runs on every save'
            as |controlId describedBy labelId|
          >
            <CodeEditor
              @value={{SOURCE}}
              @language='javascript'
              @controlId={{controlId}}
              @labelledBy={{labelId}}
              @describedBy={{describedBy}}
            />
          </Field>
        </template>
      },
    );
    await waitForCodeEditor();
    let content = document.querySelector(
      codeEditorContentSelector('[data-test-pretui-code-editor-host]'),
    )!;
    let name = content
      .getAttribute('aria-labelledby')
      ?.split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .join(' ');
    assert.strictEqual(name, 'Script', 'the Field label names the editor');
    let description = content
      .getAttribute('aria-describedby')
      ?.split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .join(' ');
    assert.true(
      description?.includes('Runs on every save'),
      'the hint describes the editor',
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
      .dom(codeEditorContentSelector('[data-test-pretui-code-editor-host]'))
      .hasAttribute('aria-readonly', 'true');
    view.contentDOM.focus();
    assert.strictEqual(
      document.activeElement,
      view.contentDOM,
      'the keyboard can reach a read-only editor, to scroll, select and copy',
    );
    await assert.rejects(
      setCodeEditorContent('[data-test-pretui-code-editor]', 'changed'),
      /read-only/,
      'the test helpers refuse to type into a read-only editor',
    );
    assert.strictEqual(view.state.doc.toString(), SOURCE);
  });

  test('editors with the same theme add its rules once', async function (assert) {
    let theme = { '.cm-content': { color: 'rgb(1, 2, 3)' } };
    // CodeMirror adds each theme's rules to a shared sheet, so count rules.
    let count = () =>
      [
        ...document.adoptedStyleSheets,
        ...[...document.querySelectorAll('style')].map((s) => s.sheet!),
      ].reduce((n, sheet) => n + (sheet?.cssRules.length ?? 0), 0);
    let first = cmContext.createCodeEditorState({ doc: 'a', theme });
    let parent = document.createElement('div');
    document.body.append(parent);
    let views = [new cmContext.EditorView({ state: first, parent })];
    try {
      let before = count();
      for (let i = 0; i < 3; i++) {
        let state = cmContext.createCodeEditorState({ doc: 'b', theme });
        views.push(new cmContext.EditorView({ state, parent }));
      }
      assert.strictEqual(count(), before, 'no rules are added per editor');
    } finally {
      views.forEach((v) => v.destroy());
      parent.remove();
    }
  });
  test("dark takes code mode's editor colours", async function (assert) {
    await renderComponent(
      class Driver extends GlimmerComponent {
        <template>
          <CodeEditor @value={{SOURCE}} @language='javascript' @dark={{true}} />
        </template>
      },
    );
    await waitForCodeEditor();
    let color = (selector: string) =>
      getComputedStyle(
        document.querySelector(
          `[data-test-pretui-code-editor-host] ${selector}`,
        )!,
      ).color;
    assert.strictEqual(
      getComputedStyle(
        document.querySelector('[data-test-pretui-code-editor]')!,
      ).backgroundColor,
      'rgb(65, 62, 78)',
      "the surface is code mode's editor background",
    );
    assert.strictEqual(color('.tok-keyword'), 'rgb(86, 156, 214)');
    assert.strictEqual(color('.tok-comment'), 'rgb(96, 139, 78)');
    assert.strictEqual(color('.tok-string'), 'rgb(206, 145, 120)');
    assert.strictEqual(color('.cm-gutters'), 'rgb(133, 133, 133)');
  });

  test('read-only marks no current line', async function (assert) {
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
    let line = document.querySelector(
      '[data-test-pretui-code-editor-host] .cm-activeLine',
    );
    if (line) {
      assert.strictEqual(
        getComputedStyle(line).backgroundColor,
        'rgba(0, 0, 0, 0)',
      );
    } else {
      assert.ok(true, 'no current line is drawn');
    }
  });
});
