import { TemplateOnlyComponent } from '@ember/component/template-only';
import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';

import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

import ApplySearchReplaceBlockCommand from '@cardstack/host/commands/apply-search-replace-block';
import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';
import { MonacoSDK } from '@cardstack/host/services/monaco-service';

import ApplyButton from '../ai-assistant/apply-button';

import { CodeData } from './formatted-message';

import type { ComponentLike } from '@glint/template';
import type * as _MonacoSDK from 'monaco-editor';
interface CopyCodeButtonSignature {
  Args: {
    code?: string;
  };
}

interface ApplyCodePatchButtonSignature {
  Args: {
    codePatch?: string | null;
    fileUrl?: string | null;
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
  Args: {};
}

interface CodeBlockDiffEditorSignature {
  Args: {};
}

interface Signature {
  Args: {
    monacoSDK: MonacoSDK;
    codeData?: Partial<CodeData>;
    originalCode?: string;
    modifiedCode?: string;
    language?: string;
  };
  Blocks: {
    default: [
      {
        editor: ComponentLike<CodeBlockEditorSignature>;
        diffEditor: ComponentLike<CodeBlockDiffEditorSignature>;
        actions: ComponentLike<CodeBlockActionsSignature>;
      },
    ];
  };
  Element: HTMLElement;
}

let CodeBlockComponent: TemplateOnlyComponent<Signature> = <template>
  {{yield
    (hash
      editor=(component CodeBlockEditor monacoSDK=@monacoSDK codeData=@codeData)
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
      originalCode?: string;
      modifiedCode?: string;
      language?: string;
      editorDisplayOptions: MonacoEditorOptions;
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
    }: MonacoDiffEditorSignature['Args']['Named'],
  ) {
    if (!originalCode || !modifiedCode) {
      return;
    }
    if (this.monacoState) {
      let { editor } = this.monacoState;
      let model = editor.getModel();
      let originalModel = model?.original;
      let modifiedModel = model?.modified;

      let newOriginalCode = originalCode ?? '';
      let newModifiedCode = modifiedCode ?? '';
      debugger;
      if (newOriginalCode !== originalModel?.getValue()) {
        originalModel?.setValue(newOriginalCode);
      }
      if (newModifiedCode !== modifiedModel?.getValue()) {
        modifiedModel?.setValue(newModifiedCode);
      }

      // if (!newOriginalCode.startsWith(currentOriginalCode)) {
      //   originalModel?.setValue(newOriginalCode);
      // } else {
      //   let codeDelta = newOriginalCode.slice(currentOriginalCode.length);

      //   let lineCount = originalModel.getLineCount();
      //   let lastLineLength = originalModel.getLineLength(lineCount);

      //   let range = {
      //     startLineNumber: lineCount,
      //     startColumn: lastLineLength + 1,
      //     endLineNumber: lineCount,
      //     endColumn: lastLineLength + 1,
      //   };

      //   let editOperation = {
      //     range: range,
      //     text: codeDelta,
      //     forceMoveMarkers: true,
      //   };

      //   originalModel.applyEdits([editOperation]);
      // }

      // let modifiedModel = model?.modified;
      // let newModifiedCode = modifiedCode;
      // let currentModifiedCode = modifiedModel?.getValue();

      // if (!newModifiedCode.startsWith(currentModifiedCode)) {
      //   modifiedModel.setValue(newModifiedCode);
      // } else {
      //   let codeDelta = newModifiedCode.slice(currentModifiedCode.length);

      //   let lineCount = modifiedModel.getLineCount();
      //   let lastLineLength = modifiedModel.getLineLength(lineCount);

      //   let range = {
      //     startLineNumber: lineCount,
      //     startColumn: lastLineLength + 1,
      //     endLineNumber: lineCount,
      //     endColumn: lastLineLength + 1,
      //   };

      //   let editOperation = {
      //     range: range,
      //     text: codeDelta,
      //     forceMoveMarkers: true,
      //   };

      //   modifiedModel.applyEdits([editOperation]);
      // }
    } else {
      let editor = monacoSDK.editor.createDiffEditor(
        element,
        editorDisplayOptions,
      );

      let originalModel = monacoSDK.editor.createModel(
        originalCode ?? '',
        language,
      );
      let modifiedModel = monacoSDK.editor.createModel(
        modifiedCode ?? '',
        language,
      );
      debugger;
      editor.setModel({ original: originalModel, modified: modifiedModel });

      this.monacoState = {
        editor,
      };
    }

    registerDestructor(this, () => {
      let editor = this.monacoState?.editor;
      if (editor) {
        editor.dispose();
      }
      console.log('monaco diff editor disposed');
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

        // applyCodeDiffDecorations(editor, monacoSDK, codeData);
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
      // applyCodeDiffDecorations(editor, monacoSDK, codeData);

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
  };

  <template>
    <style scoped>
      :global(.line-to-be-replaced) {
        background-color: rgb(255 0 0 / 37%);
      }
      :global(.line-to-be-replaced-with) {
        background-color: rgb(6 144 29 / 56%);
      }
      .code-block {
        margin-bottom: 15px;
        width: calc(100% + 2 * var(--boxel-sp));
        margin-left: calc(-1 * var(--boxel-sp));
        height: 120px;
      }
    </style>
    <div
      {{MonacoEditor
        monacoSDK=@monacoSDK
        codeData=@codeData
        editorDisplayOptions=this.editorDisplayOptions
      }}
      class='code-block'
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
  };

  <template>
    <style scoped>
      .code-block {
        margin-bottom: 15px;
        width: calc(100% + 2 * var(--boxel-sp));
        margin-left: calc(-1 * var(--boxel-sp));
        height: 120px;
      }

      :deep(.line-insert) {
        background-color: rgb(19 255 32 / 66%) !important;
      }
    </style>
    <div
      {{MonacoDiffEditor
        monacoSDK=@monacoSDK
        editorDisplayOptions=this.editorDisplayOptions
        language=@language
        originalCode=@originalCode
        modifiedCode=@modifiedCode
      }}
      class='code-block code-block-diff'
      data-test-editor
    >
      {{! Don't put anything here in this div as monaco modifier will override this element }}
    </div>
  </template>
}

let CodeBlockActionsComponent: TemplateOnlyComponent<CodeBlockActionsSignature> =
  <template>
    <style scoped>
      .code-block-actions {
        background: black;
        height: 50px;
        padding: var(--boxel-sp-sm) 27px;
        padding-right: var(--boxel-sp);
        display: flex;
        justify-content: flex-start;
        width: calc(100% + 2 * var(--boxel-sp));
        margin-left: calc(-1 * var(--boxel-sp));
      }
    </style>
    <div class='code-block-actions'>
      {{yield
        (hash
          copyCode=(component CopyCodeButton code=@codeData.code)
          applyCodePatch=(component
            ApplyCodePatchButton
            codePatch=@codeData.contentWithoutFileUrl
            fileUrl=@codeData.fileUrl
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
        margin: auto;
        width: 100%;
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
  @service private declare loaderService: LoaderService;
  @service private declare commandService: CommandService;
  @service private declare cardService: CardService;
  @tracked patchCodeTaskState: 'ready' | 'applying' | 'applied' | 'failed' =
    'ready';

  private patchCodeTask = task(async (codePatch: string, fileUrl: string) => {
    this.patchCodeTaskState = 'applying';
    try {
      let source = await this.cardService.getSource(new URL(fileUrl));

      let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
        this.commandService.commandContext,
      );

      let { resultContent: patchedCode } =
        await applySearchReplaceBlockCommand.execute({
          fileContent: source,
          codeBlock: codePatch,
        });

      await this.cardService.saveSource(new URL(fileUrl), patchedCode);
      this.loaderService.reset();

      this.patchCodeTaskState = 'applied';
    } catch (error) {
      console.error(error);
      this.patchCodeTaskState = 'failed';
    }
  });

  <template>
    <ApplyButton
      data-test-apply-code-button
      @state={{this.patchCodeTaskState}}
      {{on 'click' (fn (perform this.patchCodeTask) @codePatch @fileUrl)}}
    />
  </template>
}
