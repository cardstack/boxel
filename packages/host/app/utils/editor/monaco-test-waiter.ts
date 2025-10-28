import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import type * as MonacoSDK from 'monaco-editor';

interface MonacoTokenization {
  forceTokenization(lineCount: number): void;
  backgroundTokenizationState?: number;
  hasTokens?: boolean;
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

      const disposables: MonacoSDK.IDisposable[] = [];
      const register = (disposable?: MonacoSDK.IDisposable) => {
        if (disposable) {
          disposables.push(disposable);
        }
      };

      const isEditorReady = (codeEditor: MonacoSDK.editor.ICodeEditor) => {
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

        const lineCount = model.getLineCount();
        if (lineCount === 0) {
          return true;
        }

        const languageId = model.getLanguageId();
        if (languageId === 'plaintext') {
          return true;
        }

        const tokenization = model.tokenization;
        if (tokenization) {
          const backgroundState = tokenization.backgroundTokenizationState;
          if (
            backgroundState !== undefined &&
            backgroundState !== BACKGROUND_TOKENIZATION_STATE_COMPLETED
          ) {
            return false;
          }

          if ('hasTokens' in tokenization && !tokenization.hasTokens) {
            return false;
          }
        }

        return true;
      };

      const originalEndAsync = this.endAsync.bind(this);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        while (disposables.length) {
          disposables.pop()?.dispose();
        }
        this.endAsync = originalEndAsync;
      };

      const hardFinalize = () => {
        if (isInitialized) return;
        isInitialized = true;
        editorsToValidate.forEach(forceFullTokenization);
        cleanup();
        originalEndAsync(operationId);
      };

      const tryFinalize = () => {
        if (isInitialized) return;
        if (editorsToValidate.every(isEditorReady)) {
          hardFinalize();
        }
      };

      const observeModel = (codeEditor: MonacoSDK.editor.ICodeEditor) => {
        const model = codeEditor.getModel() as TokenizationCapableModel | null;
        if (!model) return;

        register(model.onDidChangeContent(tryFinalize));
        register(model.onDidChangeTokens(tryFinalize));
        register(model.onDidChangeLanguage(tryFinalize));
      };

      editorsToValidate.forEach((codeEditor) => {
        observeModel(codeEditor);
        register(
          codeEditor.onDidChangeModel(() => {
            observeModel(codeEditor);
            tryFinalize();
          }),
        );
        register(codeEditor.onDidLayoutChange(tryFinalize));
        register(codeEditor.onDidContentSizeChange(tryFinalize));
      });

      if ('getModifiedEditor' in editor) {
        register(editor.onDidUpdateDiff(tryFinalize));
      }

      timeoutId = setTimeout(() => {
        if (!isInitialized) {
          hardFinalize();
        }
      }, 2000);

      this.endAsync = (operation: string) => {
        if (operation === operationId) {
          cleanup();
        }
        originalEndAsync(operation);
      };

      tryFinalize();
    },
  };
}
