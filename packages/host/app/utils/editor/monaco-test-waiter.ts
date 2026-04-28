import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import type * as MonacoSDK from 'monaco-editor';

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
      const isDiffEditor =
        'getLineChanges' in editor &&
        typeof editor.getLineChanges === 'function';
      const diffEditor = isDiffEditor
        ? (editor as MonacoSDK.editor.IStandaloneDiffEditor)
        : null;

      // For diff editors, we track the modified editor which contains the primary content
      const targetEditor =
        'getModifiedEditor' in editor ? editor.getModifiedEditor() : editor;

      // Synchronously add syntax highlighting
      const forceFullTokenization = (
        codeEditor: MonacoSDK.editor.ICodeEditor,
      ) => {
        const model = codeEditor.getModel();
        if (!model) return;

        const lineCount = model.getLineCount();
        if (lineCount <= 0) return;

        type TokenizationCapableModel = MonacoSDK.editor.ITextModel & {
          tokenization?: { forceTokenization(lineCount: number): void };
        };

        (model as TokenizationCapableModel).tokenization?.forceTokenization(
          lineCount,
        );
      };

      // Render waits on Monaco UI elements that appear asynchronously:
      // 1. Layout of the text viewport + scroll area (so the code area actually has size)
      // 2. Diff overview ruler for diff editors (the colored heat map in the scroll gutter)
      // 3. Bracket/indent guides (the vertical indentation highlight blocks inside the code area)
      let layoutReady = false;
      let diffReady = !diffEditor;
      // Diff computation emits multiple updates; wait until results stabilize
      let diffStableCount = 0;
      let lastDiffSignature: string | null = null;
      const indentGuidesExpected = (() => {
        const model = targetEditor.getModel();
        if (!model) return false;
        const maxLines = Math.min(model.getLineCount(), 200);
        for (let lineNumber = 1; lineNumber <= maxLines; lineNumber++) {
          const lineText = model.getLineContent(lineNumber);
          if (!lineText) continue;
          const leadingWhitespace = lineText.match(/^\s+/u)?.[0]?.length ?? 0;
          if (leadingWhitespace >= 2) {
            return true;
          }
        }
        return false;
      })();
      let indentGuidesReady = !indentGuidesExpected;
      let tokenizationForced = false;

      const ensureTokenization = () => {
        if (tokenizationForced) return;
        tokenizationForced = true;

        forceFullTokenization(targetEditor);
        if ('getOriginalEditor' in editor) {
          forceFullTokenization(editor.getOriginalEditor());
        }
      };

      const updateLayoutReady = () => {
        const contentHeight = targetEditor.getContentHeight();
        const layoutInfo = targetEditor.getLayoutInfo();

        if (
          contentHeight > 0 &&
          layoutInfo.width > 0 &&
          layoutInfo.height > 0
        ) {
          layoutReady = true;
        }
      };

      const updateIndentGuidesReady = () => {
        if (indentGuidesReady) return;
        const domNode = targetEditor.getDomNode();
        if (!domNode) return;
        if (indentGuidesExpected) {
          ensureTokenization();
        }
        const guide = domNode.querySelector(
          '.core-guide.bracket-indent-guide, .core-guide-indent',
        );
        if (guide) {
          indentGuidesReady = true;
        }
      };

      const updateDiffReady = () => {
        if (!diffEditor) return;
        let lineChanges: MonacoSDK.editor.ILineChange[] | null | undefined;
        try {
          lineChanges = diffEditor.getLineChanges();
        } catch {
          // Monaco can fire diff update hooks before its worker has published a
          // usable diff result. In that transient state, the next update will
          // carry the real data, so tests should keep waiting instead of failing.
          return;
        }
        if (!lineChanges) {
          return;
        }

        if (lineChanges.length === 0) {
          diffReady = true;
          return;
        }

        const diffSignature = lineChanges
          .map((change) => {
            const changeSignature = [
              change.originalStartLineNumber,
              change.originalEndLineNumber,
              change.modifiedStartLineNumber,
              change.modifiedEndLineNumber,
            ].join(':');

            const charSignature =
              change.charChanges
                ?.map((charChange) =>
                  [
                    charChange.originalStartLineNumber,
                    charChange.originalEndLineNumber,
                    charChange.modifiedStartLineNumber,
                    charChange.modifiedEndLineNumber,
                    charChange.originalStartColumn,
                    charChange.originalEndColumn,
                    charChange.modifiedStartColumn,
                    charChange.modifiedEndColumn,
                  ].join(':'),
                )
                .join(',') ?? '';

            return `${changeSignature}|${charSignature}`;
          })
          .join(';');

        if (diffSignature === lastDiffSignature) {
          diffStableCount += 1;
        } else {
          lastDiffSignature = diffSignature;
          diffStableCount = 1;
        }

        if (diffStableCount >= 2) {
          diffReady = true;
        }
      };

      const releaseAfterTokensSettled = () => {
        // forceFullTokenization synchronously asks Monaco to compute tokens,
        // but the colour painting that follows is not strictly synchronous:
        // bracket-pair colorisation runs in a worker, and language services
        // for TS/JS can publish token updates over multiple animation frames.
        // A fixed 2-rAF wait sometimes lands mid-tokenisation — we have seen
        // both fully plain and partially-coloured Monaco panels captured by
        // Percy on otherwise-identical runs. Instead, watch onDidChangeTokens
        // on every relevant model and only release once those events have
        // been quiet for two consecutive rAFs (or after a generous cap, so
        // a stuck worker can't hang the test).
        const models: MonacoSDK.editor.ITextModel[] = [];
        const targetModel = targetEditor.getModel();
        if (targetModel) models.push(targetModel);
        if (diffEditor) {
          const originalModel = diffEditor.getOriginalEditor().getModel();
          if (originalModel && !models.includes(originalModel)) {
            models.push(originalModel);
          }
        }

        let lastTokenChange = performance.now();
        const tokenDisposables = models.map((model) =>
          model.onDidChangeTokens(() => {
            lastTokenChange = performance.now();
          }),
        );

        const settleMs = 32; // ~2 frames quiet at 60fps
        const startedAt = performance.now();
        const maxWaitMs = 1500;

        const cleanup = () => {
          for (const d of tokenDisposables) d.dispose();
        };

        const finish = () => {
          cleanup();
          // Final rAF pair so the browser can paint the last token batch
          // before Percy snapshots the DOM.
          // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Monaco paints tokens on its next rAF; the waiter must span that frame
          requestAnimationFrame(() =>
            // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- second frame to cover the paint following Monaco's layout
            requestAnimationFrame(() => this.endAsync(operationId)),
          );
        };

        const poll = () => {
          const now = performance.now();
          if (now - lastTokenChange >= settleMs) {
            finish();
            return;
          }
          if (now - startedAt >= maxWaitMs) {
            finish();
            return;
          }
          // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- polling for Monaco token-change quiescence between paints
          requestAnimationFrame(poll);
        };

        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- start polling on the next paint frame
        requestAnimationFrame(poll);
      };

      const checkInitComplete = () => {
        if (isInitialized) return;

        if (!layoutReady || !diffReady || !indentGuidesReady) {
          return;
        }

        ensureTokenization();
        isInitialized = true;
        releaseAfterTokensSettled();
      };

      // Listen for layout changes to detect when initialization is complete
      const layoutDisposable = targetEditor.onDidLayoutChange(() => {
        updateLayoutReady();
        updateIndentGuidesReady();
        checkInitComplete();
      });

      // Listen for content size changes as well
      const contentSizeDisposable = targetEditor.onDidContentSizeChange(() => {
        updateLayoutReady();
        updateIndentGuidesReady();
        checkInitComplete();
      });

      // For diff editors, also listen to diff updates
      let diffDisposable: MonacoSDK.IDisposable | undefined;
      if (diffEditor) {
        diffDisposable = diffEditor.onDidUpdateDiff(() => {
          updateDiffReady();
          checkInitComplete();
        });
      }

      const decorationsDisposable = targetEditor.onDidChangeModelDecorations(
        () => {
          updateIndentGuidesReady();
          checkInitComplete();
        },
      );

      // Run an initial readiness check in case everything is already available
      updateLayoutReady();
      updateDiffReady();
      updateIndentGuidesReady();
      checkInitComplete();

      // Fallback timeout to prevent hanging tests
      const timeoutId = setTimeout(() => {
        if (!isInitialized) {
          updateLayoutReady();
          updateDiffReady();
          updateIndentGuidesReady();
          ensureTokenization();
          isInitialized = true;
          layoutDisposable.dispose();
          contentSizeDisposable.dispose();
          diffDisposable?.dispose();
          decorationsDisposable.dispose();
          releaseAfterTokensSettled();
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
          decorationsDisposable.dispose();
          // Restore original endAsync
          this.endAsync = originalEndAsync;
        }
        originalEndAsync(operation);
      };
    },
  };
}
