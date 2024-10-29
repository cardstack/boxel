import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import CaretDown from '../../icons/caret-down.gts';
import CaretUp from '../../icons/caret-up.gts';

export interface TriggerSignature {
  Args: {
    placeholder?: string;
    select: Select;
    selectedItemComponent?: any;
  };
  Blocks: {
    default: [Select['selected'], Select];
    icon: [];
    placeholder: [];
  };
  Element: HTMLElement;
}

// This component is used to provide a consistent boxel style to trigger components
// Abstain from using this component with many data customizations
export class BoxelTriggerWrapper extends Component<TriggerSignature> {
  <template>
    <div class='boxel-trigger'>
      <div class='boxel-trigger-content'>
        {{#if (has-block 'placeholder')}}
          <div class='boxel-trigger-placeholder'>
            {{yield to='placeholder'}}
          </div>
        {{/if}}
        {{! Yield the selected item and the select component to allow ember power select consumers to specify the selected item to be displayed after selection}}
        {{! This is how ember-power-select does it inside of their default component }}
        {{yield @select.selected @select}}
      </div>
      {{#if (has-block 'icon')}}
        <span class='boxel-select__icon-wrapper' aria-hidden='true'>
          <div class='boxel-select__icon'>
            {{yield to='icon'}}
          </div>
        </span>
      {{/if}}
    </div>
    <style scoped>
      .boxel-trigger {
        display: flex;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxxs);
      }
      .boxel-trigger-content {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs);
      }
      .boxel-trigger-placeholder {
        color: var(--boxel-400);
      }
      .boxel-select__icon {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
      }
      .boxel-select__icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxs);
        width: 40px;
      }
    </style>
  </template>
}

export class BoxelSelectDefaultTrigger extends Component<TriggerSignature> {
  get showPlaceholder() {
    return this.args.placeholder && this.args.select?.selected === undefined;
  }
  <template>
    <BoxelTriggerWrapper @placeholder={{@placeholder}} @select={{@select}}>
      <:placeholder>
        {{#if this.showPlaceholder}}
          {{@placeholder}}
        {{/if}}
      </:placeholder>
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
      <:icon>
        {{#if @select.isOpen}}
          <CaretUp />
        {{else}}
          <CaretDown />
        {{/if}}
      </:icon>
    </BoxelTriggerWrapper>
    <style scoped></style>
  </template>
}
