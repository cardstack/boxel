import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import type {
  RouteInfo,
  RouteInfoWithAttributes,
} from '@ember/routing/-internals';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';

import { didCancel, enqueueTask } from 'ember-concurrency';

import {
  CardError,
  SupportedMimeType,
  type CardErrorsJSONAPI,
  type LooseSingleCardDocument,
  type RenderResponse,
  type RenderError,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type Prerenderer,
  type Format,
  type PrerenderMeta,
  type RenderRouteOptions,
  serializeRenderRouteOptions,
  cleanCapturedHTML,
} from '@cardstack/runtime-common';

import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';

import {
  buildModuleModel,
  type ModuleModelContext,
  type ModuleModelState,
  type ModuleTypesCache,
} from '../routes/module';

import { createAuthErrorGuard } from '../utils/auth-error-guard';
import {
  RenderCardTypeTracker,
  type CardRenderContext,
  deriveCardTypeFromDoc,
  withCardType,
  coerceRenderError,
  normalizeRenderError,
} from '../utils/render-error';
import {
  enableRenderTimerStub,
  withTimersBlocked,
} from '../utils/render-timer-stub';

import type LoaderService from '../services/loader-service';
import type LocalIndexer from '../services/local-indexer';
import type NetworkService from '../services/network';
import type RenderService from '../services/render-service';
import type RenderStoreService from '../services/render-store';

// This component is used to perform rendering for indexing in Ember test contexts
export default class CardPrerender extends Component {
  @service('render-store') declare private store: RenderStoreService;
  @service declare private network: NetworkService;
  @service declare private router: RouterService;
  @service declare private renderService: RenderService;
  @service declare private localIndexer: LocalIndexer;
  @service declare private loaderService: LoaderService;
  #nonce = 0;
  #shouldClearCacheForNextRender = true;
  #prerendererDelegate!: Prerenderer;
  #renderErrorPayload: string | undefined;
  #cardTypeTracker = new RenderCardTypeTracker();
  #currentContext: CardRenderContext | undefined;
  #moduleTypesCache: ModuleTypesCache = new WeakMap() as ModuleTypesCache;
  #moduleLastStoreResetKey: string | undefined;
  #moduleAuthGuard = createAuthErrorGuard();

