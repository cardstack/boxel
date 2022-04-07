import Modifier from '@glint/environment-ember-loose/ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';
import { restartableTask, timeout } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { registerDestructor } from '@ember/destroyable';

interface Signature {
  NamedArgs: {
    content: string;
    language: string;
    contentChanged: (text: string) => void;
  };
}

export default class Monaco extends Modifier<Signature> {
  private model: monaco.editor.ITextModel | undefined;
  private editor: monaco.editor.IStandaloneCodeEditor | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    { content, language, contentChanged }: Signature['NamedArgs']
  ) {
    if (this.model && content != null) {
      monaco.editor.setModelLanguage(this.model, language);
      this.model.setValue(content);
    } else if (content != null) {
      this.editor = monaco.editor.create(element, {
        value: content,
        language,
      });
      registerDestructor(this, () => this.editor!.dispose());

      this.model = this.editor.getModel()!;

      this.model.onDidChangeContent(() =>
        taskFor(this.onContentChanged).perform(contentChanged)
      );

      // To be consistent call this immediately since the initial content
      // was set before we had a chance to register our listener
      taskFor(this.onContentChanged).perform(contentChanged);

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        module: monaco.languages.typescript.ModuleKind.ES2015,
        moduleResolution:
          monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowJs: true,
        allowSyntheticDefaultImports: true,
        noImplicitAny: true,
        noImplicitThis: true,
        alwaysStrict: true,
        strictNullChecks: true,
        strictPropertyInitialization: true,
        noFallthroughCasesInSwitch: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
        noEmitOnError: true,
        noEmit: true,
        inlineSourceMap: true,
        inlineSources: true,
        experimentalDecorators: true,
        allowNonTsExtensions: true,
      });
    }
  }

  @restartableTask private async onContentChanged(
    contentChanged: (text: string) => void
  ) {
    await timeout(500);
    if (this.model) {
      contentChanged(this.model.getValue());
    }
  }
}
