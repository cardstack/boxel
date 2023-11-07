import { registerDestructor } from '@ember/destroyable';
import { isTesting } from '@embroider/macros';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

import config from '@cardstack/host/config/environment';
import '@cardstack/requirejs-monaco-ember-polyfill';

import type * as MonacoSDK from 'monaco-editor';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentChanged: (text: string) => void;
      cursorPosition?: MonacoSDK.Range;
      onSetup?: (editor: MonacoSDK.editor.IStandaloneCodeEditor) => void;
      language?: string;
      monacoSDK: typeof MonacoSDK;
    };
  };
}

// ignore SSE server echoes of our own saves by not processing content changes
// within serverEchoDebounceMs of the last monaco change in memory
const { serverEchoDebounceMs, monacoDebounceMs } = config;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private lastModified = Date.now();

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
      cursorPosition,
      onSetup,
      monacoSDK,
    }: Signature['Args']['Named'],
  ) {
    if (this.model) {
      if (language && language !== this.lastLanguage) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }
      if (
        content !== this.lastContent &&
        Date.now() >= this.lastModified + serverEchoDebounceMs
      ) {
        this.model.setValue(content);
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
    if (
      this.editor &&
      cursorPosition &&
      Date.now() >= this.lastModified + serverEchoDebounceMs
    ) {
      this.editor.focus();
      this.editor.setPosition({
        lineNumber: cursorPosition.startLineNumber,
        column: cursorPosition.startColumn,
      });
      this.editor.revealLineInCenter(cursorPosition.startLineNumber);
    }
  }

  private onContentChanged = restartableTask(
    async (contentChanged: (text: string) => void) => {
      this.lastModified = Date.now();
      await timeout(monacoDebounceMs);
      if (this.model) {
        this.lastContent = this.model.getValue();
        contentChanged(this.lastContent);
      }
    },
  );
}
