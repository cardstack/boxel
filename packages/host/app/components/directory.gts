import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import type CardService from '../services/card-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { RealmPaths } from '@cardstack/runtime-common';
import { directory, Entry } from '../resources/directory';
import File from './file';
import ClosedDirectory from './closed-directory';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

interface Args {
  Args: {
    directory?: Entry;
    openDirs: string;
    polling: 'off' | undefined;
    url: string;
    path: string | undefined;
  }
}

export default class Directory extends Component<Args> {
  <template>
    {{#each this.listing.entries as |entry|}}
      {{#let (getLocalPath @url entry.path this.realmPath) as |localPath|}}
        {{#if (eq entry.kind 'file')}}
          <File
            @entry={{entry}}
            @onOpen={{this.openFile}}
            @localPath={{localPath}}
            @path={{@path}}
          />
        {{else}}
          <ClosedDirectory @entry={{entry}} @onOpen={{this.openDirectory}} />
          {{#if (isOpen localPath @openDirs)}}
            <Directory
              @directory={{entry}}
              @path={{@path}}
              @openDirs={{@openDirs}}
              @polling={{@polling}}
              @url="{{@url}}{{entry.path}}/"
            />
          {{/if}}
        {{/if}}
      {{/let}}
    {{/each}}
  </template>


  listing = directory(this, () => this.args.url, () => this.args.openDirs, () => 'off');
  @service declare router: RouterService;
  @service declare cardService: CardService;

  @cached
  get realmPath() {
    return new RealmPaths(this.cardService.defaultURL.href);
  }

  @action
  openFile(entry: Entry) {
    let path = getLocalPath(this.args.url, entry.path, this.realmPath);
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  closeDirectory() {
    let localPath = this.realmPath.local(new URL(this.args.url));
    let openDirs = removeDirFromQuery(localPath, this.args.openDirs);
    this.router.transitionTo({ queryParams: { openDirs } });
  }

  @action
  openDirectory(entry: Entry) {
    let entryPath = getLocalPath(this.args.url, entry.path, this.realmPath);
    let openDirs = addDirToQuery(entryPath, this.args.openDirs);
    this.router.transitionTo({ queryParams: { openDirs } });
  }
}

function addDirToQuery(localPath: string, openDirs: string): string {
  let dirs = openDirs.split(',');
  for (let i = 0; i < dirs.length; i++) {
    if (localPath.startsWith(dirs[i])) {
      dirs[i] = localPath;
      return dirs.join(',');
    }
  }
  return [...dirs, localPath].join(',');
}

function removeDirFromQuery(localPath: string, openDirs: string): string | undefined {
  let dirs = openDirs.split(',')
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].startsWith(localPath)) {
      let localParts = localPath.split('/');
      localParts.pop();
      if (localParts.length) {
        dirs[i] = localParts.join('/');
      } else {
        dirs.splice(i, 1);
      }
    }
  }
  return dirs.length ? dirs.join(',') : undefined;
}

function isSelected(dir: string, path: string | undefined) {
  return path?.includes(dir);
}

function isOpen(path: string, openDirs: string) {
  return openDirs.includes(path);
}

function getLocalPath(url: string, path: string, realmPath: RealmPaths) {
  return realmPath.local(new URL(url + path));
}
