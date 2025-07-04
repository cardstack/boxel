import type Owner from '@ember/owner';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { didCancel, enqueueTask } from 'ember-concurrency';

import { type IndexWriter, type JobInfo } from '@cardstack/runtime-common';
import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';
import {
  getReader,
  type IndexResults,
  type Reader,
  type RunnerOpts,
  type StatusArgs,
} from '@cardstack/runtime-common/worker';

import { CurrentRun } from '../lib/current-run';

import type LoaderService from '../services/loader-service';
import type LocalIndexer from '../services/local-indexer';
import type NetworkService from '../services/network';
import type RenderService from '../services/render-service';

// This component is used in a node/Fastboot context to perform
// server-side rendering for indexing as well as by the TestRealm
// to perform rendering for indexing in Ember test contexts.
export default class CardPrerender extends Component {
  @service private declare loaderService: LoaderService;
  @service private declare network: NetworkService;
  @service private declare renderService: RenderService;
  @service private declare fastboot: { isFastBoot: boolean };
  @service private declare localIndexer: LocalIndexer;

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
      );
    }
  }

  private async fromScratch(realmURL: URL): Promise<IndexResults> {
    try {
      let results = await this.doFromScratch.perform(realmURL);
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

  private async incremental(
    urls: URL[],
    realmURL: URL,
    operation: 'delete' | 'update',
    ignoreData: Record<string, string>,
  ): Promise<IndexResults> {
    try {
      let state = await this.doIncremental.perform(
        urls,
        realmURL,
        operation,
        ignoreData,
      );
      return state;
    } catch (e: any) {
      if (!didCancel(e)) {
        throw e;
      }
    }
    throw new Error(
      `card-prerender component is missing or being destroyed before incremental index of ${urls
        .map((u) => u.href)
        .join()} was completed`,
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

  private doFromScratch = enqueueTask(async (realmURL: URL) => {
    let { reader, indexWriter, jobInfo, reportStatus } =
      this.getRunnerParams(realmURL);
    let currentRun = new CurrentRun({
      realmURL,
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
  });

  private doIncremental = enqueueTask(
    async (
      urls: URL[],
      realmURL: URL,
      operation: 'delete' | 'update',
      ignoreData: Record<string, string>,
    ) => {
      let { reader, indexWriter, jobInfo, reportStatus } =
        this.getRunnerParams(realmURL);
      let currentRun = new CurrentRun({
        realmURL,
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
        urls,
        operation,
      });
      this.renderService.indexRunDeferred?.fulfill();
      return current;
    },
  );

  private getRunnerParams(realmURL: URL): {
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
}

function getRunnerOpts(optsId: number): RunnerOpts {
  return ((globalThis as any).getRunnerOpts as (optsId: number) => RunnerOpts)(
    optsId,
  );
}
