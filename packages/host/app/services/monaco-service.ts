import Service from '@ember/service';
import { task } from 'ember-concurrency';
import type * as _MonacoSDK from 'monaco-editor';
import {
  type MonacoLanguageConfig,
  extendDefinition,
  extendConfig,
  languageConfigs,
} from '@cardstack/host/utils/editor-language';

export type MonacoSDK = typeof _MonacoSDK;
export type IStandaloneCodeEditor = _MonacoSDK.editor.IStandaloneCodeEditor;

export default class MonacoService extends Service {
  #ready: Promise<MonacoSDK>;

  constructor(properties: object) {
    super(properties);
    this.#ready = this.loadMonacoSDK.perform();
  }

  private loadMonacoSDK = task(async () => {
    const monaco = await import('monaco-editor');
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
      this.defaultCompilerOptions(monaco),
    );
    let promises = languageConfigs.map((lang) =>
      this.extendMonacoLanguage(lang, monaco),
    );
    await Promise.all(promises);
    return monaco;
  });

  // === context ===
  // A context is needed to pass a loaded sdk into components and modifiers
  // The monaco sdk is dyanmically loaded when visiting /code route
  async getMonacoContext(): Promise<MonacoSDK> {
    return await this.#ready;
  }

  private async extendMonacoLanguage(
    { baseId, langInfo, rules }: MonacoLanguageConfig,
    sdk: MonacoSDK,
  ) {
    const baseLanguage = sdk.languages
      .getLanguages()
      .find((lang) => lang.id === baseId);

    if (!baseLanguage) {
      throw new Error(`missing language ${baseId}`);
    }

    // @ts-expect-error: types don't declare loader
    let { conf, language } = await baseLanguage.loader();

    let extendedConfig = extendConfig(conf);
    let extendedDef = extendDefinition(language, rules);
    let { id } = langInfo;

    sdk.languages.register(langInfo);
    sdk.languages.setMonarchTokensProvider(id, extendedDef);
    sdk.languages.setLanguageConfiguration(id, extendedConfig);
  }

  private defaultCompilerOptions(
    sdk: MonacoSDK,
  ): _MonacoSDK.languages.typescript.CompilerOptions {
    return {
      target: sdk.languages.typescript.ScriptTarget.ES2020,
      module: sdk.languages.typescript.ModuleKind.ES2015,
      moduleResolution: sdk.languages.typescript.ModuleResolutionKind.NodeJs,
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
    };
  }
}
