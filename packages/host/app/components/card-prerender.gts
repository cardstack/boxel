import type Owner from '@ember/owner';
import { getOwner, setOwner } from '@ember/owner';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { didCancel, enqueueTask } from 'ember-concurrency';

import {
  CardError,
  type RenderResponse,
  type RenderError,
  type IndexWriter,
  type JobInfo,
  type Prerenderer,
  type RealmPermissions,
  type Format,
  type PrerenderMeta,
  type RenderRouteOptions,
  serializeRenderRouteOptions,
  cleanCapturedHTML,
} from '@cardstack/runtime-common';
import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';
import {
  getReader,
  type IndexResults,
  type Reader,
  type RunnerOpts,
  type StatusArgs,
  type FromScratchArgsWithPermissions,
  type IncrementalArgsWithPermissions,
} from '@cardstack/runtime-common/worker';

import { CurrentRun } from '../lib/current-run';

import type LoaderService from '../services/loader-service';
import type LocalIndexer from '../services/local-indexer';
import type NetworkService from '../services/network';
import type RenderService from '../services/render-service';
import type StoreService from '../services/store';

// This component is used in a node/Fastboot context to perform
// server-side rendering for indexing as well as by the TestRealm
// to perform rendering for indexing in Ember test contexts.
export default class CardPrerender extends Component {
  @service private declare store: StoreService;
  @service private declare network: NetworkService;
  @service private declare router: RouterService;
  @service private declare renderService: RenderService;
  @service private declare fastboot: { isFastBoot: boolean };
  @service private declare localIndexer: LocalIndexer;
  @service private declare loaderService: LoaderService;
  #nonce = 0;
  #shouldClearCacheForNextRender = true;

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
        this.prerender.bind(this),
      );
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
    try {
      let results = await this.prerenderTask.perform({
        url,
        realm,
        userId,
        permissions,
        renderOptions,
      });
      return results;
    } catch (e: any) {
      if (!didCancel(e)) {
        throw e;
      }
    }
    throw new Error(
      `card-prerender component is missing or being destroyed before prerender of url ${url} was completed`,
    );
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
        let subsequentRenderOptions = omitOneTimeOptions(initialRenderOptions);
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
        iconHTML = await this.renderIcon.perform(url, subsequentRenderOptions);
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
      let captured = this.renderService.renderCardComponent(
        component,
        // I think this is right, may need to revisit this as we incorporate more tests
        ['isolated', 'atom'].includes(format) ? 'innerHTML' : 'outerHTML',
        format,
      );
      if (typeof captured !== 'string') {
        return null;
      }
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

  private renderMeta = enqueueTask(
    async (url: string, renderOptions?: RenderRouteOptions) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(url, renderOptions)}/meta`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
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
      let captured = this.renderService.renderCardComponent(component);
      if (typeof captured !== 'string') {
        return null;
      }
      return this.processCapturedMarkup(captured);
    },
  );

  private async fromScratch({
    realmURL,
    realmUsername: userId,
    permissions,
  }: FromScratchArgsWithPermissions): Promise<IndexResults> {
    try {
      let results = await this.doFromScratch.perform({
        realmURL,
        userId,
        permissions,
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
    realmUsername: userId,
    urls,
    operation,
    ignoreData,
    permissions,
  }: IncrementalArgsWithPermissions): Promise<IndexResults> {
    try {
      let state = await this.doIncremental.perform({
        urls,
        userId,
        permissions,
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
    async ({
      realmURL,
      userId,
      permissions,
    }: {
      userId: string;
      permissions: RealmPermissions;
      realmURL: string;
    }) => {
      let { reader, indexWriter, jobInfo, reportStatus, prerenderer } =
        this.getRunnerParams(realmURL);
      let currentRun = new CurrentRun({
        realmURL: new URL(realmURL),
        userId,
        permissions,
        reader,
        indexWriter,
        jobInfo,
        renderCard: this.renderService.renderCard,
        render: this.renderService.render,
        reportStatus,
        prerenderer,
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
      userId,
      permissions,
      operation,
      ignoreData,
    }: {
      urls: string[];
      realmURL: string;
      operation: 'delete' | 'update';
      ignoreData: Record<string, string>;
      userId: string;
      permissions: RealmPermissions;
    }) => {
      let { reader, indexWriter, jobInfo, reportStatus, prerenderer } =
        this.getRunnerParams(realmURL);
      let currentRun = new CurrentRun({
        realmURL: new URL(realmURL),
        userId,
        permissions,
        reader,
        indexWriter,
        jobInfo,
        ignoreData: { ...ignoreData },
        renderCard: this.renderService.renderCard,
        render: this.renderService.render,
        reportStatus,
        prerenderer,
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
    prerenderer: Prerenderer;
    jobInfo?: JobInfo;
    reportStatus?: (args: StatusArgs) => void;
  } {
    if (this.fastboot.isFastBoot) {
      let optsId = (globalThis as any).runnerOptsId;
      if (optsId == null) {
        throw new Error(`Runner Options Identifier was not set`);
      }
      let { reader, indexWriter, jobInfo, reportStatus, prerenderer } =
        getRunnerOpts(optsId);
      return {
        reader,
        indexWriter,
        jobInfo,
        reportStatus,
        prerenderer,
      };
    } else {
      return {
        reader: getReader(this.network.authedFetch, realmURL),
        indexWriter: this.localIndexer.indexWriter,
        prerenderer: this.localIndexer.prerenderer,
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
