import Component from '@glimmer/component';
import { render } from '../resources/rendered-card';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
import { Card, CardJSON, Format } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '../helpers/truth-helpers';

interface Signature {
  Args: {
    module: Record<string, typeof Card>;
    json: CardJSON;
  }
}

const formats: Format[] = ['isolated', 'embedded', 'edit' ];

export default class Preview extends Component<Signature> {
  <template>
    <div>
      Format: 
      {{#each formats as |format|}}
        <button {{on "click" (fn this.setFormat format)}}
          class="format-button {{format}} {{if (eq this.format format) 'selected'}}"
          disabled={{if (eq this.format format) true false}}>
          {{format}}
        </button>
      {{/each}}
    </div>

    {{#if this.rendered.component}}
      <this.rendered.component/>
    {{/if}}
  </template>

  @tracked
  format: Format = 'isolated';
  rendered = render(this, () => this.card, () => this.format)

  @cached
  get card() {
    let cardClass = this.args.module[this.args.json.data.meta.adoptsFrom.name];
    return cardClass.fromSerialized(this.args.json.data.attributes ?? {});
  }

  @action
  setFormat(format: Format) {
    this.format = format;
  }
}