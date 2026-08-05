import Service, { service } from '@ember/service';

import DirectBoxelRuntime from '../lib/direct-boxel-runtime';

import type CardService from './card-service';
import type LoaderService from './loader-service';

export default class DirectBoxelRuntimeService extends Service {
  @service declare private cardService: CardService;
  @service declare private loaderService: LoaderService;

  runtime = new DirectBoxelRuntime(
    () => this.cardService.getAPI(),
    () => this.loaderService.loader,
  );
}

declare module '@ember/service' {
  interface Registry {
    'direct-boxel-runtime': DirectBoxelRuntimeService;
  }
}
