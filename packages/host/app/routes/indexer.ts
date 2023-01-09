import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { Deferred } from '@cardstack/runtime-common/deferred';
import type IndexerService from '../services/indexer-service';

export default class Indexer extends Route {
  @service declare fastboot: {
    isFastBoot: boolean;
    deferRendering(deferred: Promise<void>): void;
  };
  @service declare indexerService: IndexerService;

  async model() {
    this.indexerService.indexRunDeferred = new Deferred<void>();
    this.fastboot.deferRendering(this.indexerService.indexRunDeferred.promise);
    return;
  }
}
