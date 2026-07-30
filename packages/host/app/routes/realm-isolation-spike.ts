import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type MatrixService from '@cardstack/host/services/matrix-service';

export default class RealmIsolationSpikeRoute extends Route {
  @service declare private matrixService: MatrixService;

  async beforeModel() {
    await this.matrixService.ready;
    await this.matrixService.start();
  }
}
