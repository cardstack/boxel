import {
  settled,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  getMonacoContent,
  setMonacoContent,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  testRRI,
  visitOperatorMode,
  withCachedRealmSetup,
} from '../../helpers';
import {
  codeEditorContent,
  codeEditorView,
  typeInCodeEditor,
  waitForCodeEditor,
} from '../../helpers/code-editor';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { selectFormat } from '../../helpers/playground';
import { setupApplicationTest } from '../../helpers/setup';

// A card whose edit format renders Pret UI's CodeEditor, opened in code mode,
// so CodeMirror (in the card preview) and Monaco (code mode's own editor, on
// the card's JSON) are on the same page.
const SNIPPET_MODULE = `
  import { contains, field, Component, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { CodeEditor } from "@cardstack/pretui/components/code-editor";

  export class Snippet extends CardDef {
    static displayName = 'Snippet';
    @field source = contains(StringField);

    static edit = class Edit extends Component<typeof this> {
      setSource = (value) => {
        this.args.model.source = value;
      };
      <template>
        <CodeEditor
          @value={{@model.source}}
          @onInput={{this.setSource}}
          @language='javascript'
          @label='Source'
          data-test-snippet-editor
        />
      </template>
    };
  }
`;

const EDITOR = '[data-test-snippet-editor]';

function savedSource(): string | undefined {
  try {
    return JSON.parse(getMonacoContent()).data.attributes.source;
  } catch {
    return undefined;
  }
}

function monacoEditor() {
  return (window as any).monaco.editor.getEditors()[0];
}

function snippetDocument(source: string) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { source },
        meta: { adoptsFrom: { module: testRRI('snippet'), name: 'Snippet' } },
      },
    },
    null,
    2,
  );
}

module('Acceptance | code submode | pretui code editor', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  hooks.beforeEach(async function () {
    mockMatrixUtils.setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
    });
    setupUserSubscription();
    setupAuthEndpoints();
    await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'snippet.gts': SNIPPET_MODULE,
          'Snippet/one.json': {
            data: {
              type: 'card',
              attributes: { source: 'const a = 1;' },
              meta: {
                adoptsFrom: { module: testRRI('snippet'), name: 'Snippet' },
              },
            },
          },
        },
      }),
    );
  });

  async function openSnippetInEditFormat() {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}Snippet/one`, format: 'isolated' }]],
      submode: 'code',
      codePath: `${testRealmURL}Snippet/one.json`,
    });
    await waitFor('[data-test-editor]');
    await selectFormat('edit');
    await waitForCodeEditor(EDITOR);
  }

  test('typing in each editor changes only that editor, and each takes the other’s saved text', async function (assert) {
    await openSnippetInEditFormat();
    assert.dom(EDITOR).hasAttribute('data-loaded', 'true');
    assert.strictEqual(codeEditorContent(EDITOR), 'const a = 1;');

    // CodeMirror → the card → the saved JSON in Monaco.
    await typeInCodeEditor(EDITOR, '\nconst b = 2;');
    await waitUntil(() => savedSource() === 'const a = 1;\nconst b = 2;', {
      timeout: 10_000,
    });
    let view = codeEditorView(EDITOR);
    assert.strictEqual(
      view.state.doc.toString(),
      'const a = 1;\nconst b = 2;',
      'saving the card left the typed text alone',
    );
    assert.strictEqual(
      view.state.selection.main.head,
      view.state.doc.length,
      'the caret is where the user left it',
    );

    // Monaco → the saved card → CodeMirror.
    setMonacoContent(snippetDocument('const c = 3;'));
    await waitUntil(
      () =>
        document.querySelector(`${EDITOR} .cm-content`) &&
        codeEditorContent(EDITOR) === 'const c = 3;',
      { timeout: 10_000 },
    );
    assert.strictEqual(
      codeEditorContent(EDITOR),
      'const c = 3;',
      'the card editor shows the text saved from Monaco',
    );

    // CodeMirror keeps working after the card re-rendered from Monaco's save.
    await typeInCodeEditor(EDITOR, '\nconst d = 4;');
    await waitUntil(() => savedSource() === 'const c = 3;\nconst d = 4;', {
      timeout: 10_000,
    });
    assert.strictEqual(savedSource(), 'const c = 3;\nconst d = 4;');
  });

  test('focus and keys stay with the editor that has focus', async function (assert) {
    await openSnippetInEditFormat();
    let monacoBefore = getMonacoContent();

    let view = codeEditorView(EDITOR);
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await triggerKeyEvent(`${EDITOR} .cm-content`, 'keydown', 'Enter');

    assert.true(
      codeEditorView(EDITOR).contentDOM.contains(document.activeElement),
      'focus is in the card editor',
    );
    assert.strictEqual(
      codeEditorContent(EDITOR),
      'const a = 1;\n',
      'Enter went to the card editor',
    );
    // Monaco changes only through the card's save, never from the key.
    await waitUntil(() => savedSource() === 'const a = 1;\n', {
      timeout: 10_000,
    });
    let before = JSON.parse(monacoBefore);
    let after = JSON.parse(getMonacoContent());
    before.data.attributes.source = after.data.attributes.source;
    assert.deepEqual(after, before, 'Monaco took no keystroke of its own');

    let monaco = monacoEditor();
    monaco.focus();
    monaco.setPosition({ lineNumber: 1, column: 1 });
    monaco.trigger('keyboard', 'type', { text: ' ' });
    await settled();
    assert.true(monaco.hasTextFocus(), 'focus moved to Monaco');
    assert.false(
      codeEditorView(EDITOR).contentDOM.contains(document.activeElement),
      'the card editor no longer has focus',
    );
    assert.true(
      codeEditorContent(EDITOR).startsWith('const a = 1;'),
      'typing in Monaco left the card editor alone',
    );
  });
});
