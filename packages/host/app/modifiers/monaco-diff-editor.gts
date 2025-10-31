import { registerDestructor } from '@ember/destroyable';

import Modifier from 'ember-modifier';

import { makeCodeDiffStats } from '@cardstack/host/lib/formatted-message/utils';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import { createMonacoWaiterManager } from '@cardstack/host/utils/editor/monaco-test-waiter';

import { MonacoEditorOptions } from './monaco';

import type * as _MonacoSDK from 'monaco-editor';

export interface MonacoDiffEditorSignature {
  Args: {
    Named: {
      monacoSDK: MonacoSDK;
      originalCode?: string | null;
      modifiedCode?: string | null;
      language?: string | null;
      editorDisplayOptions: MonacoEditorOptions;
      updateDiffEditorStats?: (stats: {
        linesAdded: number;
        linesRemoved: number;
      }) => void;
    };
  };
}

export default class MonacoDiffEditor extends Modifier<MonacoDiffEditorSignature> {
  private monacoState: {
    editor: _MonacoSDK.editor.IStandaloneDiffEditor;
  } | null = null;
  private waiterManager = createMonacoWaiterManager();

  modify(
    element: HTMLElement,
    _positional: [],
    {
      monacoSDK,
      editorDisplayOptions,
      originalCode,
      modifiedCode,
      language,
      updateDiffEditorStats,
    }: MonacoDiffEditorSignature['Args']['Named'],
  ) {
    if (originalCode === undefined || modifiedCode === undefined) {
      return;
    }
    if (this.monacoState) {
      let { editor } = this.monacoState;
      let model = editor.getModel();
      let originalModel = model?.original;
      let modifiedModel = model?.modified;

      let newOriginalCode = originalCode ?? '';
      let newModifiedCode = modifiedCode ?? '';

      if (newOriginalCode !== originalModel?.getValue()) {
        originalModel?.setValue(newOriginalCode);
      }
      if (newModifiedCode !== modifiedModel?.getValue()) {
        modifiedModel?.setValue(newModifiedCode);
      }
    } else {
      let editor = monacoSDK.editor.createDiffEditor(
        element,
        editorDisplayOptions,
      );

      let originalModel = monacoSDK.editor.createModel(
        originalCode ?? '',
        language ?? '',
      );
      let modifiedModel = monacoSDK.editor.createModel(
        modifiedCode ?? '',
        language ?? '',
      );

      editor.setModel({ original: originalModel, modified: modifiedModel });

      const contentHeight = editor.getModifiedEditor().getContentHeight();
      if (contentHeight > 0) {
        element.style.height = `${contentHeight}px`;
      }

      editor.getModifiedEditor().onDidContentSizeChange(() => {
        const newHeight = editor.getModifiedEditor().getContentHeight();
        if (newHeight > 0) {
          element.style.height = `${newHeight}px`;
        }
      });

      this.monacoState = {
        editor,
      };

      editor.onDidUpdateDiff(() => {
        if (updateDiffEditorStats) {
          updateDiffEditorStats(makeCodeDiffStats(editor.getLineChanges()));
        }
      });

      // Track editor initialization for test waiters after diff models are ready
      if (this.waiterManager) {
        const operationId = `monaco-diff-editor-modifier-init-${editor.getId()}`;
        this.waiterManager.trackEditorInit(editor, operationId);
      }
    }

    registerDestructor(this, () => {
      let editor = this.monacoState?.editor;
      if (editor) {
        editor.dispose();
      }
    });
  }
}
