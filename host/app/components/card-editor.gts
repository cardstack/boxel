import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import CardService from '../services/card-service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import FormatPicker from './format-picker';
import Preview from './preview';

interface Signature {
  Args: {
    card: Card;
    format?: Format;
    onCancel?: () => void;
    onSave?: (card: Card) => void;
  }
}

const formats: Format[] = ['isolated', 'embedded', 'edit'];

export default class CardEditor extends Component<Signature> {
  <template>
    <FormatPicker
      @formats={{this.formats}}
      @format={{this.format}}
      @setFormat={{this.setFormat}}
    />
    <Preview
      @format={{this.format}}
      @card={{@card}}
    />
    {{!-- @glint-ignore glint doesn't know about EC task properties --}}
    {{#if this.write.last.isRunning}}
      <span data-test-saving>Saving...</span>
    {{else}}
      <div>
        <button data-test-save-card {{on "click" this.save}} type="button">Save</button>
        {{#if @onCancel}}
          <button data-test-cancel-create {{on "click" @onCancel}} type="button">Cancel</button>
        {{/if}}
      </div>
    {{/if}}
  </template>

  formats = formats;
  @service declare cardService: CardService;
  @tracked format: Format = this.args.format ?? 'edit';

  @action
  setFormat(format: Format) {
    this.format = format;
  }

  @action
  save() {
    taskFor(this.write).perform();
  }

  @restartableTask private async write(): Promise<void> {
     let card = await this.cardService.saveCard(this.args.card);
    this.args.onSave?.(card);
  }
}
