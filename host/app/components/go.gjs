import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';
import { service } from '@ember/service';

export default class extends Component {
  <template>
    {{#if this.localRealm.isAvailable}}
      You have a realm
    {{else if this.localRealm.isLoading }}
      ...
    {{else if this.localRealm.isEmpty}}
      <button {{on "click" this.openRealm}}>Open a local realm</button>
    {{/if}}
    <div {{monaco}} style="min-height: 100vh"></div>
  </template>

  @service localRealm;

  @action 
  openRealm() {
    this.localRealm.chooseDirectory();
  }

}