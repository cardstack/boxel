import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { RealmPaths } from '@cardstack/runtime-common';
import { directory, Entry } from '../resources/directory';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

interface Args {
  Args: {
    openDirs: string | undefined;
    polling: string | undefined;
    url: string;
    path: string | undefined;
  }
}

export default class Directory extends Component<Args> {
  <template>
    {{#each this.listing.entries key="path" as |entry|}}
      {{#let (getLocalPath @url entry.path this.realmPath) as |localPath|}}
        <div class="directory-level">
          {{#if (eq entry.kind 'file')}}
            <div role="button" {{on "click" (fn this.openFile entry)}} class="file {{if (eq localPath @path) "selected"}}">
              {{entry.name}}
            </div>
          {{else}}
            <div role="button" {{on "click" (fn this.toggleDirectory entry)}} class="directory {{if (isSelected localPath @path) "selected"}}">
              {{entry.name}}
            </div>
            {{#if (isOpen localPath @openDirs)}}
              <Directory
                @path={{@path}}
                @openDirs={{@openDirs}}
                @polling={{@polling}}
                @url="{{@url}}{{entry.path}}/"
              />
            {{/if}}
          {{/if}}
        </div>
      {{/let}}
    {{/each}}
  </template>


  listing = directory(this, () => this.args.url, () => this.args.openDirs, () => this.args.polling);
  @service declare router: RouterService;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  @cached
  get realmPath() {
    return new RealmPaths(this.cardService.defaultURL);
  }

  @action
  openFile(entry: Entry) {
    let path = getLocalPath(this.args.url, entry.path, this.realmPath);
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  toggleDirectory(entry: Entry) {
    let entryPath = getLocalPath(this.args.url, entry.path, this.realmPath);
    let openDirs = editOpenDirsQuery(entryPath, this.args.openDirs);
    this.router.transitionTo({ queryParams: { openDirs } });
  }
}

function editOpenDirsQuery(localPath: string, openDirs: string | undefined): string | undefined {
  let dirs = openDirs ? openDirs.split(',') : [];
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].startsWith(localPath)) {
      let localParts = localPath.split('/');
      localParts.pop();
      if (localParts.length) {
        dirs[i] = localParts.join('/');
      } else {
        dirs.splice(i, 1);
      }
      return dirs.length ? dirs.join(',') : undefined;
    } else if (localPath.startsWith(dirs[i])) {
      dirs[i] = localPath;
      return dirs.join(',');
    }
  }
  return [...dirs, localPath].join(',');
}

function isSelected(localPath: string, path: string | undefined) {
  return path?.startsWith(localPath);
}

function isOpen(path: string, openDirs: string | undefined) {
  return openDirs?.includes(path);
}

function getLocalPath(url: string, path: string, realmPath: RealmPaths) {
  return realmPath.local(new URL(url + path));
}
