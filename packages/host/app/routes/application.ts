import Route from '@ember/routing/route';

import ENV from '@cardstack/host/config/environment';

interface Model {}

export default class Application extends Route<Model> {
  async beforeModel(transition: any): Promise<void> {
    // Override the matrix URL for testing
    if (ENV.environment === 'test' || ENV.environment === 'development') {
      if (transition.to?.queryParams.matrixURL) {
        ENV.matrixURL = transition.to.queryParams.matrixURL;
        console.log(
          'Matrix URL has been modified for testing to: ',
          ENV.matrixURL,
        );
      }
    }
  }

  // TODO is this necessary?
  async model(): Promise<Model> {
    return {};
  }
}
