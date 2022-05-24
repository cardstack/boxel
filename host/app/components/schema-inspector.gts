import Component from '@glimmer/component';
import { Card } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '../helpers/truth-helpers';
import isObject from 'lodash/isObject';
import { tracked } from '@glimmer/tracking';

export default class SchemaInspector extends Component<{ Args: { module: Record<string, any> } }> {
  <template>
    <p class="card-chooser">
      Cards:
      {{#each-in this.cards as |name card|}}
        <button {{on "click" (fn this.select name card)}}
          class="card-button {{if (eq this.selected.name name) 'selected'}}"
          data-test-card-name={{name}}
          disabled={{if (eq this.selected.name name) true false}}>
          {{name}}
        </button>
      {{/each-in}}
    </p>
    <h2 class="selected-card">Selected: {{this.selected.name}}</h2>
    {{! TODO Render the card schema of the selected card }}
  </template>

  @tracked
  selected: { name: string; card: typeof Card; } | undefined;

  get cards() {
    let cards = {} as { [exportName: string]: typeof Card };
    for (let [ exportName, value ] of Object.entries(this.args.module)) {
      let maybeCard = value as typeof Card;
      if (!isObject(maybeCard)) {
        continue;
      }
      if ('baseCard' in maybeCard) {
        cards[exportName] = maybeCard;
      }
    }
    return cards;
  }

  get selectedName() {
    return this.selected?.name ?? 'none';
  }

  get selectedCard() {
    return this.selected?.card;
  }

  @action
  select(name: string, card: typeof Card) {
    this.selected = { name, card };
  }
}