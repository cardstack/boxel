import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { action } from '@ember/object';

export default class extends Component {
  <template>
    <button {{on "click" this.go}}>Go</button>
  </template>

  @action go() {
    alert('hi');
  }

}