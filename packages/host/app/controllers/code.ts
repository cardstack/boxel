import Controller from '@ember/controller';
import { Model } from '../routes/code';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import type CodeService from '@cardstack/host/services/code-service';

export default class CodeController extends Controller {
  queryParams = ['openFile', 'openDirs'];

  @tracked openFile: string | undefined;
  @tracked openDirs: string | undefined;

  @service declare codeService: CodeService;

  declare model: Model;

  openPath(newPath: string | undefined) {
    this.openFile = newPath;
  }
}
