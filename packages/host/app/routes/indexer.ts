import Route from '@ember/routing/route';
import { service } from '@ember/service';

import { Deferred } from '@cardstack/runtime-common/deferred';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type RenderService from '../services/render-service';

export default class Indexer extends Route {
  @service declare fastboot: {
    isFastBoot: boolean;
    deferRendering(deferred: Promise<void>): void;
  };
  @service declare renderService: RenderService;
  @service declare realm: RealmService;
  @service declare cardService: CardService;

  async model(params: { id: string }) {
    if (params.id == null) {
      throw new Error(`no runner options id was specified`);
    }
    let optsId = parseInt(params.id);
    // we put this on the global since it needs to be accessible in the loader as well
    (globalThis as any).runnerOptsId = optsId;
    this.renderService.indexRunDeferred = new Deferred<void>();
    this.fastboot.deferRendering(this.renderService.indexRunDeferred.promise);

    // for (let url of this.cardService.realmURLs) {
    //   await this.realm.ensureRealmReady(url);
    // }

    return;
  }
}
