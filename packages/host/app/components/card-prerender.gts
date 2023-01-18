import Component from '@glimmer/component';
import Render from './render';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { didCancel, enqueueTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import { CurrentRun } from '../lib/current-run';
import { readFileAsText as _readFileAsText } from "@cardstack/runtime-common/stream";
import {
  type EntrySetter,
  type Reader,
  type RunState,
  type RunnerOpts
} from '@cardstack/runtime-common/search-index';
import type IndexerService from '../services/indexer-service';
import type LoaderService from '../services/loader-service';
import type LocalRealm from '../services/local-realm';
import type { LocalPath } from "@cardstack/runtime-common/paths";

export default class CardPrerender extends Component {
  <template>
    {{#if this.indexerService.card}}
      <div class="worker-render">
        <Render @card={{this.indexerService.card}} @format="isolated" @opts={{hash disableShadowDOM=true}}/>
      </div>
    {{/if}}
  </template>

  @service declare loaderService: LoaderService;
  @service declare indexerService: IndexerService;
  @service declare fastboot: { isFastBoot: boolean };
  @service declare localRealm: LocalRealm;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    if (this.fastboot.isFastBoot) {
      try {
        taskFor(this.doRegistration).perform();
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
        throw new Error(`card-prerender component is being destroyed before runner registration was completed`);
      }
    } else {
      this.localRealm.setupIndexing(this.fromScratch.bind(this), this.incremental.bind(this));
    }
  }

  private async fromScratch(realmURL: URL): Promise<RunState> {
    try {
      let state = await taskFor(this.doFromScratch).perform(realmURL);
      return state
    } catch (e: any) {
      if (!didCancel(e)) {
        throw e;
      }
    }
    throw new Error(`card-prerender component is being destroyed before from scratch index of realm ${realmURL} was completed`);
  }

  private async incremental(prev: RunState, url: URL, operation: 'delete' | 'update'): Promise<RunState> {
    try {
      let state = await taskFor(this.doIncremental).perform(prev, url, operation);
      return state;
    } catch (e: any) {
      if (!didCancel(e)) {
        throw e;
      }
    }
    throw new Error(`card-prerender component is being destroyed before incremental index of ${url} was completed`);
  }

  @enqueueTask private async doRegistration(): Promise<void> {
    let optsId = (globalThis as any).runnerOptsId;
    if (optsId == null) {
      throw new Error(`Runner Options Identifier was not set`);
    }
    let register = getRunnerOpts(optsId).registerRunner;
    await register(this.fromScratch.bind(this), this.incremental.bind(this));
  }

  @enqueueTask private async doFromScratch(realmURL: URL): Promise<RunState> {
    let { reader, entrySetter } = this.getRunnerParams();
    let current = await CurrentRun.fromScratch(
      new CurrentRun({
        realmURL,
        loader: this.loaderService.loader,
        reader,
        entrySetter,
        renderCard: this.indexerService.renderCard.bind(this.indexerService),
      })
    );
    this.indexerService.indexRunDeferred?.fulfill();
    return current;
  }

  @enqueueTask private async doIncremental(prev: RunState, url: URL, operation: 'delete' | 'update'): Promise<RunState> {
    let { reader, entrySetter } = this.getRunnerParams();
    let current = await CurrentRun.incremental({
        url,
        operation,
        prev,
        reader,
        loader: this.loaderService.loader,
        entrySetter,
        renderCard: this.indexerService.renderCard.bind(this.indexerService),
      });
    this.indexerService.indexRunDeferred?.fulfill();
    return current;
  }

  private getRunnerParams(): {
    reader: Reader;
    entrySetter: EntrySetter
  } {
    if (this.fastboot.isFastBoot) {
      let optsId = (globalThis as any).runnerOptsId;
      if (optsId == null) {
        throw new Error(`Runner Options Identifier was not set`);
      }
      return {
        reader: getRunnerOpts(optsId).reader,
        entrySetter: getRunnerOpts(optsId).entrySetter 
      };
    } else {
      let self = this;
      function readFileAsText (
        path: LocalPath,
        opts?: { withFallbacks?: true }
      ): Promise<{ content: string; lastModified: number } | undefined> {
        return _readFileAsText(
          path,
          self.localRealm.adapter.openFile.bind(self.localRealm.adapter),
          opts
        );
      }
      return {
        reader: { 
          readdir: this.localRealm.adapter.readdir.bind(this.localRealm.adapter),
          readFileAsText
        },
        entrySetter: this.localRealm.setEntry.bind(this.localRealm)
      };
    }
  }
}

function getRunnerOpts(optsId: number): RunnerOpts {
  return ((globalThis as any).getRunnerOpts as (optsId: number) => RunnerOpts)(optsId);
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardPrerender: typeof CardPrerender;
  }
}