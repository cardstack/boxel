import Component from '@glimmer/component';
import Render from './render';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import { CurrentRun } from '../lib/current-run';
import { readFileAsText as _readFileAsText } from "@cardstack/runtime-common/stream";
import {
  type EntrySetter,
  type Reader,
  type RunState,
  type RunnerRegistration
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
      taskFor(this.doRegistration).perform();
    } else {
      this.localRealm.setupIndexing(this.fromScratch.bind(this), this.incremental.bind(this));
    }
  }

  private async fromScratch(realmURL: URL): Promise<RunState> {
    let state = await taskFor(this.doFromScratch).perform(realmURL);
    return state;
  }

  private async incremental(prev: RunState, url: URL, operation: 'delete' | 'update'): Promise<RunState> {
    let state = await taskFor(this.doIncremental).perform(prev, url, operation);
    return state;
  }

  @restartableTask private async doRegistration(): Promise<void> {
    let register = (globalThis as any).registerRunner as RunnerRegistration;
    await register(this.fromScratch.bind(this), this.incremental.bind(this));
  }

  @restartableTask private async doFromScratch(realmURL: URL): Promise<RunState> {
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

  @restartableTask private async doIncremental(prev: RunState, url: URL, operation: 'delete' | 'update'): Promise<RunState> {
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
      return {
        reader: (globalThis as any).reader as Reader,
        entrySetter: (globalThis as any).entrySetter as EntrySetter
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

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardPrerender: typeof CardPrerender;
  }
}