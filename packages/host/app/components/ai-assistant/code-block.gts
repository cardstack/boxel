import { TemplateOnlyComponent } from '@ember/component/template-only';
import { registerDestructor } from '@ember/destroyable';
import { array, hash, fn } from '@ember/helper';

import { on } from '@ember/modifier';

import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import Modifier from 'ember-modifier';

import {
  BoxelDropdown,
  IconButton,
  Menu,
} from '@cardstack/boxel-ui/components';

import { menuItem } from '@cardstack/boxel-ui/helpers';

import {
  Copy as CopyIcon,
  IconCode,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

import {
  type CodeData,
  makeCodeDiffStats,
} from '@cardstack/host/lib/formatted-message/utils';
import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import ApplyButton from '../ai-assistant/apply-button';

import type { ComponentLike } from '@glint/template';
import type * as _MonacoSDK from 'monaco-editor';

interface CopyCodeButtonSignature {
  Args: {
    code?: string | null;
  };
}

interface ApplyCodePatchButtonSignature {
  Args: {
    patchCodeStatus: CodePatchStatus | 'ready' | 'applying';
    performPatch?: () => void;
    codeData: CodeData;
    originalCode?: string | null;
    modifiedCode?: string | null;
  };
}

interface CodeBlockActionsSignature {
  Args: {
    codeData?: Partial<CodeData>;
  };
  Blocks: {
    default: [
      {
        copyCode: ComponentLike<CopyCodeButtonSignature>;
        applyCodePatch: ComponentLike<ApplyCodePatchButtonSignature>;
      },
    ];
  };
  actions: [];
}

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

interface CodeBlockHeaderSignature {
  Args: {
    codeData: Partial<CodeData>;
    diffEditorStats?: {
      linesRemoved: number;
      linesAdded: number;
    } | null;
    finalFileUrlAfterCodePatching?: string | null;
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
  <div ...attributes>
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
        actions=(component CodeBlockActionsComponent codeData=@codeData)
      )
    }}
  </div>
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
    scrollbar: {
      alwaysConsumeMouseWheel: false,
    },
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

