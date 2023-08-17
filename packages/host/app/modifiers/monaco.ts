import Modifier from 'ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import { restartableTask, timeout } from 'ember-concurrency';
import { registerDestructor } from '@ember/destroyable';
import type * as MonacoSDK from 'monaco-editor';

interface Signature {
  Args: {
    Named: {
      content: string;
      contentChanged: (text: string) => void;
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

  modify(
    element: HTMLElement,
    _positional: [],
    {
      content,
      language,
      contentChanged,
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
      this.editor = monacoSDK.editor.create(element, {
        value: content,
        language,
      });

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
