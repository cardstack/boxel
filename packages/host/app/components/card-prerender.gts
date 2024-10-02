import type Owner from '@ember/owner';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { didCancel, enqueueTask, restartableTask } from 'ember-concurrency';

import { type IndexWriter } from '@cardstack/runtime-common';
import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';
import {
  getReader,
  type IndexResults,
  type Reader,
  type RunnerOpts,
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
    url: URL,
    realmURL: URL,
    operation: 'delete' | 'update',
    ignoreData: Record<string, string>,
  ): Promise<IndexResults> {
    try {
      let state = await this.doIncremental.perform(
        url,
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
      `card-prerender component is missing or being destroyed before incremental index of ${url} was completed`,
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
    let { reader, indexWriter } = this.getRunnerParams(realmURL);
    await this.resetLoaderInFastboot.perform();
    let currentRun = new CurrentRun({
      realmURL,
      reader,
      indexWriter,
      renderCard: this.renderService.renderCard.bind(this.renderService),
    });
    setOwner(currentRun, getOwner(this)!);

    let current = await CurrentRun.fromScratch(currentRun);
    this.renderService.indexRunDeferred?.fulfill();
    return current;
  });

  private doIncremental = enqueueTask(
    async (
      url: URL,
      realmURL: URL,
      operation: 'delete' | 'update',
      ignoreData: Record<string, string>,
    ) => {
      let { reader, indexWriter } = this.getRunnerParams(realmURL);
      await this.resetLoaderInFastboot.perform();
      let currentRun = new CurrentRun({
        realmURL,
        reader,
        indexWriter,
        ignoreData: { ...ignoreData },
        renderCard: this.renderService.renderCard.bind(this.renderService),
      });
      setOwner(currentRun, getOwner(this)!);
      let current = await CurrentRun.incremental(currentRun, {
        url,
        operation,
      });
      this.renderService.indexRunDeferred?.fulfill();
      return current;
    },
  );

  // perform this in EC task to prevent rerender cycles
  private resetLoaderInFastboot = restartableTask(async () => {
    if (this.fastboot.isFastBoot) {
      await Promise.resolve();
      this.loaderService.reset();
    }
  });

  private getRunnerParams(realmURL: URL): {
    reader: Reader;
    indexWriter: IndexWriter;
  } {
    if (this.fastboot.isFastBoot) {
      let optsId = (globalThis as any).runnerOptsId;
      if (optsId == null) {
        throw new Error(`Runner Options Identifier was not set`);
      }
      return {
        reader: getRunnerOpts(optsId).reader,
        indexWriter: getRunnerOpts(optsId).indexWriter,
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
