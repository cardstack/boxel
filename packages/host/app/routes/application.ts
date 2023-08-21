import Route from '@ember/routing/route';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';

interface Model {
  isFastBoot: boolean;
}

export default class Application extends Route<Model> {
  @service declare fastboot: { isFastBoot: boolean };

  async beforeModel(transition: any): Promise<void> {
    if (transition.to.queryParams.playWrightTestMode == 'true') {
      let modifiedMatrixURL = transition.to.queryParams.matrixURL;
      // Override the environment variable with the query parameter value
      ENV.matrixURL = modifiedMatrixURL;
      console.log(
        'Matrix URL has been modified for testing to: ',
        ENV.matrixURL,
      );
    }
  }

  async model(): Promise<Model> {
    let { isFastBoot } = this.fastboot;
    return { isFastBoot };
  }
}
