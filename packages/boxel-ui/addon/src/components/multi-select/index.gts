import type { TemplateOnlyComponent } from '@ember/component/template-only';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import { type PowerSelectArgs } from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';

import cn from '../../helpers/cn.ts';

export interface BoxelMultiSelectArgs<ItemT> extends PowerSelectArgs {
  options: ItemT[];
  selected: ItemT[];
}

interface Signature<ItemT = any> {
  Args: BoxelMultiSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

const BoxelMultiSelect: TemplateOnlyComponent<Signature> = <template>
  <PowerSelectMultiple
    class='boxel-multi-select'
    @options={{@options}}
    @searchField={{@searchField}}
    @selected={{@selected}}
    @selectedItemComponent={{@selectedItemComponent}}
    @placeholder={{@placeholder}}
    @onChange={{@onChange}}
    @onBlur={{@onBlur}}
    @renderInPlace={{@renderInPlace}}
    @verticalPosition={{@verticalPosition}}
    @dropdownClass={{cn 'boxel-multi-select__dropdown' @dropdownClass}}
    @triggerComponent={{@triggerComponent}}
    @disabled={{@disabled}}
    @matchTriggerWidth={{@matchTriggerWidth}}
    @eventType='click'
    @searchEnabled={{@searchEnabled}}
    @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
    ...attributes
    as |option|
  >
    {{yield option}}
  </PowerSelectMultiple>

  <style>
    .boxel-multi-select {
      border: 1px solid var(--boxel-form-control-border-color);
      border-radius: var(--boxel-form-control-border-radius);
      background: none;
      display: flex;
      gap: var(--boxel-sp-sm);
    }

    .boxel-multi-select:after {
      display: none;
    }
  </style>
  <style>
    :global(.boxel-multi-select__dropdown) {
      --boxel-select-current-color: var(--boxel-highlight);
      --boxel-select-selected-color: var(--boxel-light-100);
      box-shadow: var(--boxel-box-shadow);
      border-radius: var(--boxel-form-control-border-radius);
    }
    :global(.boxel-multi-select__dropdown ul) {
      list-style: none;
      padding: 0;
      overflow: auto;
    }
    :global(.boxel-multi-select li) {
      display: flex;
      align-items: center;
    }
    :global(
        .boxel-multi-select__dropdown
          .ember-power-select-option[aria-selected='true']
      ) {
      background-color: var(--boxel-select-selected-color);
    }

    :global(
        .boxel-multi-select__dropdown
          .ember-power-select-option[aria-current='true']
      ) {
      background-color: var(--boxel-select-current-color);
      color: black;
    }

    :global(
        .boxel-multi-select__dropdown .ember-power-select-search-input:focus
      ) {
      border: 1px solid var(--boxel-outline-color);
      box-shadow: var(--boxel-box-shadow-hover);
      outline: var(--boxel-outline);
    }

    :global(
        .boxel-multi-select__dropdown
          .ember-power-select-option--no-matches-message
      ) {
      padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
    }
  </style>
</template>;

export default BoxelMultiSelect;
