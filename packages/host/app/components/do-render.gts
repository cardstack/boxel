import Component from '@glimmer/component';
import Modifier from 'ember-modifier';
import { getOwner } from '@ember/application';

import Sample from './sample';
import { tracked } from '@glimmer/tracking';
import { render } from '../lib/isolated-render';

class DoTheRender extends Modifier {
  modify(element) {
    render(Sample, element, getOwner(this)!);
  }
}

export default class DoRender extends Component {
  <template>
    <div {{DoTheRender}}></div>
    {{this.counter}}
  </template>

  @tracked
  counter = 0;

  constructor(...args) {
    super(...args);
    setInterval(() => this.counter++, 1000);
  }
}