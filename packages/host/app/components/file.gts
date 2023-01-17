import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Entry } from '../resources/directory';

interface Args {
  Args: {
    entry: Entry;
    url: string | undefined;
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
    if (!this.args.url) {
      return; // TODO
    }
    let path = this.args.url + this.args.entry.path;
    this.router.transitionTo({ queryParams: { path } });
  }
}
