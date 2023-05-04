import Route from '@ember/routing/route';
import { service } from '@ember/service';
import type MatrixService from '../services/matrix-service';

export default class ChatRoute extends Route<void> {
  @service declare matrixService: MatrixService;

  async model() {
    await this.matrixService.start();
  }
}
