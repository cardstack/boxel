import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  didCancel,
  enqueueTask,
  dropTask,
  restartableTask,
} from 'ember-concurrency';

import { baseRealm } from '@cardstack/runtime-common';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import {
  type EntrySetter,
  type Reader,
  type RunState,
  type RunnerOpts,
} from '@cardstack/runtime-common/search-index';
import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';

import { CurrentRun } from '../lib/current-run';

import { getModulesInRealm } from '../lib/utils';

import type LoaderService from '../services/loader-service';
import type LocalIndexer from '../services/local-indexer';
import type RenderService from '../services/render-service';

// This component is used in a node/Fastboot context to perform
// server-side rendering for indexing as well as by the TestRealm
// to perform rendering for indexing in Ember test contexts.
export default class CardPrerender extends Component {
  @service declare loaderService: LoaderService;
  @service declare renderService: RenderService;
  @service declare fastboot: { isFastBoot: boolean };
  @service declare localIndexer: LocalIndexer;

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
      this.warmUpModuleCache.perform();
      this.localIndexer.setup(
        this.fromScratch.bind(this),
        this.incremental.bind(this),
      );
    }
  }

  private async fromScratch(realmURL: URL): Promise<RunState> {
    try {
      let state = await this.doFromScratch.perform(realmURL);
      return state;
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
    prev: RunState,
    url: URL,
    operation: 'delete' | 'update',
    onInvalidation?: (invalidatedURLs: URL[]) => void,
  ): Promise<RunState> {
    try {
      let state = await this.doIncremental.perform(
        prev,
        url,
        operation,
        onInvalidation,
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

  private warmUpModuleCache = dropTask(async () => {
    let baseRealmModules = await getModulesInRealm(
      this.loaderService.loader,
      baseRealm.url,
    );
    // TODO the fact that we need to reverse this list is
    // indicative of a loader issue. Need to work with Ed around this as I think
    // there is probably missing state in our loader's state machine.
    for (let module of baseRealmModules.reverse()) {
      await this.loaderService.loader.import(module);
    }
  });

  private doRegistration = enqueueTask(async () => {
    let optsId = (globalThis as any).runnerOptsId;
    if (optsId == null) {
      throw new Error(`Runner Options Identifier was not set`);
    }
    let register = getRunnerOpts(optsId).registerRunner;
    await register(this.fromScratch.bind(this), this.incremental.bind(this));
  });

  private doFromScratch = enqueueTask(async (realmURL: URL) => {
    let { reader, entrySetter } = this.getRunnerParams();
    await this.resetLoaderInFastboot.perform();
    let current = await CurrentRun.fromScratch(
      new CurrentRun({
        realmURL,
        loader: this.loaderService.loader,
        reader,
        entrySetter,
        renderCard: this.renderService.renderCard.bind(this.renderService),
      }),
    );
    this.renderService.indexRunDeferred?.fulfill();
    return current;
  });

  private doIncremental = enqueueTask(
    async (
      prev: RunState,
      url: URL,
      operation: 'delete' | 'update',
      onInvalidation?: (invalidatedURLs: URL[]) => void,
    ) => {
      let { reader, entrySetter } = this.getRunnerParams();
      await this.resetLoaderInFastboot.perform();
      let current = await CurrentRun.incremental({
        url,
        operation,
        prev,
        reader,
        loader: this.loaderService.loader,
        entrySetter,
        renderCard: this.renderService.renderCard.bind(this.renderService),
        onInvalidation,
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

  private getRunnerParams(): {
    reader: Reader;
    entrySetter: EntrySetter;
  } {
    if (this.fastboot.isFastBoot) {
      let optsId = (globalThis as any).runnerOptsId;
      if (optsId == null) {
        throw new Error(`Runner Options Identifier was not set`);
      }
      return {
        reader: getRunnerOpts(optsId).reader,
        entrySetter: getRunnerOpts(optsId).entrySetter,
      };
    } else {
      let self = this;
      function readFileAsText(
        path: LocalPath,
        opts?: { withFallbacks?: true },
      ): Promise<{ content: string; lastModified: number } | undefined> {
        return _readFileAsText(
          path,
          self.localIndexer.adapter.openFile.bind(self.localIndexer.adapter),
          opts,
        );
      }
      return {
        reader: {
          readdir: this.localIndexer.adapter.readdir.bind(
            this.localIndexer.adapter,
          ),
          readFileAsText,
        },
        entrySetter: this.localIndexer.setEntry.bind(this.localIndexer),
      };
    }
  }
}

function getRunnerOpts(optsId: number): RunnerOpts {
  return ((globalThis as any).getRunnerOpts as (optsId: number) => RunnerOpts)(
    optsId,
  );
}
