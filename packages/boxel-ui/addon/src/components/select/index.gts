import type { TemplateOnlyComponent } from '@ember/component/template-only';
import PowerSelect, {
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';

import cn from '../../helpers/cn.ts';
import { BoxelSelectDefaultTrigger } from './trigger.gts';

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
    @dropdownClass={{cn
      'boxel-select__dropdown'
      @dropdownClass
      matches-trigger=@matchTriggerWidth
    }}
    @loadingMessage={{@loadingMessage}}
    {{! We can avoid providing arguments to the triggerComponent as long as they are specified here https://github.com/cibernox/ember-power-select/blob/913c85ec82d5c6aeb80a7a3b9d9c21ca9613e900/ember-power-select/src/components/power-select.hbs#L79-L106 }}
    {{! Even the custom BoxelTriggerWrapper will receive these arguments }}
    @triggerComponent={{(if
      @triggerComponent @triggerComponent (component BoxelSelectDefaultTrigger)
    )}}
    @disabled={{@disabled}}
    @matchTriggerWidth={{@matchTriggerWidth}}
    @eventType='click'
    @searchEnabled={{@searchEnabled}}
    @beforeOptionsComponent={{if
      @beforeOptionsComponent
      @beforeOptionsComponent
      (component BeforeOptions autofocus=false)
    }}
    @afterOptionsComponent={{@afterOptionsComponent}}
    ...attributes
    as |item|
  >
    {{yield item}}
  </PowerSelect>

  <style scoped>
    .boxel-select {
      position: relative;
      display: flex;
      align-items: stretch;
      border: 1px solid var(--boxel-border-color);
      border-radius: var(--boxel-border-radius-sm);
      padding: 0;
      max-width: 100%;
      width: 100%;
      min-height: var(--boxel-form-control-height);
      font: var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      outline-color: var(--boxel-highlight);
      overflow: hidden;
    }
    .boxel-select:not([aria-disabled='true']):hover {
      cursor: pointer;
    }
  </style>
  {{! template-lint-disable require-scoped-style }}
  <style>
    .boxel-select__dropdown {
      box-shadow: var(--boxel-box-shadow);
      border: var(--boxel-border);
      border-radius: var(--boxel-form-control-border-radius);
      z-index: var(
        --boxel-layer-modal-urgent
      ); /* TODO: Investigate why this is needed */
    }
    .boxel-select__dropdown .ember-power-select-option {
      padding: var(--boxel-sp-xs);
      background-color: var(--boxel-light);
      color: var(--boxel-dark);
      font: var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      transition: background-color var(--boxel-transition);
    }
    .boxel-select__dropdown .ember-power-select-option[aria-selected='true'] {
      background-color: var(--boxel-highlight);
    }
    .boxel-select__dropdown
      .ember-power-select-option[aria-selected='true'][aria-current='true'] {
      background-color: var(--boxel-highlight-hover);
    }
    .boxel-select__dropdown .ember-power-select-option[aria-current='true'] {
      background-color: var(--boxel-100);
    }
    .boxel-select__dropdown.ember-basic-dropdown-content--below {
      border-bottom: var(--boxel-border);
    }
    .boxel-select__dropdown.ember-basic-dropdown-content--above {
      border-top: var(--boxel-border);
    }
    .boxel-select__dropdown:not(.matches-trigger) {
      border: var(--boxel-border);
      border-radius: var(--boxel-form-control-border-radius);
    }
    .boxel-select__dropdown .ember-power-select-option--no-matches-message {
      cursor: initial;
    }

    .boxel-select__dropdown .ember-power-select-search-input {
      height: var(--boxel-form-control-height);
      border-radius: var(--boxel-form-control-border-radius);
    }
    .boxel-select__dropdown
      .ember-power-select-search-input:not(:disabled):focus {
      outline-color: var(--boxel-highlight);
    }
  </style>
</template>;

export default BoxelSelect;
