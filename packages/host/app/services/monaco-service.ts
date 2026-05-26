import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import merge from 'lodash/merge';

// The `?worker&url` suffix is a vite feature that builds each worker into a
// standalone script outside the main bundle and gives us back its URL. We
// can't use the plain `?worker` form (which returns a Worker constructor)
// because in deployed environments the host bundle is served from a
// different origin than the page (e.g. boxel-host.stack.cards vs
// realms.stack.cards), and `new Worker(crossOriginUrl)` is forbidden by
// the browser. `makeMonacoWorker` below wraps the cross-origin URL in a
// same-origin Blob shim so worker construction succeeds.
import EditorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker.js?worker&url';
import CSSWorkerUrl from 'monaco-editor/esm/vs/language/css/css.worker.js?worker&url';
import HTMLWorkerUrl from 'monaco-editor/esm/vs/language/html/html.worker.js?worker&url';
import JSONWorkerUrl from 'monaco-editor/esm/vs/language/json/json.worker.js?worker&url';
import TSWorkerUrl from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker&url';

import type { SingleCardDocument } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import type CardService from '@cardstack/host/services/card-service';
import type ResetService from '@cardstack/host/services/reset';
import {
  type MonacoLanguageConfig,
  extendDefinition,
  extendConfig,
  languageConfigs,
} from '@cardstack/host/utils/editor/editor-language';
import { createMonacoWaiterManager } from '@cardstack/host/utils/editor/monaco-test-waiter';

import type * as _MonacoSDK from 'monaco-editor';

export type MonacoSDK = typeof _MonacoSDK;
export type IStandaloneCodeEditor = _MonacoSDK.editor.IStandaloneCodeEditor;

const { serverEchoDebounceMs } = config;

// `new Worker(url)` rejects cross-origin URLs, but importScripts inside a
// worker is allowed to fetch them. When the worker URL is on a different
// origin (deployed environments where the host bundle is served from a
// different host than the page), spawn a same-origin Blob worker that
// immediately importScripts the real worker code.
function makeMonacoWorker(workerUrl: string): Worker {
  let absolute = new URL(workerUrl, window.location.href);
  if (absolute.origin !== window.location.origin) {
    let blob = new Blob([`importScripts(${JSON.stringify(absolute.href)});`], {
      type: 'text/javascript',
    });
    return new Worker(URL.createObjectURL(blob));
  }
  return new Worker(absolute.href);
}

(
  globalThis as unknown as { MonacoEnvironment: _MonacoSDK.Environment }
).MonacoEnvironment = {
  getWorker: function (_workerId, label) {
    switch (label) {
      case 'json':
        return makeMonacoWorker(JSONWorkerUrl);
      case 'css':
      case 'scss':
      case 'less':
        return makeMonacoWorker(CSSWorkerUrl);
      case 'typescript':
      case 'javascript':
        return makeMonacoWorker(TSWorkerUrl);
      case 'html':
      case 'handlebars':
        return makeMonacoWorker(HTMLWorkerUrl);
      default:
        return makeMonacoWorker(EditorWorkerUrl);
    }
  },
};

export default class MonacoService extends Service {
  #ready: Promise<MonacoSDK>;
  #monacoSDK: MonacoSDK | undefined;
  @tracked editor: _MonacoSDK.editor.ICodeEditor | null = null;
  @tracked hasFocus = false;
  @service declare cardService: CardService;
  @service declare reset: ResetService;
  // this is in the service so that we can manipulate it in our tests
  serverEchoDebounceMs = serverEchoDebounceMs;

