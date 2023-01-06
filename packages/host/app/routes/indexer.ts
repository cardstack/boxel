import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { Deferred } from '@cardstack/runtime-common/deferred';
import type LoaderService from '../services/loader-service';
import type IndexerService from '../services/indexer-service';

interface ModelArgs {
  realmURL: string;
  url?: string;
  op?: 'update' | 'delete';
}
interface RouteInfoModelArgs {
  queryParams: ModelArgs;
}

export default class Indexer extends Route {
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
  @service declare fastboot: {
    isFastBoot: boolean;
    deferRendering(deferred: Promise<void>): void;
  };
  @service declare loaderService: LoaderService;
  @service declare indexerService: IndexerService;

  async model(args: ModelArgs | RouteInfoModelArgs) {
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
    this.indexerService.realmURL = realmURL;
    this.indexerService.updatedURL = url;
    this.indexerService.operation = operation;
    this.indexerService.indexRunDeferred = new Deferred<void>();
    this.fastboot.deferRendering(this.indexerService.indexRunDeferred.promise);

    return;
  }
}
