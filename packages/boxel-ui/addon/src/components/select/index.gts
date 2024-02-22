import type { TemplateOnlyComponent } from '@ember/component/template-only';
import PowerSelect, {
  type PatchedPowerSelectArgs,
  BeforeOptions,
} from 'ember-power-select/components/power-select';

import cn from '../../helpers/cn.ts';

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type BasePowerSelectArgs = PartialBy<
  Pick<
    PatchedPowerSelectArgs,
    | 'searchField'
    | 'searchEnabled'
    | 'selected'
    | 'disabled'
    | 'placeholder'
    | 'onChange'
    | 'onBlur'
    | 'renderInPlace'
    | 'verticalPosition'
    | 'dropdownClass'
    | 'beforeOptionsComponent'
    | 'selectedItemComponent'
    | 'triggerComponent'
  >,
  'disabled' | 'renderInPlace'
>;

export interface BoxelSelectArgs<ItemT> extends BasePowerSelectArgs {
  options: ItemT[];
}

interface Signature<ItemT = any> {
  Args: BoxelSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT, string];
  };
  Element: HTMLDivElement;
}

const BoxelSelect: TemplateOnlyComponent<Signature> = <template>
  <PowerSelect
    class={{cn 'boxel-select' boxel-select--selected=@selected}}
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
    @triggerComponent={{@triggerComponent}}
    @disabled={{@disabled}}
    @matchTriggerWidth={{false}}
    @eventType='click'
    @searchEnabled={{@searchEnabled}}
    @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
    ...attributes
    as |item|
  >
    {{yield item 'boxel-select__item'}}
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
    .boxel-select__dropdown {
      --boxel-select-current-color: var(--boxel-light-100);
      --boxel-select-selected-color: var(--boxel-highlight);
      --boxel-select-below-transitioning-in-animation: drop-fade-below
        var(--boxel-transition);
      --boxel-select-below-transitioning-out-animation: var(
          --boxel-select-below-transitioning-in-animation
        )
        reverse;
      --boxel-select-above-transitioning-in-animation: drop-fade-above
        var(--boxel-transition);
      --boxel-select-above-transitioning-out-animation: var(
          --boxel-select-above-transitioning-in-animation
        )
        reverse;

      box-shadow: var(--boxel-box-shadow);
      border-radius: var(--boxel-form-control-border-radius);
    }

    .boxel-select__dropdown :deep(ul) {
      list-style: none;
      padding: 0;
      overflow: auto;
    }

    .boxel-select__dropdown
      :deep(.ember-power-select-option[aria-selected='true']) {
      background-color: var(--boxel-select-selected-color);
    }

    .boxel-select__dropdown
      :deep(.ember-power-select-option[aria-current='true']) {
      background-color: var(--boxel-select-current-color);
    }

    /* stylelint-disable-next-line max-line-length */
    .boxel-select__dropdown
      :deep(
        .ember-power-select-option:hover:not([aria-disabled='true']):not(
            .ember-power-select-option--no-matches-message
          )
      ) {
      cursor: pointer;
    }

    .boxel-select__dropdown :deep(.ember-power-select-search) {
      padding: 4px;
    }

    .boxel-select__dropdown :deep(.ember-power-select-search-input) {
      border: 1px solid #aaa;
      border-radius: 0;
      width: 100%;
      font-size: inherit;
      line-height: inherit;
      padding: 0 5px;
    }

    .boxel-select__dropdown :deep(.ember-power-select-search-input:focus) {
      border: 1px solid var(--boxel-outline-color);
      box-shadow: var(--boxel-box-shadow-hover);
      outline: var(--boxel-outline);
    }

    .boxel-select__dropdown
      :deep(.ember-power-select-option--no-matches-message) {
      padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
    }

    .boxel-select__item {
      font-weight: 600;
      font-size: var(--boxel-font-size-sm);
      padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
    }

    .boxel-select__dropdown.ember-basic-dropdown-content--below.ember-basic-dropdown--transitioning-in {
      animation: var(--boxel-select-below-transitioning-in-animation);
    }

    .boxel-select__dropdown.ember-basic-dropdown-content--below.ember-basic-dropdown--transitioning-out {
      animation: var(--boxel-select-below-transitioning-out-animation);
    }

    .boxel-select__dropdown.ember-basic-dropdown-content--above.ember-basic-dropdown--transitioning-in {
      animation: var(--boxel-select-above-transitioning-in-animation);
    }

    .boxel-select__dropdown.ember-basic-dropdown-content--above.ember-basic-dropdown--transitioning-out {
      animation: var(--boxel-select-above-transitioning-out-animation);
    }

    .boxel-select :deep(.ember-power-select-status-icon) {
      position: relative;
    }
    .boxel-select:after {
      display: none;
    }

    @keyframes drop-fade-below {
      0% {
        opacity: 0;
        transform: translateY(-20px);
      }

      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes drop-fade-above {
      0% {
        opacity: 0;
        transform: translateY(20px);
      }

      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }
  </style>
</template>;

export default BoxelSelect;
