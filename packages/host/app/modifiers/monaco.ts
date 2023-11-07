import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

import * as MonacoSDK from 'monaco-editor';

import config from '@cardstack/host/config/environment';
import type MonacoService from '@cardstack/host/services/monaco-service';
import '@cardstack/requirejs-monaco-ember-polyfill';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentChanged: (text: string) => void;
      initializeCursorPosition?: () => void;
      onCursorPositionChange?: (position: MonacoSDK.Position) => void;
      onSetup?: (editor: MonacoSDK.editor.IStandaloneCodeEditor) => void;
      language?: string;
      monacoSDK: typeof MonacoSDK;
    };
  };
}

const { monacoDebounceMs } = config;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private lastModified = Date.now();
  @service private declare monacoService: MonacoService;

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
      initializeCursorPosition,
      onCursorPositionChange,
      onSetup,
      monacoSDK,
    }: Signature['Args']['Named'],
  ) {
    if (this.editor && this.model) {
      if (language && language !== this.lastLanguage) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }
      if (
        content !== this.lastContent &&
        // ignore SSE server echoes of our own saves by not processing content changes
        // within serverEchoDebounceMs of the last monaco change in memory
        Date.now() >=
          this.lastModified + this.monacoService.serverEchoDebounceMs
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
      this.editor.onDidChangeCursorSelection((event) => {
        if (
          this.editor &&
          event.source !== 'model' &&
          event.selection.startLineNumber === event.selection.endLineNumber &&
          event.selection.startColumn === event.selection.endColumn
        ) {
          let position = this.editor.getPosition();
          if (position) {
            onCursorPositionChange?.(position);
          }
        }
      });
    }
    this.lastLanguage = language;
    if (this.editor && !this.editor.hasTextFocus()) {
      initializeCursorPosition?.();
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
