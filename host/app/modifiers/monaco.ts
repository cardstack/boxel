import Modifier from '@glint/environment-ember-loose/ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';
import { debounce } from 'lodash';

interface Signature {
  NamedArgs: {
    content: string | undefined;
    language: string;
    contentChanged: (text: string) => void;
  };
}

export default class Monaco extends Modifier<Signature> {
  private installed = false;
  private contentChanged: ((text: string) => void) | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    { content, language, contentChanged }: Signature['NamedArgs']
  ) {
    if (this.installed && content != null) {
      // Don't really understand what it means to have multiple models--but either
      // way we are editing the first one
      let [model] = monaco.editor.getModels();
      monaco.editor.setModelLanguage(model, language);
      model.setValue(content);
    } else if (content != null) {
      this.installed = true;
      this.contentChanged = contentChanged;
      monaco.editor.create(element, {
        value: content,
        language,
      });

      let [model] = monaco.editor.getModels();
      model.onDidChangeContent(debounce(this.onContentChanged.bind(this), 500));

      // To be consistent call this immediately since the initial content
      // was set before we had a chance to register our listener
      this.contentChanged(content);

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

  onContentChanged() {
    if (this.contentChanged) {
      let [model] = monaco.editor.getModels();
      this.contentChanged(model.getValue());
    }
  }
}
