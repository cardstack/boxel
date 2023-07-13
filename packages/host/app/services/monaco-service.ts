import Service from '@ember/service';
import { task } from 'ember-concurrency';
import type * as MonacoSDK from 'monaco-editor';
import {
  type MonacoLanguageConfig,
  extendDefinition,
  extendConfig,
  languageConfigs,
} from '@cardstack/host/utils/editor-language';

export default class MonacoService extends Service {
  #sdk: typeof MonacoSDK | undefined;
  #ready: Promise<void>;

  constructor(properties: object) {
    super(properties);
    this.#ready = this.loadMonacoSDK.perform();
  }

  get ready() {
    return this.#ready;
  }

  get isLoading() {
    return this.loadMonacoSDK.isRunning;
  }

  loadMonacoSDK = task(async () => {
    const monaco = await import('monaco-editor');
    this.#sdk = monaco;
    this.setCompilerOptions();
    let promises = languageConfigs.map((lang) =>
      this.extendMonacoLanguage(lang)
    );
    await Promise.all(promises);
  });

  get sdk() {
    if (!this.#sdk) {
      throw new Error(`cannot use monaco SDK before it has loaded`);
    }
    return this.#sdk;
  }

  // ==== languages ====
  async getLangFromFileExtension(fileName: string): Promise<string> {
    const editorLanguages = this.sdk.languages.getLanguages();
    let extension = '.' + fileName.split('.').pop();
    let language = editorLanguages.find((lang) =>
      lang.extensions?.find((ext) => ext === extension)
    );
    return language?.id ?? 'plaintext';
  }
  async extendMonacoLanguage({
    baseId,
    langInfo,
    rules,
  }: MonacoLanguageConfig) {
    const baseLanguage = this.sdk.languages
      .getLanguages()
      .find((lang) => lang.id === baseId);

    // @ts-ignore-next-line
    let { conf, language } = await baseLanguage.loader();

    let extendedConfig = extendConfig(conf);
    let extendedDef = extendDefinition(language, rules);
    let { id } = langInfo;

    this.sdk.languages.register(langInfo);
    this.sdk.languages.setMonarchTokensProvider(id, extendedDef);
    this.sdk.languages.setLanguageConfiguration(id, extendedConfig);
  }
  get defaultCompilerOptions(): MonacoSDK.languages.typescript.CompilerOptions {
    return {
      target: this.sdk.languages.typescript.ScriptTarget.ES2020,
      module: this.sdk.languages.typescript.ModuleKind.ES2015,
      moduleResolution:
        this.sdk.languages.typescript.ModuleResolutionKind.NodeJs,
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

  setCompilerOptions(
    compilerOptions?: MonacoSDK.languages.typescript.CompilerOptions
  ) {
    this.sdk.languages.typescript.javascriptDefaults.setCompilerOptions(
      compilerOptions ?? this.defaultCompilerOptions
    );
  }
}
