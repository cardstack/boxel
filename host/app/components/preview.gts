import Component from '@glimmer/component';
import { importResource } from '../resources/import';
import { card } from '../resources/card';
import { Format, Card } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '../helpers/truth-helpers';
import { tracked } from '@glimmer/tracking';

const formats: Format[] = ['isolated', 'embedded', 'edit'];

export default class Preview extends Component<{ Args: { filename: string } }> {
  <template>
    {{#if this.error}}
      <h2>Encountered {{this.error.type}} error</h2>
      <pre>{{this.error.message}}</pre>
    {{else if this.cards}}
      <p>
        Cards:
        {{#each-in this.cards as |name card|}}
          <button {{on "click" (fn this.select name card)}}
            class="card-button {{if (eq this.selected.name name) 'selected'}}"
            disabled={{if (eq this.selected.name name) true false}}>
            {{name}}
          </button>
        {{/each-in}}
      </p>
      <div>
        {{#if this.selected}}
          <div>
            Format: 
            {{#each formats as |format|}}
              <button {{on "click" (fn this.setFormat format)}}
                class="format-button {{if (eq this.format format) 'selected'}}"
                disabled={{if (eq this.format format) true false}}>
                {{format}}
              </button>
            {{/each}}
          </div>
        {{/if}}
        <hr/>
        <div>
          {{#if this.card.component}}
            <this.card.component/>
          {{/if}}
        </div>
      </div>
    {{/if}}
  </template>

  @tracked
  selected: { name: string; card: typeof Card; } | undefined;
  @tracked
  format: Format = 'isolated';
  imported = importResource(this, () => new URL(this.args.filename, 'http://local-realm/'));
  card = card(this, () => this.selectedCard);

  get cards() {
    let cards = {} as { [exportName: string]: typeof Card };
    for (let [ exportName, value ] of Object.entries(this.imported.module ?? {})) {
      let maybeCard = value as typeof Card;
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

  get error() {
    return this.imported.error;
  }

  @action
  select(name: string, card: typeof Card) {
    this.selected = { name, card };
    this.card.setFormat(this.format);
  }

  @action
  setFormat(format: Format) {
    this.format = format;
    this.card.setFormat(format);
  }
}