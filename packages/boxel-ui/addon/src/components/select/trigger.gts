import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type { Select } from 'ember-power-select/components/power-select';
import ChevronDown from '@cardstack/boxel-icons/chevron-down';
import { cn } from '@cardstack/boxel-ui/helpers';

export interface TriggerSignature {
  Args: {
    placeholder?: string;
    select: Select;
    selectedItemComponent?: ComponentLike<any>;
  };
  Blocks: {
    default: [Select['selected'], Select];
    placeholder?: [];
  };
  Element: HTMLElement;
}

// This component is used to provide a consistent boxel style to trigger components
// Abstain from using this component with many data customizations
export default class BoxelTriggerWrapper extends Component<TriggerSignature> {
  <template>
    <div class='boxel-select-trigger'>
      {{! Yield the selected item and the select component to allow ember power select consumers to specify the selected item to be displayed after selection}}
      {{! This is how ember-power-select does it inside of their default component }}
      {{#if @select.selected}}
        {{#if @selectedItemComponent}}
          <@selectedItemComponent
            @option={{@select.selected}}
            @select={{@select}}
          />
        {{else}}
          {{yield @select.selected @select}}
        {{/if}}
      {{else}}
        <div class='boxel-select-trigger-placeholder'>
          {{#if (has-block 'placeholder')}}
            {{yield to='placeholder'}}
          {{else if @placeholder}}
            {{@placeholder}}
          {{else}}
            Please Select
          {{/if}}
        </div>
      {{/if}}
      <ChevronDown
        class={{cn 'boxel-select-dropdown-icon' is-open=@select.isOpen}}
        width='24'
        height='24'
        role='presentation'
      />
    </div>
    <style scoped>
      .boxel-select-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        width: 100%;
        max-width: 100%;
        height: 100%;
        padding: var(--boxel-trigger-padding, var(--boxel-sp-xxxs));
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .boxel-select-trigger-placeholder {
        color: var(--boxel-400);
      }
      .boxel-select-dropdown-icon {
        transition: transform 0.1s ease;
      }
      .boxel-select-dropdown-icon.is-open {
        transform: rotate(180deg);
      }
    </style>
  </template>
}

export class BoxelSelectTrigger extends Component<TriggerSignature> {
  get showPlaceholder() {
    return this.args.placeholder && this.args.select?.selected === undefined;
  }
  <template>
    <BoxelTriggerWrapper @placeholder={{@placeholder}} @select={{@select}}>
      <:default>
        {{#if @selectedItemComponent}}
          <@selectedItemComponent
            @option={{@select.selected}}
            @select={{@select}}
          />
        {{else}}
          {{yield @select.selected @select}}
        {{/if}}
      </:default>
    </BoxelTriggerWrapper>
    <style scoped></style>
  </template>
}
