import Route from '@ember/routing/route';
import { service } from '@ember/service';

interface Model {
  isFastBoot: boolean;
}

export default class Application extends Route<Model> {
  @service declare fastboot: { isFastBoot: boolean };

  async model(): Promise<Model> {
    let { isFastBoot } = this.fastboot;
    return { isFastBoot };
  }
}
