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

  get openDirs() {
    if (!this.args.openDirs) {
      return [];
    }
    return this.args.openDirs.includes(',') ? this.args.openDirs.split(',') : [ this.args.openDirs ];
  }

  @action
  toggleOpen(entry: Entry) {
    let queryPath: string | undefined;
    let localPath = this.args.realmPath.local(new URL(this.dirPath + entry.path));
    if (!this.args.openDirs || this.openDirs.length === 0) {
      queryPath = localPath;
    } else {
      let dirArr: string[] = [];
      for (let dirPath of this.openDirs) {
        if (localPath.startsWith(dirPath) || dirPath.startsWith(localPath)) {
          let dirParts = dirPath.split('/');
          let i = dirParts.indexOf(entry.path);
          if (i === -1) {
            dirParts = [...dirParts, entry.path];
            dirArr.push(dirParts.join('/'));
          } else {
            dirPath = dirParts.slice(0, i).join('/');
            if (dirPath.length > 0) {
              dirArr.push(dirPath);
            }
          }
        } else {
          dirArr.push(dirPath);
        }
      }
      queryPath = dirArr.length ? dirArr.join(',') : undefined;
    }
    this.router.transitionTo({ queryParams: { openDirs: queryPath } });
  }
}
