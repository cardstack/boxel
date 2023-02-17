import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory, Entry } from '../resources/directory';
import { concat } from '@ember/helper';

interface Args {
  Args: {
    openDirs: string[];
    realmURL: string;
    relativePath: string;
    openFile: string | undefined;
  }
}

export default class Directory extends Component<Args> {
  <template>
    {{#each this.listing.entries key="path" as |entry|}}
      <div class="directory-level">
        {{#if (eq entry.kind 'file')}}
          <div role="button" {{on "click" (fn this.openFile entry)}} class="file {{if (eq @relativePath @openFile) "selected"}}">
            {{entry.name}}
          </div>
        {{else}}
          <div role="button" {{on "click" (fn this.toggleDirectory entry)}} class="directory {{if (isSelected @relativePath @openFile) "selected"}}">
            {{entry.name}}
          </div>
          {{#if (isOpen (concat @relativePath entry.name) @openDirs)}}
            <Directory
              @openFile={{@openFile}}
              @openDirs={{@openDirs}}
              @relativePath="{{@relativePath}}{{entry.name}}"
              @realmURL={{@realmURL}}
            />
          {{/if}}
        {{/if}}
      </div>
    {{/each}}
  </template>


  listing = directory(this, () => this.args.relativePath, () => this.args.realmURL);
  @service declare router: RouterService;

  @action
  openFile(entry: Entry) {
    let path = this.args.relativePath +  entry.name;
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  toggleDirectory(entry: Entry) {
    let entryPath = this.args.relativePath + entry.name;
    let openDirs = editOpenDirsQuery(entryPath, this.args.openDirs);
    this.router.transitionTo({ queryParams: { openDirs: openDirs.length ? openDirs.join(',') : undefined } });
  }
}

function editOpenDirsQuery(localPath: string, openDirs: string[]): string[] {
  let dirs = openDirs.slice();
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].startsWith(localPath)) {
      let localParts = localPath.split('/');
      localParts.pop();
      if (localParts.length) {
        dirs[i] = localParts.join('/');
      } else {
        dirs.splice(i, 1);
      }
      return dirs;
    } else if (localPath.startsWith(dirs[i])) {
      dirs[i] = localPath;
      return dirs;
    }
  }
  return [...dirs, localPath];
}

function isSelected(localPath: string, openFile: string | undefined) {
  return openFile?.startsWith(localPath);
}

function isOpen(path: string, openDirs: string[]) {
  return openDirs.find(item => item.startsWith(path));
}
