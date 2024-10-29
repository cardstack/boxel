import type { TemplateOnlyComponent } from '@ember/component/template-only';
import PowerSelect, {
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';

import cn from '../../helpers/cn.ts';
import BoxelSelectTrigger from './trigger.gts';

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

const BoxelSelect: TemplateOnlyComponent<Signature> = <template>
  {{! template-lint-disable no-autofocus-attribute }}
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
    @dropdownClass={{cn 'boxel-select__dropdown' @dropdownClass}}
    {{! We can avoid providing arguments to the triggerComponent as long as they are specified here https://github.com/cibernox/ember-power-select/blob/913c85ec82d5c6aeb80a7a3b9d9c21ca9613e900/ember-power-select/src/components/power-select.hbs#L79-L106 }}
    {{! Even the custom BoxelTriggerWrapper will receive these arguments }}
    @triggerComponent={{(if
      @triggerComponent @triggerComponent (component BoxelSelectTrigger)
    )}}
    @disabled={{@disabled}}
    @matchTriggerWidth={{@matchTriggerWidth}}
    @eventType='click'
    @searchEnabled={{@searchEnabled}}
    @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
    ...attributes
    as |item|
  >
    {{yield item}}
  </PowerSelect>
  <style scoped>
    .boxel-select {
      position: relative;
      height: var(--boxel-select-height, var(--boxel-form-control-height));
      width: var(--boxel-select-width, 100%);
      max-width: 100%;
      border: var(--boxel-border);
      border-radius: var(--boxel-border-radius);
      overflow: hidden;
    }
    .boxel-select:not([aria-disabled='true']):hover {
      cursor: pointer;
    }
    .boxel-select.ember-power-select-trigger {
      padding: 0;
    }
  </style>
  {{! template-lint-disable require-scoped-style }}
  <style>
    .boxel-select__dropdown {
      box-shadow: var(--boxel-box-shadow);
      border: var(--boxel-border);
      border-radius: var(--boxel-form-control-border-radius);
    }
    .boxel-select__dropdown ul {
      list-style: none;
      padding: 0;
      overflow: auto;
    }
    .boxel-select__dropdown .ember-power-select-option {
      padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
    }
    .boxel-select__dropdown .ember-power-select-option[aria-selected='true'] {
      background-color: var(--boxel-100);
    }
    .boxel-select__dropdown .ember-power-select-option[aria-current='true'] {
      background-color: var(--boxel-100);
      color: black;
    }
    .boxel-select__dropdown .ember-power-select-search-input:focus {
      border: 1px solid var(--boxel-outline-color);
      box-shadow: var(--boxel-box-shadow-hover);
      outline: var(--boxel-outline);
    }
    .boxel-select__dropdown .ember-power-select-option--no-matches-message {
      padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
    }
    .boxel-select__dropdown.ember-power-select-dropdown.ember-basic-dropdown-content--below,
    .boxel-select__dropdown.ember-power-select-dropdown.ember-basic-dropdown-content--in-place {
      border-bottom: none;
    }
  </style>
</template>;

export default BoxelSelect;
