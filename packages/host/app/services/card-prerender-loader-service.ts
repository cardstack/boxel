import Service, { service } from '@ember/service';

import { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '../services/loader-service';

// This service exists in order to be mocked within test
export default class CardPrerenderLoaderService extends Service {
  @service declare loaderService: LoaderService;

  getLoader() {
    return Loader.cloneLoader(this.loaderService.loader);
  }
}
