import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';

import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

import { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import { MonacoSDK } from '@cardstack/host/services/monaco-service';
interface Signature {
  Args: {
    monacoSDK: MonacoSDK;
    code: string;
    language: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

import type * as _MonacoSDK from 'monaco-editor';

export default class CodeBlock extends Component<Signature> {
  @tracked copyCodeButtonText: 'Copy' | 'Copied!' = 'Copy';

  private editorDisplayOptions: MonacoEditorOptions = {
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
  };

  private copyCode = restartableTask(async (code: string) => {
    this.copyCodeButtonText = 'Copied!';
    await navigator.clipboard.writeText(code);
    await timeout(1000);
    this.copyCodeButtonText = 'Copy';
  });

  <template>
    <div class='code-block-actions'>
      <button
        class='code-copy-button'
        {{on 'click' (fn (perform this.copyCode) @code)}}
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
    </div>
    <div
      {{MonacoEditor
        monacoSDK=@monacoSDK
        editorDisplayOptions=this.editorDisplayOptions
        code=@code
        language=@language
      }}
      class='code-block'
      style='height: 120px;'
    >
      {{! Dont put anything here in this div as monaco modifier will override this element }}
    </div>

    <style>
      .code-block,
      .code-block-actions {
        width: calc(100% + 2 * var(--boxel-sp));
        margin-left: calc(-1 * var(--boxel-sp));
      }

      .code-block {
        margin-bottom: 15px;
      }

      .code-block-actions {
        background: black;
        height: 50px;
        padding: var(--boxel-sp-sm) 27px;
        display: flex;
        justify-content: flex-start;
      }

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
  </template>
}

interface MonacoEditorSignature {
  Args: {
    Named: {
      code: string;
      language: string;
      monacoSDK: MonacoSDK;
      editorDisplayOptions: MonacoEditorOptions;
    };
  };
}

class MonacoEditor extends Modifier<MonacoEditorSignature> {
  private monacoState: {
    editor: _MonacoSDK.editor.IStandaloneCodeEditor;
  } | null = null;
  modify(
    element: HTMLElement,
    _positional: [],
    {
      code,
      language,
      monacoSDK,
      editorDisplayOptions,
    }: MonacoEditorSignature['Args']['Named'],
  ) {
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
      let newCode = code;
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

      let withDisabledReadOnly = (readOnlySetting: boolean, fn: () => void) => {
        editor.updateOptions({ readOnly: false });
        fn();
        editor.updateOptions({ readOnly: readOnlySetting });
      };

      withDisabledReadOnly(!!editorDisplayOptions.readOnly, () => {
        editor.executeEdits('append-source', [editOperation]);
      });

      editor.revealLine(lineCount + 1); // Scroll to the end as the code streams
    } else {
      let monacoContainer = element;

      let editor = monacoSDK.editor.create(
        monacoContainer,
        editorDisplayOptions,
      );

      let model = editor.getModel()!;
      monacoSDK.editor.setModelLanguage(model, language);

      model.setValue(code);

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
