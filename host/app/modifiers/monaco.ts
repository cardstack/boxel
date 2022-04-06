import Modifier from '@glint/environment-ember-loose/ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';

interface Signature {
  NamedArgs: {
    content: string;
    language: string;
  };
}

export default class Monaco extends Modifier<Signature> {
  private installed = false;

  modify(
    element: HTMLElement,
    _positional: [],
    { content, language }: Signature['NamedArgs']
  ) {
    if (this.installed) {
      // Don't really understand what it means to have multiple models--but either
      // way we are editing the first one
      let [model] = monaco.editor.getModels();
      monaco.editor.setModelLanguage(model, language);
      model.setValue(content);
    } else {
      this.installed = true;
      monaco.editor.create(element, {
        value: content,
        language,
      });

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
}
