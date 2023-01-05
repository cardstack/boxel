import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { CurrentRun } from '../lib/current-run';
import type LoaderService from '../services/loader-service';
import type IndexerService from '../services/indexer-service';
import {
  type Reader,
  type RunState,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';

interface Model {
  // cards: [string, Card][];
}
interface ModelArgs {
  realmURL: string;
  url?: string;
  op?: 'update' | 'delete';
}
interface RouteInfoModelArgs {
  queryParams: ModelArgs;
}

export default class Indexer extends Route<Model> {
  queryParams = {
    realmURL: {
      refreshModel: true,
    },
    url: {
      refreshModel: true,
    },
    op: {
      refreshModel: true,
    },
  };
  @service declare fastboot: { isFastBoot: boolean };
  @service declare loaderService: LoaderService;
  @service declare indexerService: IndexerService;

  async model(args: ModelArgs | RouteInfoModelArgs): Promise<Model> {
    let realmURL: string;
    let url: string | undefined;
    let operation: 'update' | 'delete' | undefined;
    if ('queryParams' in args) {
      realmURL = args.queryParams.realmURL;
      url = args.queryParams.url;
      operation = args.queryParams.op;
    } else {
      realmURL = args.realmURL;
      url = args.url;
      operation = args.op;
    }
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

    return {};
  }
}
