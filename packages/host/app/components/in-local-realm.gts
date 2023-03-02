import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
//@ts-ignore glint does not think this is consumed but it is consumed
import { hash } from '@ember/helper';
import type RouterService from '@ember/routing/router-service';
import type LocalRealm from '../services/local-realm';

interface Signature {
  Blocks: { default: [string] };
}

export default class InLocalRealm extends Component<Signature> {
  <template>
    {{#if this.localRealm.isAvailable}}
      <button {{on 'click' this.closeRealm}} type='button'>Close local realm</button>
      {{yield this.localRealm.url.href}}
    {{else if this.localRealm.isLoading}}
      ...
    {{else if this.localRealm.isEmpty}}
      <button {{on 'click' this.openRealm}}>Open a local realm</button>
    {{/if}}
  </template>

  @service declare router: RouterService;
  @service declare localRealm: LocalRealm;

  @action
  openRealm() {
    this.localRealm.chooseDirectory(() => this.router.refresh());
  }

  @action
  closeRealm() {
    if (this.localRealm.isAvailable) {
      this.localRealm.close();
      this.router.transitionTo({ queryParams: { path: undefined } });
    }
  }
}
