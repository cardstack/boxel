import Route from "@ember/routing/route";
import { service } from "@ember/service";
import type LogService from '../services/log';

interface Model {
  isFastBoot: boolean;
}

export default class Application extends Route<Model> {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare log: LogService;

  beforeModel() {
    console.log(`Log level: ${this.log.log.getLevel()}`);
  }

  async model(): Promise<Model> {
    let { isFastBoot } = this.fastboot;
    return { isFastBoot };
  }
}
