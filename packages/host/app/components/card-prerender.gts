import type Owner from '@ember/owner';
import { getOwner, setOwner } from '@ember/owner';
import RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { didCancel, enqueueTask } from 'ember-concurrency';

import {
  type RenderResponse,
  type RenderError,
  type IndexWriter,
  type JobInfo,
  type Prerenderer,
  type RealmPermissions,
  type Format,
  type PrerenderMeta,
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

import type { BoxComponent } from 'https://cardstack.com/base/field-component';

import { CurrentRun } from '../lib/current-run';

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
  @tracked private renderComponent: BoxComponent | undefined;
  @tracked private format: Format | undefined;

  <template>
    {{#unless this.isFastboot}}
      <div
        data-prerender
        data-prerender-status={{this.localIndexer.prerenderStatus}}
      >
        {{#if this.localIndexer.renderError}}
          {{this.localIndexer.renderError}}
        {{else if this.renderComponent}}
          <this.renderComponent @format={{this.format}} />
        {{/if}}
      </div>
    {{/unless}}
  </template>

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

  private get isFastboot() {
    return this.fastboot.isFastBoot;
  }

  private async prerender({
    url,
    realm,
    userId,
    permissions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
  }): Promise<RenderResponse> {
    try {
      let results = await this.prerenderTask.perform({
        url,
        realm,
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
      `card-prerender component is missing or being destroyed before prerender of url ${url} was completed`,
    );
  }

  // This emulates the job of the Prerenderer that runs in the server
  private prerenderTask = enqueueTask(
    async ({
      url,
    }: {
      realm: string;
      url: string;
      userId: string;
      permissions: RealmPermissions;
    }): Promise<RenderResponse> => {
      this.renderComponent = undefined;
      this.localIndexer.renderError = undefined;
      this.localIndexer.prerenderStatus = 'loading';
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
        isolatedHTML = await this.renderHTML.perform(url, 'isolated');
        meta = await this.renderMeta.perform(url);
        atomHTML = await this.renderHTML.perform(url, 'atom');
        iconHTML = await this.renderIcon.perform(url);
        if (meta?.types) {
          embeddedHTML = await this.renderAncestors.perform(
            url,
            'embedded',
            meta.types,
          );
          fittedHTML = await this.renderAncestors.perform(
            url,
            'fitted',
            meta.types,
          );
        }
      } catch (e: any) {
        try {
          error = JSON.parse(e.message);
        } catch (err) {
          throw new Error(`unexpected error during indexing: ${e.message}`);
        }
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
      capture: 'innerHTML' | 'outerHTML' = 'innerHTML',
    ) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `/render/${encodeURIComponent(url)}/html/${format}/${ancestorLevel}`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      this.format = format;
      this.renderComponent = routeInfo.attributes.Component;
      await new Promise<void>((r) => scheduleOnce('afterRender', this, r));
      let el = document.querySelector('[data-prerender]');
      let captured = el?.children[0]?.[capture]?.trim() ?? null;
      return typeof captured === 'string' ? cleanCapturedHTML(captured) : null;
    },
  );

  private renderAncestors = enqueueTask(
    async (url: string, format: 'embedded' | 'fitted', types: string[]) => {
      let ancestors: Record<string, string> = {};
      for (let i = 0; i < types.length; i++) {
        let res = await this.renderHTML.perform(url, format, i, 'outerHTML');
        ancestors[types[i]] = res as string;
      }
      return ancestors;
    },
  );

  private renderMeta = enqueueTask(async (url: string) => {
    let routeInfo = await this.router.recognizeAndLoad(
      `/render/${encodeURIComponent(url)}/meta`,
    );
    if (this.localIndexer.renderError) {
      throw new Error(this.localIndexer.renderError);
    }
    return routeInfo.attributes as PrerenderMeta;
  });

  private renderIcon = enqueueTask(async (url: string) => {
    let routeInfo = await this.router.recognizeAndLoad(
      `/render/${encodeURIComponent(url)}/icon`,
    );
    if (this.localIndexer.renderError) {
      throw new Error(this.localIndexer.renderError);
    }
    this.renderComponent = routeInfo.attributes.Component;
    await new Promise<void>((r) => scheduleOnce('afterRender', this, r));
    let el = document.querySelector('[data-prerender]');
    let captured = el?.children[0]?.outerHTML?.trim() ?? null;
    return typeof captured === 'string' ? cleanCapturedHTML(captured) : null;
  });

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
}

function getRunnerOpts(optsId: number): RunnerOpts {
  return ((globalThis as any).getRunnerOpts as (optsId: number) => RunnerOpts)(
    optsId,
  );
}

function cleanCapturedHTML(html: string): string {
  if (!html) {
    return html;
  }
  const emberIdAttr = /\s+id=(?:"ember\d+"|'ember\d+'|ember\d+)(?=[\s>])/g;
  const emptyDataAttr = /\s+(data-[A-Za-z0-9:_-]+)=(?:""|''|(?=[\s>]))/g;
  let cleaned = html.replace(emberIdAttr, '');
  cleaned = cleaned.replace(emptyDataAttr, ' $1');
  return cleaned;
}
