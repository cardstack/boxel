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

// This component is used in a node/Fastboot context to perform
// server-side rendering for indexing as well as by the TestRealm
// to perform rendering for indexing in Ember test contexts.
export default class CardPrerender extends Component {
  @service private declare network: NetworkService;
  @service private declare router: RouterService;
  @service private declare renderService: RenderService;
  @service private declare fastboot: { isFastBoot: boolean };
  @service private declare localIndexer: LocalIndexer;
  @tracked private renderComponent: BoxComponent | undefined;

  <template>
    {{#unless this.isFastboot}}
      {{#if this.renderComponent}}
        {{! TODO add status for 'ready' or 'error' !}}
        <div data-prerender>
          <this.renderComponent />
        </div>
      {{/if}}
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

  // TODO use EC?
  private async prerender({
    realm: _realm,
    url,
    userId: _userId,
    permissions: _permissions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
  }): Promise<RenderResponse> {
    // TODO handle JWTs
    let isolatedHTML = await this.renderHTML(url, 'isolated');
    let meta = await this.renderMeta(url);
    let atomHTML = await this.renderHTML(url, 'atom');
    let iconHTML = await this.renderIcon(url);
    let embeddedHTML: Record<string, string> | null = null;
    let fittedHTML: Record<string, string> | null = null;
    if (meta?.types) {
      embeddedHTML = await this.renderAncestors(url, 'embedded', meta.types);
      fittedHTML = await this.renderAncestors(url, 'fitted', meta.types);
    }
    return {
      ...meta,
      isolatedHTML,
      atomHTML,
      embeddedHTML,
      fittedHTML,
      iconHTML,
    };
  }

  // TODO use try/catch to handle render errors
  // TODO use EC?
  private async renderHTML(url: string, format: Format, ancestorLevel = 0) {
    let routeInfo = await this.router.recognizeAndLoad(
      `/render/${encodeURIComponent(url)}/html/${format}/${ancestorLevel}`,
    );
    this.renderComponent = routeInfo.attributes.Component;
    await new Promise<void>((r) => scheduleOnce('afterRender', this, r));
    let el = document.querySelector('[data-prerender]');
    return el?.children[0]?.innerHTML?.trim() ?? null;
  }

  // TODO use EC?
  private async renderAncestors(
    url: string,
    format: 'embedded' | 'fitted',
    types: string[],
  ) {
    let ancestors: Record<string, string> = {};
    for (let i = 0; i < types.length; i++) {
      let res = await this.renderHTML(url, format, i);
      ancestors[types[i]] = res as string;
    }
    return ancestors;
  }

  // TODO use EC?
  private async renderMeta(url: string) {
    let routeInfo = await this.router.recognizeAndLoad(
      `/render/${encodeURIComponent(url)}/meta`,
    );
    return routeInfo.attributes as PrerenderMeta;
  }

  // TODO use EC?
  private async renderIcon(url: string) {
    let routeInfo = await this.router.recognizeAndLoad(
      `/render/${encodeURIComponent(url)}/icon`,
    );
    this.renderComponent = routeInfo.attributes.Component;
    await new Promise<void>((r) => scheduleOnce('afterRender', this, r));
    let el = document.querySelector('[data-prerender]');
    return el?.children[0]?.outerHTML?.trim() ?? null;
  }

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
