import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import type * as MonacoSDK from 'monaco-editor';

interface MonacoTokenization {
  forceTokenization(lineCount: number): void;
  backgroundTokenizationState?: number;
}

type TokenizationCapableModel = MonacoSDK.editor.ITextModel & {
  tokenization?: MonacoTokenization;
};

const BACKGROUND_TOKENIZATION_STATE_COMPLETED = 2;

/**
 * Monaco Editor Test Waiter Strategy
 *
 * This implementation uses event-driven completion detection to know when
 * Monaco editor initialization is actually finished. The strategy:
 *
 * 1. **Event-Driven Completion**: Listen to Monaco's own events
 *    (onDidLayoutChange, onDidContentSizeChange) and verify actual state
 *    (dimensions > 0, content loaded) rather than guessing when operations are done.
 *
 * 2. **State Verification**: Check that the editor has real dimensions and
 *    content before considering initialization complete:
 *    - contentHeight > 0: Content has been measured
 *    - layoutInfo.width/height > 0: Layout calculations are done
 *
 * 3. **Multi-Stage Tracking**: Monaco's rendering happens in stages:
 *    - DOM creation → onDidCreateEditor fires
 *    - Layout calculation → onDidLayoutChange fires
 *    - Content measurement → onDidContentSizeChange fires
 *    - Tokenization/syntax highlighting (async workers)
 *
 * 4. **Fallback Safety**: Each waiter has a timeout (2s) to prevent hanging tests
 *    if Monaco events don't fire as expected.
 */

export interface MonacoWaiterManager {
  beginAsync(operation: string): string;
  endAsync(operation: string): void;
  trackEditorInit(
    editor:
      | MonacoSDK.editor.ICodeEditor
      | MonacoSDK.editor.IStandaloneDiffEditor,
    operationId: string,
  ): void;
}

const waiter = buildWaiter('monaco-rendering');

