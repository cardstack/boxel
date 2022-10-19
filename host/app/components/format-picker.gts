import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '../helpers/truth-helpers';
import type { Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    formats: Format[] | undefined;
    setFormat: (format: Format) => void;
    format?: Format;
  }
}

export default class FormatPicker extends Component<Signature> {
  <template>
    <div>
      Format:
      {{#each @formats as |format|}}
        <button {{on "click" (fn @setFormat format)}}
          type="button"
          class="format-button {{format}} {{if (eq @format format) "selected"}}"
          disabled={{eq @format format}}
          data-test-format-button={{format}}
        >
          {{format}}
        </button>
      {{/each}}
    </div>
  </template>
};
