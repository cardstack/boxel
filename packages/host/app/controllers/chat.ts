import Controller from '@ember/controller';
import { service } from '@ember/service';
import type MatrixService from '../services/matrix-service';

export default class ChatController extends Controller {
  @service declare matrixService: MatrixService;

  get isLoggedIn() {
    return this.matrixService.isLoggedIn;
  }
}
