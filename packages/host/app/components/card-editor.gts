import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import FormatPicker from './format-picker';
import Preview from './preview';

import type CardService from '../services/card-service';

interface Signature {
  Args: {
    card: CardDef;
    format?: Format;
    onCancel?: () => void;
    onSave?: (card: CardDef) => void;
  };
}

const formats: Format[] = ['isolated', 'embedded', 'edit'];

export default class CardEditor extends Component<Signature> {
  <template>
    <FormatPicker
      @formats={{this.formats}}
      @format={{this.format}}
      @setFormat={{this.setFormat}}
    />
    <Preview @format={{this.format}} @card={{@card}} />
    <div class='buttons'>
      {{! @glint-ignore glint doesn't know about EC task properties }}
      {{#if this.write.last.isRunning}}
        <span data-test-saving>Saving...</span>
      {{else}}
        {{#if @onCancel}}
          <Button
            data-test-cancel-create
            {{on 'click' @onCancel}}
            @size='tall'
          >Cancel</Button>
        {{/if}}
        <Button
          data-test-save-card
          {{on 'click' this.save}}
          @kind='primary'
          @size='tall'
        >Save</Button>
      {{/if}}
    </div>
    <style>
      .buttons {
        margin-top: var(--boxel-sp);
        text-align: right;
      }
    </style>
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
    this.write.perform();
  }

  private write = restartableTask(async () => {
    await this.cardService.saveModel(this.args.card);
    this.args.onSave?.(this.args.card);
    this.format = 'isolated';
  });
}
