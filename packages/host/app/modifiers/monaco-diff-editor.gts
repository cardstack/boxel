import { registerDestructor } from '@ember/destroyable';

import Modifier from 'ember-modifier';

import { makeCodeDiffStats } from '@cardstack/host/lib/formatted-message/utils';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import { createMonacoWaiterManager } from '@cardstack/host/utils/editor/monaco-test-waiter';

import type { MonacoEditorOptions } from './monaco';

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
  private hasDestructor = false;
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
    let editor = this.monacoState?.editor;
    let model = editor?.getModel();
    let originalModel = model?.original;
    let modifiedModel = model?.modified;
    let hasDisposedModels =
      originalModel?.isDisposed() || modifiedModel?.isDisposed();

    if (editor && hasDisposedModels) {
      this.destroyEditor(editor, model);
      editor = undefined;
      model = undefined;
      originalModel = undefined;
      modifiedModel = undefined;
    }

    if (editor) {
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
          updateDiffEditorStats(makeCodeDiffStats(this.getLineChanges(editor)));
        }
      });

      // Track editor initialization for test waiters after diff models are ready
      if (this.waiterManager) {
        const operationId = `monaco-diff-editor-modifier-init-${editor.getId()}`;
        this.waiterManager.trackEditorInit(editor, operationId);
      }
    }

    if (!this.hasDestructor) {
      this.hasDestructor = true;
      registerDestructor(this, () => {
        let editor = this.monacoState?.editor;
        if (editor) {
          this.destroyEditor(editor, editor.getModel());
        }
        this.monacoState = null;
      });
    }
  }

  private destroyEditor(
    editor: _MonacoSDK.editor.IStandaloneDiffEditor,
    model: _MonacoSDK.editor.IDiffEditorModel | null | undefined,
  ) {
    let hasDisposedModels =
      model?.original?.isDisposed() || model?.modified?.isDisposed();

    if (!hasDisposedModels && model?.original && model.modified) {
      let cancelDeferredCleanup = this.disposeModelsAfterEditorReset(
        editor,
        model,
      );
      try {
        editor.setModel(null);
      } catch {
        // Monaco can already be half-disposed when Glimmer updates race with
        // test teardown. In that case we still want best-effort cleanup, but we
        // should not let Monaco disposal errors break rendering.
        cancelDeferredCleanup();
        this.disposeEditorAndModels(editor, model);
      }
    } else {
      this.disposeEditorAndModels(editor, model);
    }
  }

  private getLineChanges(editor: _MonacoSDK.editor.IStandaloneDiffEditor) {
    try {
      return editor.getLineChanges();
    } catch {
      // Monaco diff workers can briefly report an update before the underlying
      // diff result is available. Treat that as "not ready yet" rather than a
      // rendering failure and wait for the next diff update.
      return null;
    }
  }

  private disposeModelWhenDetached(model: _MonacoSDK.editor.ITextModel) {
    if (model.isDisposed()) {
      return;
    }
    if (!model.isAttachedToEditor()) {
      this.disposeModelOnNextFrame(model);
      return;
    }

    let disposable = model.onDidChangeAttached(() => {
      if (!model.isAttachedToEditor() && !model.isDisposed()) {
        disposable.dispose();
        this.disposeModelOnNextFrame(model);
      }
    });
  }

  private disposeModelOnNextFrame(model: _MonacoSDK.editor.ITextModel) {
    if (!model.isAttachedToEditor() && !model.isDisposed()) {
      model.dispose();
    }
  }

  private disposeEditorAndModels(
    editor: _MonacoSDK.editor.IStandaloneDiffEditor,
    model: _MonacoSDK.editor.IDiffEditorModel | null | undefined,
  ) {
    this.disposeEditorAfterInitialLayout(editor, model);
  }

  private disposeModelsAfterEditorReset(
    editor: _MonacoSDK.editor.IStandaloneDiffEditor,
    model: _MonacoSDK.editor.IDiffEditorModel,
  ) {
    let originalEditor = editor.getOriginalEditor();
    let modifiedEditor = editor.getModifiedEditor();

    let originalEditorCleared = originalEditor.getModel() === null;
    let modifiedEditorCleared = modifiedEditor.getModel() === null;
    let originalDetached = !model.original.isAttachedToEditor();
    let modifiedDetached = !model.modified.isAttachedToEditor();
    let cleanedUp = false;

    let disposeOriginalEditorChange = originalEditor.onDidChangeModel(() => {
      originalEditorCleared = originalEditor.getModel() === null;
      maybeCleanup();
    });
    let disposeModifiedEditorChange = modifiedEditor.onDidChangeModel(() => {
      modifiedEditorCleared = modifiedEditor.getModel() === null;
      maybeCleanup();
    });
    let disposeOriginalAttachment = model.original.onDidChangeAttached(() => {
      originalDetached = !model.original.isAttachedToEditor();
      maybeCleanup();
    });
    let disposeModifiedAttachment = model.modified.onDidChangeAttached(() => {
      modifiedDetached = !model.modified.isAttachedToEditor();
      maybeCleanup();
    });

    let cleanupDisposables = () => {
      disposeOriginalEditorChange.dispose();
      disposeModifiedEditorChange.dispose();
      disposeOriginalAttachment.dispose();
      disposeModifiedAttachment.dispose();
    };

    let maybeCleanup = () => {
      if (
        cleanedUp ||
        !originalEditorCleared ||
        !modifiedEditorCleared ||
        !originalDetached ||
        !modifiedDetached
      ) {
        return;
      }
      cleanedUp = true;
      cleanupDisposables();
      this.disposeEditorAndModels(editor, model);
    };

    maybeCleanup();
    return cleanupDisposables;
  }

  private disposeEditorAfterInitialLayout(
    editor: _MonacoSDK.editor.IStandaloneDiffEditor,
    model: _MonacoSDK.editor.IDiffEditorModel | null | undefined,
  ) {
    // Diff editors hit the same Monaco bootstrap race as standard editors when
    // search/replace blocks finish streaming and swap render modes within one
    // Glimmer turn. Waiting until the next paint keeps teardown deterministic
    // without relying on a fixed timeout.
    requestAnimationFrame(() => {
      try {
        editor.dispose();
      } catch {
        // See note above: cleanup should be tolerant of partially-disposed editors.
      }
      if (model?.original) {
        this.disposeModelWhenDetached(model.original);
      }
      if (model?.modified) {
        this.disposeModelWhenDetached(model.modified);
      }
    });
  }
}
