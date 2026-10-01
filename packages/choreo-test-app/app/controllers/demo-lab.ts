import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class DemoLabController extends Controller {
  queryParams = ['embedded'];
  @tracked embedded = false;
}
