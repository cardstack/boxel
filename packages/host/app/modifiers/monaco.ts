import { registerDestructor } from '@ember/destroyable';
import { isTesting } from '@embroider/macros';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';

import * as MonacoSDK from 'monaco-editor';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentChanged: (text: string) => void;
      cursorPosition?: MonacoSDK.Position;
      onCursorPositionChange?: (position: MonacoSDK.Position) => void;
      onSetup?: (editor: MonacoSDK.editor.IStandaloneCodeEditor) => void;
      language?: string;
      monacoSDK: typeof MonacoSDK;
    };
  };
}

const DEBOUNCE_MS = 500;

export default class Monaco extends Modifier<Signature> {
  private model: MonacoSDK.editor.ITextModel | undefined;
  private editor: MonacoSDK.editor.IStandaloneCodeEditor | undefined;
  private lastLanguage: string | undefined;
  private lastContent: string | undefined;
  private lastCursorPosition: MonacoSDK.Position | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
      cursorPosition,
      onCursorPositionChange,
      onSetup,
      monacoSDK,
    }: Signature['Args']['Named'],
  ) {
    if (this.model) {
      if (language && language !== this.lastLanguage) {
        monacoSDK.editor.setModelLanguage(this.model, language);
      }
      if (content !== this.lastContent) {
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
      if (onCursorPositionChange) {
        this.editor.onDidChangeCursorSelection((event) => {
          this.onCursorChanged.perform(onCursorPositionChange, event);
        })
      }
    }
    this.lastLanguage = language;
    if (cursorPosition) {
      this.changeCursorPosition(cursorPosition);
    }
  }

  private onContentChanged = restartableTask(
    async (contentChanged: (text: string) => void) => {
      await timeout(DEBOUNCE_MS);
      if (this.model) {
        this.lastContent = this.model.getValue();
        contentChanged(this.lastContent);
      }
    },
  );

  private onCursorChanged = restartableTask(
    async (cursorPositionChange: (position: MonacoSDK.Position) => void, event: MonacoSDK.editor.ICursorSelectionChangedEvent) => {
      if (this.editor && (event.source !== 'api' && event.source !== 'model') && 
          (event.selection.startLineNumber ===  event.selection.endLineNumber &&
            event.selection.startColumn === event.selection.endColumn)) {
        // This function has to be async to avoid this error:
        // Attempted to update `monacoCursorPosition` on `CodeSubmode`,
        // but it had already been used previously in the same computation
        await timeout(100);
        let position = this.editor.getPosition();
        if (position) {
          this.lastCursorPosition = position;
          cursorPositionChange(position);
        }
      }
    },
  );

  changeCursorPosition = (cursorPosition: MonacoSDK.Position) => {
    if (
      !this.editor ||
      (this.lastCursorPosition && this.lastCursorPosition.equals(cursorPosition))
    ) {
      return;
    }
    this.editor.focus();
    this.editor.setPosition(cursorPosition);
    this.editor.revealLineInCenter(cursorPosition.lineNumber);
  }
}