  #renderBasePath(url: string, renderOptions?: RenderRouteOptions) {
    let optionsSegment = encodeURIComponent(
      serializeRenderRouteOptions(renderOptions ?? {}),
    );
    return `/render/${encodeURIComponent(url)}/${
      this.#nonce
    }/${optionsSegment}`;
  }

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    this.#moduleAuthGuard.register();
    this.#prerendererDelegate = {
      prerenderCard: this.prerender.bind(this),
      prerenderModule: this.prerenderModule.bind(this),
      prerenderFileExtract: this.prerenderFileExtract.bind(this),
    };
    this.localIndexer.setup(this.#prerendererDelegate);
    window.addEventListener('boxel-render-error', this.#handleRenderErrorEvent);
    registerDestructor(this, () => {
      window.removeEventListener(
        'boxel-render-error',
        this.#handleRenderErrorEvent,
      );
      this.#cardTypeTracker.clear();
      this.#moduleAuthGuard.unregister();
    });
  }

  private async prerender({
    url,
    realm,
    auth,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    renderOptions?: RenderRouteOptions;
  }): Promise<RenderResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () =>
          this.prerenderTask.perform({
            url,
            realm,
            auth,
            renderOptions,
          });
        let results = isTesting() ? await run() : await withTimersBlocked(run);
        return results;
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
      }
      throw new Error(
        `card-prerender component is missing or being destroyed before prerender of url ${url} was completed`,
      );
    });
  }

  private async prerenderModule({
    url,
    realm,
    auth,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    renderOptions?: RenderRouteOptions;
  }): Promise<ModuleRenderResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () =>
          this.modulePrerenderTask.perform({
            url,
            realm,
            auth,
            renderOptions,
          });
        return isTesting() ? await run() : await withTimersBlocked(run);
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
      }
      throw new Error(
        `card-prerender component is missing or being destroyed before module prerender of url ${url} was completed`,
      );
    });
  }

  private async prerenderFileExtract({
    url,
    realm,
    auth,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    renderOptions?: RenderRouteOptions;
  }): Promise<FileExtractResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () =>
          this.fileExtractPrerenderTask.perform({
            url,
            realm,
            auth,
            renderOptions,
          });
        return isTesting() ? await run() : await withTimersBlocked(run);
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
      }
      throw new Error(
        `card-prerender component is missing or being destroyed before file extract prerender of url ${url} was completed`,
      );
    });
  }

  // This emulates the job of the Prerenderer that runs in the server
  private prerenderTask = enqueueTask(
    async ({
      url,
      renderOptions,
    }: {
      realm: string;
      url: string;
      auth: string;
      renderOptions?: RenderRouteOptions;
    }): Promise<RenderResponse> => {
      this.#nonce++;
      let context: CardRenderContext = {
        cardId: url.replace(/\.json$/, ''),
        nonce: String(this.#nonce),
      };
      this.#currentContext = context;
      this.localIndexer.renderError = undefined;
      this.localIndexer.prerenderStatus = 'loading';
      let shouldClearCache = this.#consumeClearCacheForRender(
        Boolean(renderOptions?.clearCache),
      );
      let initialRenderOptions: RenderRouteOptions = {
        ...(renderOptions ?? {}),
      };
      if (shouldClearCache) {
        initialRenderOptions.clearCache = true;
        this.loaderService.resetLoader({
          clearFetchCache: true,
          reason: 'card-prerender clearCache',
        });
        this.store.resetCache();
      } else {
        delete initialRenderOptions.clearCache;
      }

      try {
        await this.#primeCardType(url, context);
        let error: RenderError | undefined;
        let isolatedHTML: string | null = null;
        let headHTML: string | null = null;
        let meta: PrerenderMeta = {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
        };
        let atomHTML = null;
        let iconHTML = null;
        let embeddedHTML: Record<string, string> | null = null;
        let fittedHTML: Record<string, string> | null = null;
        try {
          let subsequentRenderOptions =
            omitOneTimeOptions(initialRenderOptions);
          isolatedHTML = await this.renderHTML.perform(
            url,
            'isolated',
            0,
            initialRenderOptions,
          );
          meta = await this.renderMeta.perform(url, subsequentRenderOptions);
          headHTML = await this.renderHTML.perform(
            url,
            'head',
            0,
            subsequentRenderOptions,
          );
          atomHTML = await this.renderHTML.perform(
            url,
            'atom',
            0,
            subsequentRenderOptions,
          );
          iconHTML = await this.renderIcon.perform(
            url,
            subsequentRenderOptions,
          );
          if (meta?.types) {
            embeddedHTML = await this.renderAncestors.perform(
              url,
              'embedded',
              meta.types,
              subsequentRenderOptions,
            );
            fittedHTML = await this.renderAncestors.perform(
              url,
              'fitted',
              meta.types,
              subsequentRenderOptions,
            );
          }
        } catch (e: any) {
          try {
            error = { ...JSON.parse(e.message), type: 'instance-error' };
          } catch (err) {
            let cardErr = new CardError(e.message);
            cardErr.stack = e.stack;
            error = {
              error: {
                ...cardErr.toJSON(),
                deps: [url.replace(/\.json$/, '')],
                additionalErrors: null,
              },
              type: 'instance-error',
            };
          }
          this.store.resetCache();
        }
        if (this.localIndexer.prerenderStatus === 'loading') {
          this.localIndexer.prerenderStatus = 'ready';
        }
        return {
          ...meta,
          isolatedHTML,
          headHTML,
          atomHTML,
          embeddedHTML,
          fittedHTML,
          iconHTML,
          ...(error ? { error } : {}),
        };
      } finally {
        this.#cardTypeTracker.set(context, undefined);
        if (this.#currentContext === context) {
          this.#currentContext = undefined;
        }
      }
    },
  );

  private modulePrerenderTask = enqueueTask(
    async ({
      url,
      renderOptions,
    }: {
      realm: string;
      url: string;
      auth: string;
      renderOptions?: RenderRouteOptions;
    }): Promise<ModuleRenderResponse> => {
      this.#nonce++;
      let shouldClearCache = this.#consumeClearCacheForRender(
        Boolean(renderOptions?.clearCache),
      );
      let initialRenderOptions: RenderRouteOptions = {
        ...(renderOptions ?? {}),
      };
      if (shouldClearCache) {
        initialRenderOptions.clearCache = true;
      } else {
        delete initialRenderOptions.clearCache;
      }

      let result = await buildModuleModel(
        {
          id: url,
          nonce: String(this.#nonce),
          renderOptions: initialRenderOptions,
        },
        this.#moduleModelContext(),
      );
      return result as ModuleRenderResponse;
    },
  );

  private fileExtractPrerenderTask = enqueueTask(
    async ({
      url,
      renderOptions,
    }: {
      realm: string;
      url: string;
      auth: string;
      renderOptions?: RenderRouteOptions;
    }): Promise<FileExtractResponse> => {
      this.#nonce++;
      let shouldClearCache = this.#consumeClearCacheForRender(
        Boolean(renderOptions?.clearCache),
      );
      let initialRenderOptions: RenderRouteOptions = {
        ...(renderOptions ?? {}),
        fileExtract: true,
      };
      if (shouldClearCache) {
        initialRenderOptions.clearCache = true;
      } else {
        delete initialRenderOptions.clearCache;
      }

      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(url, initialRenderOptions)}/file-extract`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      await this.#ensureRenderReady(routeInfo);
      return routeInfo.attributes as FileExtractResponse;
    },
  );

  #moduleModelContext(): ModuleModelContext {
    return {
      router: this.router,
      store: this.store,
      loaderService: this.loaderService,
      network: this.network,
      authGuard: this.#moduleAuthGuard,
      state: this.#moduleModelState(),
    };
  }

  #moduleModelState(): ModuleModelState {
    return {
      getTypesCache: () => this.#moduleTypesCache,
      setTypesCache: (cache) => (this.#moduleTypesCache = cache),
      getLastStoreResetKey: () => this.#moduleLastStoreResetKey,
      setLastStoreResetKey: (key) => {
        this.#moduleLastStoreResetKey = key;
      },
    };
  }

  private renderHTML = enqueueTask(
    async (
      url: string,
      format: Format,
      ancestorLevel = 0,
      renderOptions?: RenderRouteOptions,
    ) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(
          url,
          renderOptions,
        )}/html/${format}/${ancestorLevel}`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      let component = routeInfo.attributes.Component;
      this.#renderErrorPayload = undefined;
      let captured = await this.renderService.renderCardComponent(
        component,
        // I think this is right, may need to revisit this as we incorporate more tests
        ['isolated', 'atom', 'head'].includes(format)
          ? 'innerHTML'
          : 'outerHTML',
        format,
        this.waitForLinkedData,
      );
      if (this.#renderErrorPayload) {
        throw new Error(this.#renderErrorPayload);
      }

      if (typeof captured !== 'string') {
        return null;
      }
      await this.#ensureRenderReady(routeInfo);
      return this.processCapturedMarkup(captured);
    },
  );

  private renderAncestors = enqueueTask(
    async (
      url: string,
      format: 'embedded' | 'fitted',
      types: string[],
      renderOptions?: RenderRouteOptions,
    ) => {
      let ancestors: Record<string, string> = {};
      for (let i = 0; i < types.length; i++) {
        let res = await this.renderHTML.perform(url, format, i, renderOptions);
        ancestors[types[i]] = res as string;
      }
      return ancestors;
    },
  );

  async #primeCardType(url: string, context: CardRenderContext) {
    try {
      let response = await this.network.authedFetch(url, {
        method: 'GET',
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
      });
      if (!response.ok) {
        return;
      }
      let doc = (await response.json()) as
        | LooseSingleCardDocument
        | CardErrorsJSONAPI;
      if ('errors' in doc) {
        return;
      }
      let cardType = await deriveCardTypeFromDoc(
        doc,
        url,
        this.loaderService.loader,
      );
      this.#cardTypeTracker.set(context, cardType);
    } catch (_error) {
      // ignore
    }
  }

  #handleRenderErrorEvent = (
    event: Event & { detail?: { reason?: unknown }; reason?: unknown },
  ) => {
    let reason =
      'reason' in event ? (event as any).reason : event.detail?.reason;
    if (!reason) {
      return;
    }
    let context = this.#currentContext ?? this.#contextFromDom();
    let cardType = context ? this.#cardTypeTracker.get(context) : undefined;
    let renderErrorPayload = coerceRenderError(reason);
    if (renderErrorPayload) {
      let normalized = normalizeRenderError(renderErrorPayload, {
        cardId: context?.cardId,
      });
      this.#renderErrorPayload = JSON.stringify(
        withCardType(normalized, cardType),
      );
      return;
    }
    if (reason instanceof Error) {
      this.#renderErrorPayload = reason.message;
    } else if (typeof reason === 'string') {
      this.#renderErrorPayload = reason;
    } else {
      try {
        this.#renderErrorPayload = JSON.stringify(reason);
      } catch (_err) {
        this.#renderErrorPayload = String(reason);
      }
    }
  };

  #contextFromDom(): CardRenderContext | undefined {
    if (typeof document === 'undefined') {
      return undefined;
    }
    let container = document.querySelector(
      '[data-prerender]',
    ) as HTMLElement | null;
    if (!container) {
      return undefined;
    }
    return {
      cardId: container.dataset.prerenderId ?? undefined,
      nonce: container.dataset.prerenderNonce ?? undefined,
    };
  }

  private waitForLinkedData = async () => {
    await Promise.resolve(); // ensure lazy link fetches enqueue
    await this.store.loaded();
  };

  private renderMeta = enqueueTask(
    async (url: string, renderOptions?: RenderRouteOptions) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(url, renderOptions)}/meta`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      await this.#ensureRenderReady(routeInfo);
      return routeInfo.attributes as PrerenderMeta;
    },
  );

  private renderIcon = enqueueTask(
    async (url: string, renderOptions?: RenderRouteOptions) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(url, renderOptions)}/icon`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      let component = routeInfo.attributes.Component;
      this.#renderErrorPayload = undefined;
      let captured = await this.renderService.renderCardComponent(
        component,
        'outerHTML',
        'isolated',
        this.waitForLinkedData,
      );
      if (this.#renderErrorPayload) {
        throw new Error(this.#renderErrorPayload);
      }
      if (typeof captured !== 'string') {
        return null;
      }
      await this.#ensureRenderReady(routeInfo);
      return this.processCapturedMarkup(captured);
    },
  );

  // this does the work that normally the render controller is doing. we do this
  // because we are using RouterService.recognizeAndLoad() which doesn't actually do a
  // full transition, it just runs the model hook. so we need to emulate scheduling
  // the ready deferred after the component is rendered.
  #ensureRenderReady(
    routeInfo: RouteInfo | RouteInfoWithAttributes,
  ): Promise<void> {
    let current: RouteInfo | RouteInfoWithAttributes | null = routeInfo;
    while (current) {
      if (current.name === 'render' && 'attributes' in current) {
        let readyPromise = (current as RouteInfoWithAttributes).attributes
          ?.readyPromise;
        if (readyPromise && typeof readyPromise.then === 'function') {
          return readyPromise;
        }
        break;
      }
      current = current.parent as RouteInfo | RouteInfoWithAttributes | null;
    }
    return Promise.resolve();
  }

  #consumeClearCacheForRender(requestedClear = false): boolean {
    if (requestedClear) {
      this.#shouldClearCacheForNextRender = true;
    }
    if (!this.#shouldClearCacheForNextRender) {
      return false;
    }
    this.#shouldClearCacheForNextRender = false;
    return true;
  }

  private processCapturedMarkup(markup: string): string {
    let cleaned = cleanCapturedHTML(markup);
    let errorPayload = extractPrerenderError(cleaned);
    if (errorPayload) {
      if (this.localIndexer.prerenderStatus === 'loading') {
        this.localIndexer.prerenderStatus = 'unusable';
      }
      this.localIndexer.renderError = errorPayload;
      throw new Error(errorPayload);
    }
    return cleaned;
  }
}

async function withRenderContext<T>(cb: () => Promise<T>): Promise<T> {
  let hadContext = Boolean((globalThis as any).__boxelRenderContext);
  let restoreTimers: (() => void) | undefined;
  if (!hadContext) {
    (globalThis as any).__boxelRenderContext = true;
    if (!isTesting()) {
      restoreTimers = enableRenderTimerStub();
    }
  }
  try {
    return await cb();
  } finally {
    if (!hadContext) {
      delete (globalThis as any).__boxelRenderContext;
      restoreTimers?.();
    }
  }
}

function omitOneTimeOptions(options: RenderRouteOptions): RenderRouteOptions {
  if (options.clearCache) {
    let { clearCache: _clearCache, ...rest } = options;
    return rest as RenderRouteOptions;
  }
  return options;
}

function extractPrerenderError(markup: string): string | undefined {
  if (!markup.includes('data-prerender-error')) {
    return undefined;
  }
  let start = markup.indexOf('{');
  let end = markup.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return markup.slice(start, end + 1).trim();
  }
  return undefined;
}
