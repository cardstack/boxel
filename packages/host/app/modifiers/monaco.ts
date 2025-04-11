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
      contentChanged: ((text: string) => void) | undefined;
      initialCursorPosition?: MonacoSDK.Position;
      onCursorPositionChange?: (position: MonacoSDK.Position) => void;
      onSetup?: (editor: MonacoSDK.editor.IStandaloneCodeEditor) => void;
      language?: string;
      readOnly?: boolean;
      monacoSDK: typeof MonacoSDK;
      editorDisplayOptions?: MonacoEditorOptions;
    };
  };
}

const { monacoDebounceMs, monacoCursorDebounceMs } = config;

export type MonacoEditorOptions =
  MonacoSDK.editor.IStandaloneEditorConstructionOptions;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private lastModified = Date.now();
  private lastCursorPosition: MonacoSDK.Position | undefined;
  @service declare private monacoService: MonacoService;

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
      initialCursorPosition,
      onCursorPositionChange,
      onSetup,
      readOnly,
      monacoSDK,
      editorDisplayOptions,
    }: Signature['Args']['Named'],
  ) {
    if (this.editor && this.model) {
      if (language && language !== this.lastLanguage) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }

      console.log(
        'content differers from model: ' + (content !== this.model.getValue()),
      );

      console.log(
        'date is later than lastmodified + debounce: ' +
          (Date.now() <
            this.lastModified + this.monacoService.serverEchoDebounceMs),
      );

      if (
        content !== this.model.getValue() &&
        Date.now() < this.lastModified + this.monacoService.serverEchoDebounceMs
      ) {
        console.log('ignoring realm event echo');
        console.log('date now', Date.now());
        console.log('last modified', this.lastModified);
      }
      if (
        content !== this.model.getValue() &&
        // ignore realm event echoes of our own saves by not processing content changes
        // within serverEchoDebounceMs of the last monaco change in memory
        Date.now() >=
          this.lastModified + this.monacoService.serverEchoDebounceMs
      ) {
        console.log('updating content as it is different and past debounce');
        console.log(
          `now (${Date.now()}) > last modified (${this.lastModified}) + debounce (${this.monacoService.serverEchoDebounceMs})`,
        );
        console.log(
          `${Date.now() - (this.lastModified + this.monacoService.serverEchoDebounceMs)}ms difference`,
        );
        this.lastContent = content;
        this.model.setValue(content);
      }
    } else {
      // The light theme editor is used for the main editor in code mode,
      // but we also have a dark themed editor for the preview editor in AI panel.
      // The latter is themed using a CSS filter as opposed to defining a new monaco theme
      // because monaco does not support multiple themes on the same page (check the comment in
      // room-message-command.gts for more details)
      monacoSDK.editor.defineTheme('boxel-monaco-light-theme', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#FFFFFF',
        },
      });

      let editorOptions: MonacoEditorOptions = {
        readOnly,
        value: content,
        language,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        minimap: {
          enabled: false,
        },
        theme: 'boxel-monaco-light-theme',
        ...editorDisplayOptions,
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
        contentChanged ? this.onContentChanged.perform(contentChanged) : null,
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
            this.lastCursorPosition = position;
          }
        }
      });
    }
    this.lastLanguage = language;

    if (initialCursorPosition != null) {
      this.initializeCursorPosition.perform(initialCursorPosition);
    }
  }

  private onContentChanged = restartableTask(
    async (contentChanged: (text: string) => void) => {
      let content = this.model?.getValue();
      if (this.lastContent === content) {
        return;
      }
      this.lastModified = Date.now();
      await timeout(monacoDebounceMs);
      if (this.model) {
        this.lastContent = this.model.getValue();
        contentChanged(this.lastContent);
      }
    },
  );

  // Initialize cursor position asynchronously
  // to avoid potential effects on other elements.
  // If this affects other elements, there is a potential double update to a value in the same computation,
  // leading to an infinite Glimmer invalidation error.
  private initializeCursorPosition = restartableTask(
    async (position?: MonacoSDK.Position) => {
      await timeout(monacoCursorDebounceMs);
      if (!position) {
        position = new MonacoSDK.Position(1, 1);
      }
      if (!this.lastCursorPosition) {
        this.monacoService.updateCursorPosition(position);
      }
    },
  );
}
