import { TemplateOnlyComponent } from '@ember/component/template-only';
import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';

import {
  type CodeData,
  makeCodeDiffStats,
} from '@cardstack/host/lib/formatted-message/utils';
import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

import type { ComponentLike } from '@glint/template';
import type * as _MonacoSDK from 'monaco-editor';

import CodeBlockActions, { type CodeBlockActionsSignature } from './actions';
import CodeBlockHeader, { type CodeBlockHeaderSignature } from './header';

interface CodeBlockEditorSignature {
  Args: {
    code?: string | null;
    dimmed?: boolean;
  };
}

interface CodeBlockDiffEditorSignature {
  Args: {
    originalCode?: string | null;
    modifiedCode?: string | null;
    language?: string | null;
    updateDiffEditorStats?: (stats: {
      linesAdded: number;
      linesRemoved: number;
    }) => void;
  };
}

interface Signature {
  Args: {
    monacoSDK: MonacoSDK;
    codeData?: Partial<CodeData>;
    originalCode?: string | null;
    modifiedCode?: string | null;
    language?: string | null;
    dimmed?: boolean;
    mode?: 'edit' | 'create';
    fileUrl?: string;
    diffEditorStats?: {
      linesRemoved: number;
      linesAdded: number;
    } | null;
    updateDiffEditorStats?: (stats: {
      linesAdded: number;
      linesRemoved: number;
    }) => void;
  };
  Blocks: {
    default: [
      {
        editorHeader: ComponentLike<CodeBlockHeaderSignature>;
        editor: ComponentLike<CodeBlockEditorSignature>;
        diffEditor: ComponentLike<CodeBlockDiffEditorSignature>;
        actions: ComponentLike<CodeBlockActionsSignature>;
      },
    ];
  };
  Element: HTMLElement;
}

let CodeBlockComponent: TemplateOnlyComponent<Signature> = <template>
  <div class='code-block' ...attributes>
    {{yield
      (hash
        editorHeader=(component
          CodeBlockHeader codeData=@codeData diffEditorStats=@diffEditorStats
        )
        editor=(component
          CodeBlockEditor monacoSDK=@monacoSDK codeData=@codeData
        )
        diffEditor=(component
          CodeBlockDiffEditor
          monacoSDK=@monacoSDK
          originalCode=@originalCode
          modifiedCode=@modifiedCode
          language=@language
        )
        actions=(component CodeBlockActions codeData=@codeData)
      )
    }}
  </div>
  <style scoped>
    .code-block {
      border-radius: var(--boxel-border-radius-lg);
      overflow: hidden;
    }
  </style>
</template>;

export default CodeBlockComponent;

interface MonacoEditorSignature {
  Args: {
    Named: {
      codeData?: Partial<CodeData>;
      monacoSDK: MonacoSDK;
      editorDisplayOptions: MonacoEditorOptions;
    };
  };
}

interface MonacoDiffEditorSignature {
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

class MonacoDiffEditor extends Modifier<MonacoDiffEditorSignature> {
  private monacoState: {
    editor: _MonacoSDK.editor.IStandaloneDiffEditor;
  } | null = null;

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
    }

    registerDestructor(this, () => {
      let editor = this.monacoState?.editor;
      if (editor) {
        editor.dispose();
      }
    });
  }
}

class MonacoEditor extends Modifier<MonacoEditorSignature> {
  private monacoState: {
    editor: _MonacoSDK.editor.IStandaloneCodeEditor;
  } | null = null;
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

class CodeBlockEditor extends Component<Signature> {
  editorDisplayOptions: MonacoEditorOptions = {
    wordWrap: 'on',
    wrappingIndent: 'indent',
    fontWeight: 'bold',
    scrollbar: {
      alwaysConsumeMouseWheel: false,
    },
    lineNumbers: 'off',
    minimap: {
      enabled: false,
    },
    readOnly: true,
    automaticLayout: true,
    stickyScroll: {
      enabled: false,
    },
    fontSize: 10,
    scrollBeyondLastLine: false,
    padding: {
      top: 8,
      bottom: 8,
    },
    theme: 'vs-dark',
  };

  <template>
    <style scoped>
      .code-block-editor {
        max-height: 250px;
      }

      .dimmed {
        opacity: 0.6;
      }
    </style>

    <div
      {{MonacoEditor
        monacoSDK=@monacoSDK
        codeData=@codeData
        editorDisplayOptions=this.editorDisplayOptions
      }}
      class='code-block-editor {{if @dimmed "dimmed"}}'
      data-test-editor
    >
      {{! Don't put anything here in this div as monaco modifier will override this element }}
    </div>
  </template>
}

class CodeBlockDiffEditor extends Component<Signature> {
  private editorDisplayOptions = {
    originalEditable: false,
    renderSideBySide: false,
    diffAlgorithm: 'advanced',
    folding: true,
    hideUnchangedRegions: {
      enabled: true,
      revealLineCount: 10,
      minimumLineCount: 1,
      contextLineCount: 1,
    },
    readOnly: true,
    fontSize: 10,
    renderOverviewRuler: false,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: {
      bottom: 0,
      left: 8,
      right: 8,
      top: 8,
    },
    theme: 'vs-dark',
    lineNumbers: 'off' as _MonacoSDK.editor.LineNumbersType | undefined,
  };

  @tracked diffEditorStats: {
    linesAdded: number;
    linesRemoved: number;
  } | null = null;

  <template>
    <style scoped>
      .code-block-editor {
        max-height: 250px;
      }

      :deep(.line-insert) {
        background-color: rgb(19 255 32 / 66%) !important;
      }

      :deep(.diff-hidden-lines) {
        margin-left: 9px;
      }

      :deep(span[title='Double click to unfold']) {
        margin-left: 5px;
      }
    </style>
    <div
      {{MonacoDiffEditor
        monacoSDK=@monacoSDK
        editorDisplayOptions=this.editorDisplayOptions
        language=@language
        originalCode=@originalCode
        modifiedCode=@modifiedCode
        updateDiffEditorStats=@updateDiffEditorStats
      }}
      class='code-block-editor code-block-diff'
      data-test-code-diff-editor
    >
      {{! Don't put anything here in this div as monaco modifier will override this element }}
    </div>
  </template>
}
