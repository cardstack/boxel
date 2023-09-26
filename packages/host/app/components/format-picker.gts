import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import type { Format } from 'https://cardstack.com/base/card-api';

import { eq } from '../helpers/truth-helpers';

interface Signature {
  Args: {
    formats: Format[] | undefined;
    setFormat: (format: Format) => void;
    format?: Format;
  };
}

export default class FormatPicker extends Component<Signature> {
  <template>
    <div class='format-picker'>
      Format:
      {{#each @formats as |format|}}
        <button
          {{on 'click' (fn @setFormat format)}}
          type='button'
          class='format-button {{format}} {{if (eq @format format) "selected"}}'
          disabled={{eq @format format}}
          data-test-format-button={{format}}
        >
          {{format}}
        </button>
      {{/each}}
    </div>
    <style>
      .format-picker {
        margin-bottom: var(--boxel-sp);
      }
    </style>
  </template>
}
