import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import CaretDown from '../../icons/caret-down.gts';
import { cn } from '../../helpers.ts';

export interface TriggerSignature {
  Args: {
    placeholder?: string;
    select: Select;
    selectedItemComponent?: any;
  };
  Blocks: {
    default: [Select['selected'], Select];
    icon: [];
  };
  Element: HTMLElement;
}

// This component is used to provide a consistent boxel style to trigger components
// Abstain from using this component with many data customizations
export class BoxelTriggerWrapper extends Component<TriggerSignature> {
  get showPlaceholder() {
    return (
      this.args.placeholder &&
      (this.args.select?.selected === undefined || //undefined check is for single-select
        this.args.select?.selected.length === 0) //length check is for multi-select
    );
  }
  <template>
    <div class='boxel-trigger'>
      <div class='boxel-trigger-content'>
        {{#if this.showPlaceholder}}
          <div class='boxel-trigger-placeholder'>
            {{@placeholder}}
          </div>
        {{else}}
          {{! Yield the selected item and the select component to allow ember power select consumers to specify the selected item to be displayed after selection}}
          {{! This is how ember-power-select does it inside of their default component }}
          {{yield @select.selected @select}}
        {{/if}}
      </div>

      {{#if (has-block 'icon')}}
        {{yield to='icon'}}
      {{/if}}
    </div>
    <style scoped>
      .boxel-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: var(--boxel-sp-xxxs);
        padding: var(--boxel-sp-xxxs);
      }
      .boxel-trigger-content {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .boxel-trigger-placeholder {
        color: var(--boxel-400);
      }
    </style>
    <style>
      /*Ember power select has a right padding to the trigger element*/
      .ember-power-select-trigger {
        padding: 0px;
      }
    </style>
  </template>
}

export class BoxelSelectDefaultTrigger extends Component<TriggerSignature> {
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
      <:icon>
        <CaretDown class={{cn 'icon' (if @select.isOpen 'is-open')}} />
      </:icon>
    </BoxelTriggerWrapper>
    <style scoped>
      .icon {
        width: 10px;
        height: 10px;
      }
      .is-open {
        transform: rotate(180deg);
      }
    </style>
  </template>
}