  private waiterManager = createMonacoWaiterManager();
  // Disposables for global Monaco listeners (e.g. `onDidCreateEditor`). Monaco
  // is a module-level singleton, so anything we register on it stays on the
  // global emitter until explicitly disposed — otherwise the listener closure
  // pins this service (and its owner's ApplicationInstance) across test
  // teardown.
  private globalDisposables: Array<{ dispose(): void }> = [];
  // Disposables for per-editor listeners. Tracked separately so that when the
  // main editor is disposed and later replaced in the same session, the old
  // editor's listeners can be released without waiting for service teardown.
  private editorDisposables: Array<{ dispose(): void }> = [];

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    registerDestructor(this, () => {
      this.disposeEditorListeners();
      for (let d of this.globalDisposables) {
        try {
          d.dispose();
        } catch (_) {
          // Monaco's dispose throws if the editor was already disposed; safe
          // to ignore since we're tearing down anyway.
        }
      }
      this.globalDisposables.length = 0;
    });
    this.#ready = this.loadMonacoSDK.perform();
  }

  private disposeEditorListeners() {
    for (let d of this.editorDisposables) {
      try {
        d.dispose();
      } catch (_) {
        // see globalDisposables note
      }
    }
    this.editorDisposables.length = 0;
  }

  resetState() {
    this.editor?.dispose?.();
    this.editor = null;
    this.hasFocus = false;
    this.trackedSelection = undefined;
    for (let model of this.#monacoSDK?.editor.getModels() ?? []) {
      if (!model.isDisposed() && !model.isAttachedToEditor()) {
        model.dispose();
      }
    }
  }

  private loadMonacoSDK = task(async () => {
    const monaco = await import('monaco-editor');

    // There are tests that rely on this. In older Ember versions, Monaco
    // installed itself as a global automatically because it does that when it
    // detects the presence of an AMD in the environment. Newer Ember versions
    // (with Vite) don't use AMD anymore, so Monaco stopped putting itself on
    // this global.
    (globalThis as any).monaco = monaco;

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
      this.defaultCompilerOptions(monaco),
    );
    let promises = languageConfigs.map((lang) =>
      this.extendMonacoLanguage(lang, monaco),
    );
    monaco.editor.setTheme('vs-dark');
    this.globalDisposables.push(
      monaco.editor.onDidCreateEditor(
        (editor: _MonacoSDK.editor.ICodeEditor) => {
          let isMainEditor = ((editor as any)._domElement as HTMLElement)
            .getAttributeNames()
            .includes('data-monaco-container-operator-mode');

          if (!isMainEditor) {
            // Other editors (code blocks) are read only, so we don't need to track focus
            return;
          }

          // Track editor initialization with shared waiter manager
          const initOperation = `editor-init-${editor.getId()}`;

          // A new main editor replaces any prior one — release the old
          // editor's listeners so its closures stop retaining it.
          this.disposeEditorListeners();
          this.editor = editor;
          this.editorDisposables.push(
            editor.onDidFocusEditorText(() => {
              this.hasFocus = true;
            }),
            editor.onDidBlurEditorText(() => {
              this.hasFocus = false;
            }),
            editor.onDidChangeCursorSelection(() => {
              debounce(this, this.updateSelection, isTesting() ? 10 : 200);
            }),
            editor.onDidDispose(() => {
              if (this.editor === editor) {
                this.editor = null;
                this.hasFocus = false;
                this.trackedSelection = undefined;
                this.disposeEditorListeners();
              }
            }),
          );

          // Use shared waiter manager to track editor initialization
          if (this.waiterManager) {
            this.waiterManager.trackEditorInit(editor, initOperation);
          }
        },
      ),
    );
    await Promise.all(promises);
    this.#monacoSDK = monaco;
    return monaco;
  });

  // === context ===
  // A context is needed to pass a loaded sdk into components and modifiers
  // The monaco sdk is dynamically loaded when visiting /code route
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
    this.editor.revealLineNearTop(cursorPosition.lineNumber);
  }

  getContentHeight() {
    return this.editor?.getContentHeight();
  }

  getSelection() {
    return this.editor?.getSelection();
  }

  @tracked trackedSelection = this.getSelection();
  updateSelection() {
    this.trackedSelection = this.getSelection();
  }
}

declare module '@ember/service' {
  interface Registry {
    'monaco-service': MonacoService;
  }
}
