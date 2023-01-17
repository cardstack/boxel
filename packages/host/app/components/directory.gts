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

interface Args {
  Args: {
    polling: 'off' | undefined;
    url: string;
    directory: Entry;
    openDirs: string | undefined;
  }
}

function localPath(dirPath: string, path: string) {
  return `${dirPath}${path}`;
}

export default class Directory extends Component<Args> {
  <template>
    {{#if this.isOpen}}
      {{#each this.listing.entries as |entry|}}
        {{#if (eq entry.kind 'file')}}
          <File @entry={{entry}} @path={{localPath this.dirPath entry.path}} />
        {{else}}
          <div role="button" {{on "click" (fn this.toggleOpen entry)}} class="directory indent-{{entry.indent}}">
            {{entry.name}}
            <Directory @polling={{@polling}} @directory={{entry}} @url={{this.dirPath}} @openDirs={{@openDirs}} />
          </div>
        {{/if}}
      {{/each}}
    {{/if}}
  </template>

  listing = directory(this, () => this.dirPath, () => this.args.openDirs, () => this.args.polling);
  @service declare router: RouterService;

  get isOpen() {
    return true;
    // return this.args.openDirs === this.args.directory.path;
  }

  get dirPath() {
    let realmPaths = new RealmPaths(this.args.url);
    return realmPaths.directoryURL(this.args.directory.path).href;
  }

  @action
  toggleOpen(entry: Entry) {
    this.router.transitionTo({ queryParams: { openDirs: entry.path } });
  }
}
