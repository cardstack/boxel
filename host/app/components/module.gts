import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { getCardRefsForModule } from '../resources/card-refs';
import Schema from './schema';

interface Signature {
  Args: {
    url: string;
  }
}

export default class Module extends Component<Signature> {
  <template>
    {{#each this.cardRefs.refs as |ref|}}
      <Schema @ref={{ref}} />
    {{/each}}
    {{#if this.cardRefs.refs}}
      <footer>
        <br>
        <button type="button" {{on "click" this.removeModule}}>Delete</button>
      </footer>
    {{/if}}
  </template>

  cardRefs = getCardRefsForModule(this, () => this.args.url);

  @action
  async removeModule() {
    if (!this.cardRefs.refs) {
      return;
    }
    await taskFor(this.remove).perform(this.args.url);
  }

  @restartableTask private async remove(url: string): Promise<void> {
    let response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/vnd.card+source'
      },
    });

    if (!response.ok) {
      throw new Error(`could not delete file, status: ${response.status} - ${response.statusText}. ${await response.text()}`);
    }
  }
}
