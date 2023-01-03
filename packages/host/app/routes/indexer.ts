import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { CurrentRun } from '../lib/current-run';
import type LoaderService from '../services/loader-service';
import {
  type Reader,
  type RunState,
} from '@cardstack/runtime-common/search-index';

interface Stats {
  instancesIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
}
interface Model {
  stats: Stats;
  stringifiedStats: string;
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
    if (this.fastboot.isFastBoot) {
      reader = (globalThis as any).reader as Reader;
      prev = ((globalThis as any).getRunState as () => RunState | undefined)();
    } else {
      throw new Error('not implemented');
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
      });
    } else {
      current = await CurrentRun.fromScratch(
        new CurrentRun({
          realmURL: new URL(realmURL),
          loader: this.loaderService.loader,
          reader,
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
      throw new Error('not implemented');
    }

    let { stats } = current;
    let stringifiedStats = JSON.stringify(stats, null, 2);
    return { stats, stringifiedStats };
  }
}