class CodeBlockHeader extends Component<CodeBlockHeaderSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  get fileUrl() {
    return (
      this.args.finalFileUrlAfterCodePatching ?? this.args.codeData.fileUrl
    );
  }

  get fileName() {
    return new URL(this.fileUrl ?? '').pathname.split('/').pop() || '';
  }

  openInCodeMode = () => {
    this.operatorModeStateService.updateCodePath(new URL(this.fileUrl!));
  };

  <template>
    <style scoped>
      .code-block-diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: #2c2c3c;
        color: #ffffff;
        padding: 8px 12px;
        border-top-left-radius: 12px;
        border-top-right-radius: 12px;
        font-size: 14px;
        height: 50px;
      }

      .code-block-diff-header .left-section {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .code-block-diff-header .file-info {
        padding: 4px 8px;
        border: 1px solid;
        border-radius: 5px;
        border-color: #5c5d5e;
        background: transparent;
        color: #f7f7f7;
        display: flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        max-width: 100%;
        min-width: 0;
        margin-right: var(--boxel-sp-xs);
      }

      .file-info:hover {
        border-color: #ffffff;
      }

      .code-block-diff-header .file-info .filename {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
      }

      .code-block-diff-header .file-info .edit-icon {
        background-color: #f44a1c;
        border-radius: 4px;
        padding: 2px 6px;
        font-weight: bold;
        color: #ffffff;
      }

      .code-block-diff-header .file-info .more-options {
        background: none;
        border: none;
        color: var(--boxel-300);
        padding: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
      }

      .code-block-diff-header .file-info .more-options:hover {
        color: #ffffff;
      }

      .code-block-diff-header .right-section {
        display: flex;
        align-items: center;
      }

      .code-block-diff-header .changes {
        display: flex;
        gap: 6px;
        font-weight: 600;
      }

      .code-block-diff-header .changes .removed {
        color: #ff5f5f;
      }

      .code-block-diff-header .changes .added {
        color: #66ff99;
      }

      .mode {
        color: var(--boxel-300);
      }

      .context-menu-trigger {
        rotate: 90deg;
        --boxel-icon-button-width: 14px;
        --boxel-icon-button-height: 14px;
      }
      .context-menu-trigger {
        --icon-color: #f7f7f7;
      }

      .context-menu-trigger:hover {
        --icon-color: #ffffff;
      }
    </style>
    <div class='code-block-diff-header'>
      <div class='left-section'>
        <div class='mode' data-test-file-mode>
          {{if @codeData.isNewFile 'Create' 'Edit'}}
        </div>
        <BoxelDropdown @contentClass=''>
          <:trigger as |bindings|>
            <button
              class='file-info'
              data-code-patch-dropdown-button={{this.fileName}}
              {{bindings}}
            >

              <span
                class='filename'
                data-test-file-name
              >{{this.fileName}}</span>
              <IconButton
                class='context-menu-trigger'
                @icon={{ThreeDotsHorizontal}}
                aria-label='field options'
                {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
                ...attributes
              />
            </button>
          </:trigger>
          <:content as |dd|>
            <Menu
              class='context-menu-list'
              @items={{array
                (menuItem 'Open in Code Mode' this.openInCodeMode icon=IconCode)
              }}
              @closeMenu={{dd.close}}
            />
          </:content>
        </BoxelDropdown>

      </div>
      <div class='right-section'>
        {{#if @diffEditorStats}}
          <div class='changes'>
            <span class='removed' data-test-removed-lines>
              -{{@diffEditorStats.linesRemoved}}
            </span>
            <span class='added' data-test-added-lines>
              +{{@diffEditorStats.linesAdded}}
            </span>
          </div>
        {{/if}}
      </div>
    </div>
  </template>
}

let CodeBlockActionsComponent: TemplateOnlyComponent<CodeBlockActionsSignature> =
  <template>
    <style scoped>
      .code-block-actions {
        background: black;
        height: 45px;
        padding: var(--boxel-sp-sm) 27px;
        padding-right: var(--boxel-sp);
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
      }
    </style>
    <div class='code-block-actions'>
      {{yield
        (hash
          copyCode=(component CopyCodeButton code=@codeData.code)
          applyCodePatch=(component
            ApplyCodePatchButton
            codePatch=@codeData.searchReplaceBlock
            fileUrl=@codeData.fileUrl
            index=@codeData.codeBlockIndex
          )
        )
      }}
    </div>
  </template>;

class CopyCodeButton extends Component<CopyCodeButtonSignature> {
  @tracked copyCodeButtonText: 'Copy' | 'Copied!' = 'Copy';

  copyCode = restartableTask(async (code: string) => {
    this.copyCodeButtonText = 'Copied!';
    await navigator.clipboard.writeText(code);
    await timeout(1000);
    this.copyCodeButtonText = 'Copy';
  });

  <template>
    <style scoped>
      .code-copy-button {
        color: var(--boxel-highlight);
        background: none;
        border: none;
        font: 600 var(--boxel-font-xs);
        padding: 0;
        display: flex;
        align-items: center;
        width: auto;
      }

      .code-copy-button svg {
        margin-right: var(--boxel-sp-xs);
      }

      .copy-icon {
        --icon-color: var(--boxel-highlight);
      }

      .copy-text {
        display: none;
      }

      .code-copy-button:hover .copy-text {
        display: block;
      }

      .code-copy-button .copy-text.shown {
        display: block;
      }
    </style>

    <button
      class='code-copy-button'
      {{on 'click' (fn (perform this.copyCode) @code)}}
      data-test-copy-code
    >
      <CopyIcon
        width='16'
        height='16'
        role='presentation'
        aria-hidden='true'
        class='copy-icon'
      />
      <span
        class='copy-text {{if this.copyCode.isRunning "shown"}}'
      >{{this.copyCodeButtonText}}</span>
    </button>
  </template>
}

class ApplyCodePatchButton extends Component<ApplyCodePatchButtonSignature> {
  @service declare operatorModeStateService: OperatorModeStateService;

  // This is for debugging purposes only
  logCodePatchAction = () => {
    console.log('fileUrl \n', this.args.codeData.fileUrl);
    console.log('searchReplaceBlock \n', this.args.codeData.searchReplaceBlock);
    console.log('originalCode \n', this.args.originalCode);
    console.log('modifiedCode \n', this.args.modifiedCode);
  };

  get debugButtonEnabled() {
    return this.operatorModeStateService.operatorModeController.debug;
  }

  private performPatch = () => {
    this.args.performPatch?.();
  };

  <template>
    {{#if this.debugButtonEnabled}}
      <button {{on 'click' this.logCodePatchAction}} class='debug-button'>
        👁️
      </button>
    {{/if}}

    <ApplyButton
      data-test-apply-code-button
      @state={{@patchCodeStatus}}
      {{on 'click' this.performPatch}}
    >
      Apply
    </ApplyButton>

    <style scoped>
      .debug-button {
        background: transparent;
        border: none;
        margin-right: 5px;
      }
    </style>
  </template>
}
