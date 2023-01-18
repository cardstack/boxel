import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Entry } from '../resources/directory';
import { RealmPaths } from '@cardstack/runtime-common';

interface Args {
  Args: {
    entry: Entry;
    path: string;
    realmPath: RealmPaths;
  }
}

export default class File extends Component<Args> {
  <template>
      <div role="button" {{on "click" this.open}} class="file indent-{{@entry.indent}}">
        {{@entry.name}}
      </div>
  </template>

  @service declare router: RouterService;

  @action
  open() {
    let path = this.args.realmPath.local(new URL(this.args.path));
    this.router.transitionTo({ queryParams: { path } });
  }
}
