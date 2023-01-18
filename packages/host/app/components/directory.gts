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
    let dirs = this.args.openDirs ? this.args.openDirs.split('/'): [];
    let i = dirs.indexOf(entry.path);
    if (dirs.length && i !== -1) {
      dirs = dirs.slice(0, i);
      let openDirs = dirs.length ? dirs.join('/') : undefined;
      return this.router.transitionTo({ queryParams: { openDirs } });
    }
    let openDirs = this.args.realmPath.local(new URL(this.dirPath + entry.path));
    return this.router.transitionTo({ queryParams: { openDirs } });
  }
}
