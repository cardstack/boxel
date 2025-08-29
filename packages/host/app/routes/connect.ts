import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type MatrixService from '@cardstack/host/services/matrix-service';

export default class Connect extends Route<void> {
  @service declare matrixService: MatrixService;

  async model() {
    await this.matrixService.ready;
    await this.matrixService.start();
  }
}
