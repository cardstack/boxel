import Route from '@ember/routing/route';
import { service } from '@ember/service';

import {
  default as MonacoService,
  MonacoSDK,
} from '../services/monaco-service';

export interface Model {
  isFastBoot: boolean;
  monaco: MonacoSDK;
}

export default class Code extends Route<Model> {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare monacoService: MonacoService;

  async model(_args: unknown): Promise<Model> {
    let { isFastBoot } = this.fastboot;

    // By readying the monaco service, you dynamically load the sdk
    let monaco = await this.monacoService.getMonacoContext();
    return { isFastBoot, monaco };
  }
}
