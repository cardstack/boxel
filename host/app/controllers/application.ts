import { tracked } from '@glimmer/tracking';
import Controller from '@ember/controller';
import { action } from '@ember/object';

export default class ApplicationController extends Controller {
  queryParams = ['file'];

  @tracked file: string | undefined;

  @action onSelectedFile(filename: string | undefined) {
    this.file = filename;
  }
}
