import { registerDestructor } from '@ember/destroyable';

import { isTesting } from '@embroider/macros';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';

import { Range } from 'monaco-editor';

import { ModuleDeclaration } from '@cardstack/host/resources/module-contents';

import type * as MonacoSDK from 'monaco-editor';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentChanged: (text: string) => void;
      onSetup?: (editor: MonacoSDK.editor.IStandaloneCodeEditor) => void;
      language?: string;
      monacoSDK: typeof MonacoSDK;
      selectedDeclaration?: ModuleDeclaration | undefined;
    };
  };
}

const DEBOUNCE_MS = 500;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private decorationIds: string[] = [];

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
      onSetup,
      monacoSDK,
      selectedDeclaration,
    }: Signature['Args']['Named'],
  ) {
    if (this.model) {
      if (language && language !== this.lastLanguage) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }
      if (content !== this.lastContent) {
        this.model.setValue(content);
      }

      //highlight text inside editor
      let loc = selectedDeclaration?.path?.node.loc;
      if (loc) {
        let { start, end } = loc;
        let range = new Range(start.line, start.column, end.line, end.column);
        if (this.decorationIds.length > 0) {
          this.editor!.deltaDecorations(this.decorationIds, []);
        }
        this.decorationIds = this.editor!.deltaDecorations(
          [],
          [
            {
              range,
              options: {
                className: 'custom-monaco-highlight',
              },
            },
          ],
        );
        console.log(this.decorationIds);
      }
    } else {
      let editorOptions: MonacoSDK.editor.IStandaloneEditorConstructionOptions =
        {
          value: content,
          language,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          minimap: {
            enabled: false,
          },
        };

      // Code rendering is inconsistently wrapped without this, producing spurious visual diffs
      if (isTesting()) {
        editorOptions.wordWrap = 'on';
      }

      this.editor = monacoSDK.editor.create(element, editorOptions);

      onSetup?.(this.editor);

      registerDestructor(this, () => this.editor!.dispose());

      this.model = this.editor.getModel()!;

      this.model.onDidChangeContent(() =>
        this.onContentChanged.perform(contentChanged),
      );
    }
    this.lastLanguage = language;
  }

  private onContentChanged = restartableTask(
    async (contentChanged: (text: string) => void) => {
      timeout(DEBOUNCE_MS);
      if (this.model) {
        this.lastContent = this.model.getValue();
        contentChanged(this.lastContent);
      }
    },
  );
}
