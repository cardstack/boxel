import Component from '@glimmer/component';

export default class Sample extends Component {
  <template>{{this.message}}</template>

  get message() {
    throw new Error('boom');
    return 'hello'
  }
}