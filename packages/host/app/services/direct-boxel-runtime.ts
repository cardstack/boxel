import Service, { service } from '@ember/service';

import DirectBoxelRuntime from '../lib/direct-boxel-runtime';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type NetworkService from './network';

export default class DirectBoxelRuntimeService extends Service {
  @service declare private cardService: CardService;
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;

  runtime = new DirectBoxelRuntime(
    () => this.cardService.getAPI(),
    () => this.loaderService.loader,
    (url) => this.network.virtualNetwork.unresolveURL(url),
  );
}

declare module '@ember/service' {
  interface Registry {
    'direct-boxel-runtime': DirectBoxelRuntimeService;
  }
}
