import Controller from '@ember/controller';
import { Model } from '../routes/code';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import type CodeService from '@cardstack/host/services/code-service';
import { RealmPaths } from '@cardstack/runtime-common';
import ENV from '@cardstack/host/config/environment';

const { ownRealmURL } = ENV;
export default class CodeController extends Controller {
  queryParams = ['path', 'openDirs'];

  @tracked path: string | undefined;
  @tracked openDirs: string | undefined;

  @service declare codeService: CodeService;

  declare model: Model;

  get codeParams() {
    return new OpenFiles(this);
  }

  get resourceURL() {
    if (this.path) {
      return new RealmPaths(ownRealmURL).fileURL(this.path).href;
    }
    return;
  }

  openFile(newPath: string | undefined) {
    this.path = newPath;
  }
}

export class OpenFiles {
  constructor(private controller: CodeController) {}
  get path(): string | undefined {
    return this.controller.path;
  }
  set path(newPath: string | undefined) {
    this.controller.openFile(newPath);
  }
  get openDirs(): string[] {
    return this.controller.openDirs ? this.controller.openDirs.split(',') : [];
  }
  toggleOpenDir(entryPath: string): void {
    let dirs = this.openDirs.slice();
    for (let i = 0; i < dirs.length; i++) {
      if (dirs[i].startsWith(entryPath)) {
        let localParts = entryPath.split('/').filter((p) => p.trim() != '');
        localParts.pop();
        if (localParts.length) {
          dirs[i] = localParts.join('/') + '/';
        } else {
          dirs.splice(i, 1);
        }
        this.controller.openDirs = dirs.join(',');
        return;
      } else if (entryPath.startsWith(dirs[i])) {
        dirs[i] = entryPath;
        this.controller.openDirs = dirs.join(',');
        return;
      }
    }
    this.controller.openDirs = [...dirs, entryPath].join(',');
  }
}
