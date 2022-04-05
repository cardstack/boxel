import { modifier } from '@glint/environment-ember-loose/ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';

export default modifier(function monacoModifier(element) {
  monaco.editor.create(element as HTMLElement, {
    value: '',
    language: 'javascript',
  });

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ES2015,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
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
});
