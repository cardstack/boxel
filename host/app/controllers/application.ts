import { tracked } from '@glimmer/tracking';
import Controller from '@ember/controller';
import { action } from '@ember/object';

export default class ApplicationController extends Controller {
  queryParams = ['path'];

  @tracked path: string | undefined;

  @action onSelectedFile(path: string | undefined) {
    this.path = path;
  }
}
