import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { action } from '@ember/object';
import monaco from '../modifiers/monaco';

export default class extends Component {
  <template>
    <button {{on "click" this.go}}>Go</button>
    <div {{monaco}} style="min-height: 100vh"></div>
  </template>

  @action 
  async go() {
    let handle = await showDirectoryPicker();
    navigator.serviceWorker.controller.postMessage({ handle });
  }

}