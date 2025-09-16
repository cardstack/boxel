import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type MatrixService from '@cardstack/host/services/matrix-service';

export default class Connect extends Route<string> {
  @service declare matrixService: MatrixService;

  async model(params: { origin: string }) {
    await this.matrixService.ready;
    await this.matrixService.start();

    return decodeURIComponent(params.origin);
  }
}
