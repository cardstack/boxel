import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class CardController extends Controller {
  queryParams = ['operatorModeState', 'operatorModeEnabled'];

  @tracked operatorModeEnabled = false;
  @tracked operatorModeState: string | null = null;
}
