import Component from '@glimmer/component';
import Render from './render';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import { CurrentRun } from '../lib/current-run';
import type LoaderService from '../services/loader-service';
import type IndexerService from '../services/indexer-service';
import {
  type Reader,
  type RunState,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';

export default class WorkerRender extends Component {
  <template>
    {{#if this.indexerService.card}}
      <div class="worker-render">
        <Render @card={{this.indexerService.card}} @format="isolated" @opts={{hash disableShadowDOM=true}}/>
      </div>
    {{/if}}
  </template>

  @service declare indexerService: IndexerService;
  @service declare fastboot: { isFastBoot: boolean };
  @service declare loaderService: LoaderService;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    taskFor(this.start).perform();
  }

  @restartableTask private async start() {
    let reader: Reader;
    let prev: RunState | undefined;
    let current: CurrentRun;
    let entrySetter: (url: URL, entry: SearchEntryWithErrors) => void;
    if (this.fastboot.isFastBoot) {
      reader = (globalThis as any).reader as Reader;
      prev = ((globalThis as any).getRunState as () => RunState | undefined)();
      entrySetter = (globalThis as any).entrySetter as (
        url: URL,
        entry: SearchEntryWithErrors
      ) => void;
    } else {
      reader = this.indexerService.reader;
      prev = this.indexerService.prevRunState;
      entrySetter = this.indexerService.entrySetter;
    }

    let url = this.indexerService.updatedURL;
    let operation = this.indexerService.operation;
    let realmURL = this.indexerService.realmURL;
    if (!realmURL) {
      throw new Error('realm URL to index was not specified');
    }

    if (prev) {
      if (!url) {
        throw new Error(
          `cannot perform incremental index without specifying the URL of changed instance`
        );
      }
      if (!operation) {
        throw new Error(
          `cannot perform incremental index without specifying the operation (op = 'update' | 'delete')`
        );
      }
      current = await CurrentRun.incremental({
        url: new URL(url),
        operation,
        prev,
        reader,
        loader: this.loaderService.loader,
        entrySetter,
        visitCard: this.indexerService.visitCard.bind(this.indexerService),
      });
    } else {
      current = await CurrentRun.fromScratch(
        new CurrentRun({
          realmURL: new URL(realmURL),
          loader: this.loaderService.loader,
          reader,
          entrySetter,
          visitCard: this.indexerService.visitCard.bind(this.indexerService),
        })
      );
    }

    if (this.fastboot.isFastBoot) {
      ((globalThis as any).setRunState as (state: RunState) => void)({
        realmURL: new URL(realmURL),
        instances: current.instances,
        ignoreMap: current.ignoreMap,
        modules: current.modules,
        stats: current.stats,
      });
    } else {
      this.indexerService.setRunState({
        realmURL: new URL(realmURL),
        instances: current.instances,
        ignoreMap: current.ignoreMap,
        modules: current.modules,
        stats: current.stats,
      });
    }

    this.indexerService.indexRunDeferred?.fulfill();
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    WorkerRender: typeof WorkerRender;
  }
}