export function createMonacoWaiterManager(): MonacoWaiterManager | null {
  if (!isTesting()) return null;

  const pendingOperations = new Map<string, unknown>();

  return {
    beginAsync(operation: string): string {
      const token = waiter.beginAsync();
      pendingOperations.set(operation, token);
      return operation;
    },

    endAsync(operation: string): void {
      const token = pendingOperations.get(operation);
      if (token) {
        pendingOperations.delete(operation);
        waiter.endAsync(token);
      }
    },

    trackEditorInit(editor, operationId): void {
      let isInitialized = false;

      // For diff editors, we track the modified editor which contains the primary content
      const targetEditor =
        'getModifiedEditor' in editor ? editor.getModifiedEditor() : editor;

      // Synchronously add syntax highlighting and tokenization (for indentation lines)
      const forceFullTokenization = (
        codeEditor: MonacoSDK.editor.ICodeEditor,
      ) => {
        const model = codeEditor.getModel() as TokenizationCapableModel | null;
        if (!model) return;

        const lineCount = model.getLineCount();
        if (lineCount <= 0) return;

        model.tokenization?.forceTokenization(lineCount);
        if ('forceTokenization' in model) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (model as any).forceTokenization(lineCount);
          } catch {
            // ignore – not all models expose forceTokenization directly
          }
        }
      };

      const editorsToValidate: MonacoSDK.editor.ICodeEditor[] =
        'getOriginalEditor' in editor
          ? [editor.getOriginalEditor(), targetEditor]
          : [targetEditor];

      const tokenizationReadiness = new Map<
        MonacoSDK.editor.ICodeEditor,
        boolean
      >();
      const tokenizationDisposables: MonacoSDK.IDisposable[] = [];

      const markTokensReady = (codeEditor: MonacoSDK.editor.ICodeEditor) => {
        tokenizationReadiness.set(codeEditor, true);
        checkInitComplete();
      };

      const ensureTokenizationReady = (
        codeEditor: MonacoSDK.editor.ICodeEditor,
      ) => {
        const model = codeEditor.getModel() as TokenizationCapableModel | null;
        if (!model) {
          tokenizationReadiness.set(codeEditor, true);
          return;
        }

        const languageId = model.getLanguageId();
        const tokenizationState =
          model.tokenization?.backgroundTokenizationState;

        if (languageId === 'plaintext') {
          markTokensReady(codeEditor);
          return;
        }

        if (tokenizationState === BACKGROUND_TOKENIZATION_STATE_COMPLETED) {
          markTokensReady(codeEditor);
          return;
        }

        tokenizationReadiness.set(codeEditor, false);

        const disposable = model.onDidChangeTokens(() => {
          const currentState =
            model.tokenization?.backgroundTokenizationState;
          if (
            currentState === undefined ||
            currentState === BACKGROUND_TOKENIZATION_STATE_COMPLETED
          ) {
            markTokensReady(codeEditor);
            disposable.dispose();
            const idx = tokenizationDisposables.indexOf(disposable);
            if (idx !== -1) {
              tokenizationDisposables.splice(idx, 1);
            }
          }
        });

        tokenizationDisposables.push(disposable);
      };

      editorsToValidate.forEach(ensureTokenizationReady);

      const editorHasCompleteContent = (
        codeEditor: MonacoSDK.editor.ICodeEditor,
      ): boolean => {
        const layoutInfo = codeEditor.getLayoutInfo();
        const contentHeight = codeEditor.getContentHeight();

        if (layoutInfo.width <= 0 || layoutInfo.height <= 0) {
          return false;
        }

        if (contentHeight <= 0) {
          return false;
        }

        const model = codeEditor.getModel() as TokenizationCapableModel | null;
        if (!model) {
          return true;
        }

        const tokenizationState =
          model.tokenization?.backgroundTokenizationState;
        if (
          tokenizationState !== undefined &&
          tokenizationState !== BACKGROUND_TOKENIZATION_STATE_COMPLETED
        ) {
          return false;
        }

        if (tokenizationReadiness.get(codeEditor) === false) {
          return false;
        }

        const lineCount = model.getLineCount();
        if (lineCount === 0) {
          return true;
        }

        const expectedHeight =
          codeEditor.getTopForLineNumber(lineCount + 1) ?? contentHeight;

        return contentHeight >= expectedHeight;
      };

      const checkInitComplete = () => {
        if (isInitialized) return;

        const allEditorsReady = editorsToValidate.every(
          editorHasCompleteContent,
        );

        if (allEditorsReady) {
          for (const codeEditor of editorsToValidate) {
            forceFullTokenization(codeEditor);
          }

          isInitialized = true;
          this.endAsync(operationId);
        }
      };

      // Listen for layout changes to detect when initialization is complete
      const layoutDisposable = targetEditor.onDidLayoutChange(() => {
        checkInitComplete();
      });

      // Listen for content size changes as well
      const contentSizeDisposable = targetEditor.onDidContentSizeChange(() => {
        checkInitComplete();
      });

      // For diff editors, also listen to diff updates
      let diffDisposable: MonacoSDK.IDisposable | undefined;
      if ('getModifiedEditor' in editor) {
        diffDisposable = editor.onDidUpdateDiff(() => {
          checkInitComplete();
        });
      }

      // Fallback timeout to prevent hanging tests
      const timeoutId = setTimeout(() => {
        if (!isInitialized) {
          for (const codeEditor of editorsToValidate) {
            forceFullTokenization(codeEditor);
            tokenizationReadiness.set(codeEditor, true);
          }
          tokenizationDisposables.splice(0).forEach((disposable) =>
            disposable.dispose(),
          );
          isInitialized = true;
          layoutDisposable.dispose();
          contentSizeDisposable.dispose();
          diffDisposable?.dispose();
          this.endAsync(operationId);
        }
      }, 2000);

      // Override endAsync for this specific operation to ensure cleanup
      const originalEndAsync = this.endAsync.bind(this);
      this.endAsync = (operation: string) => {
        if (operation === operationId) {
          clearTimeout(timeoutId);
          layoutDisposable.dispose();
          contentSizeDisposable.dispose();
          diffDisposable?.dispose();
          tokenizationDisposables.splice(0).forEach((disposable) =>
            disposable.dispose(),
          );
          // Restore original endAsync
          this.endAsync = originalEndAsync;
        }
        originalEndAsync(operation);
      };
    },
  };
}
