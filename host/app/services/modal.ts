import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

type State =
  | {
      name: 'empty';
    }
  | {
      name: 'loaded';
    };

export default class Modal extends Service {
  @tracked state: State = { name: 'empty' };

  get isShowing(): boolean {
    return this.state.name === 'loaded';
  }

  @action open(): void {
    this.state = { name: 'loaded' };
  }

  @action close(): void {
    this.state = { name: 'empty' };
  }
}
