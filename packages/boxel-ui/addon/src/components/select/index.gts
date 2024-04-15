import Component from '@glimmer/component';
import PowerSelect, {
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';

import cn from '../../helpers/cn.ts';

export interface BoxelSelectArgs<ItemT> extends PowerSelectArgs {
  options: ItemT[];
}

interface Signature<ItemT = any> {
  Args: BoxelSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

class BoxelSelect extends Component<Signature> {
  <template>
    <PowerSelect
      class='boxel-select'
      @options={{@options}}
      @searchField={{@searchField}}
      @selected={{@selected}}
      @selectedItemComponent={{@selectedItemComponent}}
      @placeholder={{@placeholder}}
      @onChange={{@onChange}}
      @onBlur={{@onBlur}}
      @renderInPlace={{@renderInPlace}}
      @verticalPosition={{@verticalPosition}}
      @dropdownClass={{cn '__GLIMMER_SCOPED_CSS_CLASS' @dropdownClass}}
      @triggerComponent={{@triggerComponent}}
      @disabled={{@disabled}}
      @matchTriggerWidth={{false}}
      @eventType='click'
      @searchEnabled={{@searchEnabled}}
      @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
      ...attributes
      as |item|
    >
      {{item}}
    </PowerSelect>
    <style>
      .boxel-select {
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        background: none;
        display: flex;
        gap: var(--boxel-sp-sm);
        padding-right: var(--boxel-sp);
      }
      .boxel-select :deep(.ember-power-select-status-icon) {
        position: relative;
      }
      .boxel-select:after {
        display: none;
      }
    </style>
    <style>
      .__GLIMMER_SCOPED_CSS_CLASS {
        --boxel-select-current-color: var(--boxel-select-current-color);
        --boxel-select-selected-color: var(--boxel-select-selected-color);
      }

      .__GLIMMER_SCOPED_CSS_CLASS ul {
        color: var(--boxel-select-current-color);
        list-style: none;
        padding: 0;
        overflow: auto;
      }

      .__GLIMMER_SCOPED_CSS_CLASS
        .ember-power-select-option[aria-selected='true'] {
        background-color: var(--boxel-select-selected-color);
      }

      .__GLIMMER_SCOPED_CSS_CLASS
        .ember-power-select-option[aria-current='true'] {
        background-color: var(--boxel-select-selected-color);
      }
    </style>
  </template>
}

export default BoxelSelect;
