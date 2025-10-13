import { registerDestructor } from '@ember/destroyable';

import Modifier from 'ember-modifier';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import { createMonacoWaiterManager } from '@cardstack/host/utils/editor/monaco-test-waiter';

import { MonacoEditorOptions } from './monaco';

import type * as _MonacoSDK from 'monaco-editor';

export const commonEditorOptions: MonacoEditorOptions = {
  theme: 'vs-dark',

  automaticLayout: true,
  fontSize: 10,
  lineNumbers: 'off',
  readOnly: true,
  scrollbar: {
    alwaysConsumeMouseWheel: false,
  },
  scrollBeyondLastLine: false,
};

export interface MonacoEditorSignature {
  Args: {
    Named: {
      codeData?: Partial<CodeData>;
      monacoSDK: MonacoSDK;
      editorDisplayOptions: MonacoEditorOptions;
    };
  };
}

export default class MonacoEditorModifier extends Modifier<MonacoEditorSignature> {
  private monacoState: {
    editor: _MonacoSDK.editor.IStandaloneCodeEditor;
  } | null = null;
  private waiterManager = createMonacoWaiterManager();
  modify(
    element: HTMLElement,
    _positional: [],
    {
      codeData,
      monacoSDK,
      editorDisplayOptions,
    }: MonacoEditorSignature['Args']['Named'],
  ) {
    if (!codeData) {
      return;
    }

    let { code, language } = codeData;
    if (!code || !language) {
      return;
    }
    if (this.monacoState) {
      let { editor } = this.monacoState;
      let model = editor.getModel()!;

      // Here we are appending deltas when code is "streaming" in, which is
      // useful when code changes frequently in short periods of time. In this
      // case we calculate the delta of the new code and the current code, and
      // then apply that delta to the model. Compared to calling setValue()
      // for every new value, this removes the need for re-tokenizing the code
      // which is expensive and produces visual annoyances such as flickering.

      let currentCode = model.getValue();
      let newCode = code ?? '';

      if (!newCode.startsWith(currentCode)) {
        // This is a safety net for rare cases where the new code streamed in
        // does not begin with the current code. This can happen when streaming
        // in code with search/replace diff markers and the diff marker in chunk
        // is incomplete, for example "<<<<<<< SEAR" instead of
        // "<<<<<<< SEARCH". In this case the code diff parsing logic
        // in parseCodeContent will not recognize the diff marker and it will
        // display "<<<<<<< SEAR" for a brief moment in the editor, before getting
        // a chunk with a complete diff marker. In this case we need to reset
        // the data otherwise the appending delta will be incorrect and we'll
        // see mangled code in the editor (syntax errors with incomplete diff markers).
        model.setValue(newCode);
      } else {
        let codeDelta = newCode.slice(currentCode.length);

        let lineCount = model.getLineCount();
        let lastLineLength = model.getLineLength(lineCount);

        let range = {
          startLineNumber: lineCount,
          startColumn: lastLineLength + 1,
          endLineNumber: lineCount,
          endColumn: lastLineLength + 1,
        };

        let editOperation = {
          range: range,
          text: codeDelta,
          forceMoveMarkers: true,
        };

        let withDisabledReadOnly = (
          readOnlySetting: boolean,
          fn: () => void,
        ) => {
          editor.updateOptions({ readOnly: false });
          fn();
          editor.updateOptions({ readOnly: readOnlySetting });
        };

        withDisabledReadOnly(!!editorDisplayOptions.readOnly, () => {
          editor.executeEdits('append-source', [editOperation]);
        });

        editor.revealLine(lineCount + 1); // Scroll to the end as the code streams
      }
    } else {
      let monacoContainer = element;

      let editor = monacoSDK.editor.create(
        monacoContainer,
        editorDisplayOptions,
      );

      // Track editor initialization for test waiters
      if (this.waiterManager) {
        const operationId = `monaco-editor-modifier-init-${editor.getId()}`;
        this.waiterManager.trackEditorInit(editor, operationId);
      }

      let model = editor.getModel()!;
      monacoSDK.editor.setModelLanguage(model, language);

      model.setValue(code);

      const contentHeight = editor.getContentHeight();
      if (contentHeight > 0) {
        element.style.height = `${contentHeight}px`;
      }

      editor.onDidContentSizeChange(() => {
        const newHeight = editor.getContentHeight();
        if (newHeight > 0) {
          element.style.height = `${newHeight}px`;
        }
      });

      this.monacoState = {
        editor,
      };
    }

    registerDestructor(this, () => {
      let editor = this.monacoState?.editor;
      if (editor) {
        editor.dispose();
      }
    });
  }
}
