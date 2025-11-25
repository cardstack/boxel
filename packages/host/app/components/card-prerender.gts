import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { getOwner, setOwner } from '@ember/owner';
import type {
  RouteInfo,
  RouteInfoWithAttributes,
} from '@ember/routing/-internals';
import RouterService from '@ember/routing/router-service';
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
  type IndexWriter,
  type JobInfo,
  type Prerenderer,
  type RealmPermissions,
  type Format,
  type PrerenderMeta,
  type RenderRouteOptions,
  type FromScratchArgs,
  type IncrementalArgs,
  type FromScratchResult,
  type IncrementalResult,
  serializeRenderRouteOptions,
  cleanCapturedHTML,
} from '@cardstack/runtime-common';
import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';
import {
  getReader,
  type Reader,
  type RunnerOpts,
  type StatusArgs,
} from '@cardstack/runtime-common/worker';

import { CurrentRun } from '../lib/current-run';
import {
  RenderCardTypeTracker,
  type CardRenderContext,
  deriveCardTypeFromDoc,
  withCardType,
  coerceRenderError,
  normalizeRenderError,
  hoistPrimaryCardError,
  resolveModuleUrl,
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

// This component is used in a node/Fastboot context to perform
// server-side rendering for indexing as well as by the TestRealm
// to perform rendering for indexing in Ember test contexts.
export default class CardPrerender extends Component {
  @service('render-store') private declare store: RenderStoreService;
  @service private declare network: NetworkService;
  @service private declare router: RouterService;
  @service private declare renderService: RenderService;
  @service private declare fastboot: { isFastBoot: boolean };
  @service private declare localIndexer: LocalIndexer;
  @service private declare loaderService: LoaderService;
  #nonce = 0;
  #shouldClearCacheForNextRender = true;
  #prerendererDelegate!: Prerenderer;
  #renderErrorPayload: string | undefined;
  #cardTypeTracker = new RenderCardTypeTracker();
  #currentContext: CardRenderContext | undefined;

  #renderBasePath(url: string, renderOptions?: RenderRouteOptions) {
    let optionsSegment = encodeURIComponent(
      serializeRenderRouteOptions(renderOptions ?? {}),
    );
    return `/render/${encodeURIComponent(url)}/${
      this.#nonce
    }/${optionsSegment}`;
  }

  #moduleBasePath(url: string, renderOptions?: RenderRouteOptions) {
    let optionsSegment = encodeURIComponent(
      serializeRenderRouteOptions(renderOptions ?? {}),
    );
    return `/module/${encodeURIComponent(url)}/${
      this.#nonce
    }/${optionsSegment}`;
  }

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    this.#prerendererDelegate = {
      prerenderCard: this.prerender.bind(this),
      prerenderModule: this.prerenderModule.bind(this),
    };
    if (this.fastboot.isFastBoot) {
      try {
        this.doRegistration.perform();
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
        throw new Error(
          `card-prerender component is missing or being destroyed before runner registration was completed`,
        );
      }
    } else {
      this.localIndexer.setup(
        this.fromScratch.bind(this),
        this.incremental.bind(this),
        this.#prerendererDelegate,
      );
      window.addEventListener(
        'boxel-render-error',
        this.#handleRenderErrorEvent,
      );
      registerDestructor(this, () => {
        window.removeEventListener(
          'boxel-render-error',
          this.#handleRenderErrorEvent,
        );
        this.#cardTypeTracker.clear();
      });
    }
  }

  private async prerender({
    url,
    realm,
    userId,
    permissions,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
    renderOptions?: RenderRouteOptions;
  }): Promise<RenderResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () =>
          this.prerenderTask.perform({
            url,
            realm,
            userId,
            permissions,
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
    userId,
    permissions,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
    renderOptions?: RenderRouteOptions;
  }): Promise<ModuleRenderResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () =>
          this.modulePrerenderTask.perform({
            url,
            realm,
            userId,
            permissions,
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

  // This emulates the job of the Prerenderer that runs in the server
  private prerenderTask = enqueueTask(
    async ({
      url,
      renderOptions,
    }: {
      realm: string;
      url: string;
      userId: string;
      permissions: RealmPermissions;
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
            error = { ...JSON.parse(e.message), type: 'error' };
          } catch (err) {
            let cardErr = new CardError(e.message);
            cardErr.stack = e.stack;
            error = {
              error: {
                ...cardErr.toJSON(),
                deps: [url.replace(/\.json$/, '')],
                additionalErrors: null,
              },
              type: 'error',
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
      userId: string;
      permissions: RealmPermissions;
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
        this.loaderService.resetLoader({
          clearFetchCache: true,
          reason: 'module-prerender clearCache',
        });
        this.store.resetCache();
      } else {
        delete initialRenderOptions.clearCache;
      }

      let routeInfo = await this.router.recognizeAndLoad(
        this.#moduleBasePath(url, initialRenderOptions),
      );
      return routeInfo.attributes as ModuleRenderResponse;
    },
  );

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
        ['isolated', 'atom'].includes(format) ? 'innerHTML' : 'outerHTML',
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
      let hoisted = hoistPrimaryCardError(renderErrorPayload, {
        instanceId: context?.cardId,
        moduleUrl: resolveModuleUrl(context?.cardId),
      });
      let normalized = normalizeRenderError(hoisted, {
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

  private async fromScratch({
    realmURL,
  }: FromScratchArgs): Promise<FromScratchResult> {
    try {
      let results = await this.doFromScratch.perform({
        realmURL,
      });
      return results;
    } catch (e: any) {
      if (!didCancel(e)) {
        throw e;
      }
    }
    throw new Error(
      `card-prerender component is missing or being destroyed before from scratch index of realm ${realmURL} was completed`,
    );
  }

  private async incremental({
    realmURL,
    urls,
    operation,
    ignoreData,
  }: IncrementalArgs): Promise<IncrementalResult> {
    try {
      let state = await this.doIncremental.perform({
        urls,
        realmURL,
        operation,
        ignoreData,
      });
      return state;
    } catch (e: any) {
      if (!didCancel(e)) {
        throw e;
      }
    }
    throw new Error(
      `card-prerender component is missing or being destroyed before incremental index of ${urls.join()} was completed`,
    );
  }

  private doRegistration = enqueueTask(async () => {
    let optsId = (globalThis as any).runnerOptsId;
    if (optsId == null) {
      throw new Error(`Runner Options Identifier was not set`);
    }
    let register = getRunnerOpts(optsId).registerRunner;
    await register(this.fromScratch.bind(this), this.incremental.bind(this));
  });

  private doFromScratch = enqueueTask(
    async ({ realmURL }: { realmURL: string }) => {
      let { reader, indexWriter, jobInfo, reportStatus } =
        this.getRunnerParams(realmURL);
      let currentRun = new CurrentRun({
        realmURL: new URL(realmURL),
        reader,
        indexWriter,
        jobInfo,
        renderCard: this.renderService.renderCard,
        render: this.renderService.render,
        reportStatus,
      });
      setOwner(currentRun, getOwner(this)!);

      let current = await CurrentRun.fromScratch(currentRun);
      this.renderService.indexRunDeferred?.fulfill();
      return current;
    },
  );

  private doIncremental = enqueueTask(
    async ({
      urls,
      realmURL,
      operation,
      ignoreData,
    }: {
      urls: string[];
      realmURL: string;
      operation: 'delete' | 'update';
      ignoreData: Record<string, string>;
    }) => {
      let { reader, indexWriter, jobInfo, reportStatus } =
        this.getRunnerParams(realmURL);
      let currentRun = new CurrentRun({
        realmURL: new URL(realmURL),
        reader,
        indexWriter,
        jobInfo,
        ignoreData: { ...ignoreData },
        renderCard: this.renderService.renderCard,
        render: this.renderService.render,
        reportStatus,
      });
      setOwner(currentRun, getOwner(this)!);
      let current = await CurrentRun.incremental(currentRun, {
        urls: urls.map((u) => new URL(u)),
        operation,
      });
      this.renderService.indexRunDeferred?.fulfill();
      return current;
    },
  );

  private getRunnerParams(realmURL: string): {
    reader: Reader;
    indexWriter: IndexWriter;
    jobInfo?: JobInfo;
    reportStatus?: (args: StatusArgs) => void;
  } {
    if (this.fastboot.isFastBoot) {
      let optsId = (globalThis as any).runnerOptsId;
      if (optsId == null) {
        throw new Error(`Runner Options Identifier was not set`);
      }
      let { reader, indexWriter, jobInfo, reportStatus } =
        getRunnerOpts(optsId);
      return {
        reader,
        indexWriter,
        jobInfo,
        reportStatus,
      };
    } else {
      return {
        reader: getReader(this.network.authedFetch, realmURL),
        indexWriter: this.localIndexer.indexWriter,
      };
    }
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

function getRunnerOpts(optsId: number): RunnerOpts {
  return ((globalThis as any).getRunnerOpts as (optsId: number) => RunnerOpts)(
    optsId,
  );
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
