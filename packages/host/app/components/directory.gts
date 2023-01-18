import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { RealmPaths } from '@cardstack/runtime-common';
import { directory, Entry } from '../resources/directory';
import File from './file';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

interface Args {
  Args: {
    polling: 'off' | undefined;
    url: string;
    directory: Entry;
    openDirs: string | undefined;
    realmPath: RealmPaths;
  }
}

export default class Directory extends Component<Args> {
  <template>
    {{#if this.isOpen}}
      {{#each this.listing.entries as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <File @realmPath={{@realmPath}} @entry={{entry}} @path="{{this.dirPath}}{{entry.path}}" />
        {{else}}
          <div role="button" {{on "click" (fn this.toggleOpen entry)}} class="directory indent-{{entry.indent}}">
            {{entry.name}}
          </div>
          <Directory @realmPath={{@realmPath}} @polling={{@polling}} @directory={{entry}} @url={{this.dirPath}} @openDirs={{@openDirs}} />
        {{/if}}
      {{/each}}
    {{/if}}
  </template>

  listing = directory(this, () => this.dirPath, () => this.args.openDirs, () => this.args.polling);
  @service declare router: RouterService;

  get isOpen() {
    let directoryPath = this.args.realmPath.local(new URL(this.dirPath));
    return this.args.openDirs?.includes(directoryPath);
  }

  get dirPath() {
    let localPath = this.args.realmPath.local(new URL(this.args.url + this.args.directory.path));
    return this.args.realmPath.directoryURL(localPath).href;
  }

  @action
  toggleOpen(entry: Entry) {
    let localPath = this.args.realmPath.local(new URL(this.dirPath + entry.path));
    let openDirs = editOpenDirsQuery(localPath, entry.path, this.args.openDirs);
    this.router.transitionTo({ queryParams: { openDirs } });
  }
}

export function editDirectoryPath(dirPath: string, entryPath: string): string {
  let dirParts = dirPath.split('/');
  let i = dirParts.indexOf(entryPath);
  if (i === -1) {
    dirParts = [...dirParts, entryPath];
    return dirParts.join('/');
  } else {
    return dirParts.slice(0, i).join('/');
  }
}

export function editOpenDirsQuery(path: string, entryPath: string, openDirsQuery?: string) {
  if (!openDirsQuery) {
    return path;
  }
  let openDirs = openDirsQuery.includes(',') ? openDirsQuery.split(',') : [ openDirsQuery ];
  if (openDirs.length === 0) {
    return path;
  }
  if (!openDirsQuery.includes(path.split('/')[0])) {
    return [...openDirs, path].join(',');
  }
  let dirArr: string[] = [];
  for (let dirPath of openDirs) {
    if (path.startsWith(dirPath) || dirPath.startsWith(path)) {
      let editedPath = editDirectoryPath(dirPath, entryPath);
      if (editedPath.length) {
        dirArr.push(editedPath);
      }
    } else {
      dirArr.push(dirPath);
    }
  }
  return dirArr.length ? dirArr.join(',') : undefined;
}
