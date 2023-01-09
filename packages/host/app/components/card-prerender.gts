import Component from '@glimmer/component';
import Render from './render';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import { CurrentRun } from '../lib/current-run';
import {
  type Reader,
  type RunState,
  type SearchEntryWithErrors,
  type RunnerRegistration
} from '@cardstack/runtime-common/search-index';
import type IndexerService from '../services/indexer-service';
import type LoaderService from '../services/loader-service';

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

  constructor(owner: unknown, args: any) {
    super(owner, args);
    taskFor(this.doRegistration).perform();
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
    if (this.fastboot.isFastBoot) {
      let register = (globalThis as any).registerRunner as RunnerRegistration;
      await register(this.fromScratch.bind(this), this.incremental.bind(this));
    } else {
      throw new Error('not implemented');
    }
  }

  @restartableTask private async doFromScratch(realmURL: URL): Promise<RunState> {
    if (!this.fastboot.isFastBoot) {
      throw new Error('not implemented');
    }
    let reader = (globalThis as any).reader as Reader;
    let entrySetter = (globalThis as any).entrySetter as (
      url: URL,
      entry: SearchEntryWithErrors
    ) => void;
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
    if (!this.fastboot.isFastBoot) {
      throw new Error('not implemented');
    }
    let reader = (globalThis as any).reader as Reader;
    let entrySetter = (globalThis as any).entrySetter as (
      url: URL,
      entry: SearchEntryWithErrors
    ) => void;
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
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardPrerender: typeof CardPrerender;
  }
}