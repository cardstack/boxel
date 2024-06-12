import Route from '@ember/routing/route';
import { service } from '@ember/service';

import ENV from '@cardstack/host/config/environment';

import type CardService from '../services/card-service';

interface Model {
  isFastBoot: boolean;
}

export default class Application extends Route<Model> {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare cardService: CardService;

  async beforeModel(transition: any): Promise<void> {
    // Override the matrix URL for testing
    if (ENV.environment === 'test' || ENV.environment === 'development') {
      if (transition.to.queryParams.matrixURL) {
        ENV.matrixURL = transition.to.queryParams.matrixURL;
        console.log(
          'Matrix URL has been modified for testing to: ',
          ENV.matrixURL,
        );
      }
    }
  }

  async model(): Promise<Model> {
    let { isFastBoot } = this.fastboot;
    return { isFastBoot };
  }
}
