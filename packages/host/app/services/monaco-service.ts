import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import merge from 'lodash/merge';

import { type SingleCardDocument } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import CardService from '@cardstack/host/services/card-service';
import {
  type MonacoLanguageConfig,
  extendDefinition,
  extendConfig,
  languageConfigs,
} from '@cardstack/host/utils/editor-language';

import type * as _MonacoSDK from 'monaco-editor';

export type MonacoSDK = typeof _MonacoSDK;
export type IStandaloneCodeEditor = _MonacoSDK.editor.IStandaloneCodeEditor;

const { serverEchoDebounceMs } = config;

export default class MonacoService extends Service {
  #ready: Promise<MonacoSDK>;
  @tracked editor: _MonacoSDK.editor.ICodeEditor | null = null;
  @tracked hasFocus = false;
  @service declare cardService: CardService;
  // this is in the service so that we can manipulate it in our tests
  serverEchoDebounceMs = serverEchoDebounceMs;

  constructor(owner: Owner) {
    super(owner);
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
    monaco.editor.onDidCreateEditor((editor: _MonacoSDK.editor.ICodeEditor) => {
      let cssClass = ((editor as any)._domElement as HTMLElement).getAttribute(
        'class',
      );
      // we only care about the code mode monaco editor here
      if (cssClass?.includes('code-block')) {
        return;
      }
      this.editor = editor;
      this.editor.onDidFocusEditorText(() => {
        this.hasFocus = true;
      });
      this.editor.onDidBlurEditorText(() => {
        this.hasFocus = false;
      });
    });
    await Promise.all(promises);
    return monaco;
  });

  // === context ===
  // A context is needed to pass a loaded sdk into components and modifiers
  // The monaco sdk is dyanmically loaded when visiting /code route
  async getMonacoContext(): Promise<MonacoSDK> {
    return await this.#ready;
  }

  // File serialization is a special type of card serialization that the host would
  // otherwise not encounter, but it does here since it's using the accept header
  // application/vnd.card+source to load the file that we see in monaco. This is
  // the only place that we use this accept header for loading card instances--everywhere
  // else we use application/vnd.card+json. Because of this the resulting JSON has
  // different semantics than the host would normally encounter--for instance, this
  // file serialization format is always missing an ID (because the ID is the filename).
  // Whereas for card instances obtained via application/vnd.card+json, a missing ID
  // means that the card is not saved.
  //
  // In order to prevent confusion around which type of serialization you are dealing
  // with, we convert the file serialization back to the form the host is accustomed
  // to (application/vnd.card+json) as soon as possible so that the semantics around
  // file serialization don't leak outside of where they are immediately used.
  reverseFileSerialization(
    fileSerializationJSON: SingleCardDocument,
    id: string,
    realmURL: string,
  ): SingleCardDocument {
    return merge({}, fileSerializationJSON, {
      data: {
        id,
        type: 'card',
        meta: {
          realmURL,
        },
      },
    });
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

  getMonacoContent() {
    let model = this.editor?.getModel();
    if (!model) {
      return null;
    }
    return model.getValue();
  }

  getLineCursorOn(): string | null {
    let model = this.editor?.getModel();
    if (!model || !this.editor) {
      return null;
    }

    let currentPosition = this.editor.getPosition();
    return currentPosition
      ? model.getLineContent(currentPosition.lineNumber)
      : null;
  }

  getCursorPosition() {
    return this.editor?.getPosition();
  }

  updateCursorPosition(cursorPosition: _MonacoSDK.Position) {
    if (!this.editor) {
      return;
    }
    this.editor.focus();
    this.editor.setPosition(cursorPosition);
    this.editor.revealLineInCenter(cursorPosition.lineNumber);
  }

  getContentHeight() {
    return this.editor?.getContentHeight();
  }
}
