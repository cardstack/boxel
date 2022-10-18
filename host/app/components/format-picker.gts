import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '../helpers/truth-helpers';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import type { Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    formats: Format[] | undefined;
    selectedFormat?: Format;
    setFormat?: (format: Format) => void;
  }
}

export default class FormatPicker extends Component<Signature> {
  <template>
    <div>
      Format:
      {{#each @formats as |format|}}
        <button {{on "click" (fn this.setFormat format)}}
          type="button"
          class="format-button {{format}} {{if (eq this.format format) "selected"}}"
          disabled={{if (eq this.format format) true false}}
          data-test-format-button={{format}}
        >
          {{format}}
        </button>
      {{/each}}
    </div>
  </template>

  @tracked format: Format = this.args.selectedFormat ?? 'isolated';

  @action
  setFormat(format: Format) {
    this.format = format;
    this.args.setFormat?.(format);
  }
};
