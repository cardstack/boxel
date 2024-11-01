import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type { Select } from 'ember-power-select/components/power-select';

import CaretDown from '../../icons/caret-down.gts';
import IconX from '../../icons/icon-x.gts';
import { BoxelTriggerWrapper } from '../select/trigger.gts';
import BoxelSelectedItem, {
  type SelectedItemSignature,
} from './selected-item.gts';
import Pill from '../pill/index.gts';
import { cn } from '../../helpers.ts';

export interface TriggerComponentSignature<ItemT> {
  Args: {
    placeholder?: string;
    select: Select;
    selectedItemComponent?: ComponentLike<SelectedItemSignature<ItemT>>;
  };
  Blocks: {
    default: [ItemT, Select];
  };
  Element: HTMLElement;
}

type ExtendedSelect = Select & {
  actions: {
    remove: (item: any, event?: MouseEvent) => void;
  } & Select['actions'];
};

export default class BoxelMultiSelectDefaultTrigger<ItemT> extends Component<
  TriggerComponentSignature<ItemT>
> {
  get showPlaceholder() {
    return this.args.placeholder && this.args.select.selected.length == 0;
  }

  private maxVisibleItems = 3;

  get visibleContent(): any[] {
    return this.args.select.selected.slice(0, this.maxVisibleItems);
  }

  get hasMoreItems(): boolean {
    return this.args.select.selected.length > this.maxVisibleItems;
  }

  get remainingItemsCount(): number {
    return this.args.select.selected.length - this.maxVisibleItems;
  }

  @action
  removeExcessItems(event: MouseEvent) {
    event.stopPropagation();
    const newSelected = this.args.select.selected.slice(
      0,
      this.maxVisibleItems,
    );
    this.args.select.selected = [...newSelected];
    this.args.select.actions.select(newSelected);
  }

  @action
  removeItem(item: any, event?: MouseEvent) {
    event?.stopPropagation();
    const newSelected = this.args.select.selected.filter(
      (i: any) => i !== item,
    );
    this.args.select.selected = [...newSelected];
    this.args.select.actions.select(newSelected);
  }

  get select(): ExtendedSelect {
    return {
      ...this.args.select,
      actions: {
        remove: this.removeItem,
        ...this.args.select.actions,
      },
    };
  }

  get hasSelectedItems() {
    return this.args.select.selected && this.args.select.selected.length > 0;
  }

  @action
  onClearAll() {
    this.args.select.actions.select([]);
  }

  <template>
    <BoxelTriggerWrapper @placeholder={{@placeholder}} @select={{this.select}}>
      <:default>
        {{#let
          (if
            @selectedItemComponent
            (component @selectedItemComponent)
            (component BoxelSelectedItem)
          )
          as |SelectedComponent|
        }}
          {{#each this.visibleContent as |item|}}
            <SelectedComponent
              @option={{item}}
              @select={{this.select}}
              as |option select|
            >
              {{yield option select}}
            </SelectedComponent>
          {{/each}}
        {{/let}}

        {{#if this.hasMoreItems}}
          <Pill class='boxel-multi-select-has-more-item'>
            <:default>
              +
              {{this.remainingItemsCount}}
              more
            </:default>
            <:iconRight>
              {{! TODO: Replace with icon button }}
              <button
                class='boxel-multi-select__remove-button'
                {{on 'click' this.removeExcessItems}}
              >
                <IconX class='boxel-multi-select__icon--remove' />
              </button>
            </:iconRight>
          </Pill>
        {{/if}}
      </:default>
      <:icon>
        {{#if this.hasSelectedItems}}
          <div class='has-selections'>
            {{! TODO: Replace with icon button }}
            <button
              class='boxel-multi-select__remove-button'
              {{on 'click' this.onClearAll}}
            >
              <IconX class='boxel-multi-select__remove' />
            </button>
          </div>
        {{else}}
          <CaretDown class={{cn 'icon' (if @select.isOpen 'is-open')}} />
        {{/if}}
      </:icon>
    </BoxelTriggerWrapper>

    <style scoped>
      .boxel-multi-select__remove-button {
        --boxel-multi-select-width: 10px;
        --boxel-multi-select-height: 10px;
        all: unset;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        border-radius: 50%;
        transition: background-color 0.2s ease;
        width: var(--boxel-multi-select-width);
        height: var(--boxel-multi-select-height);
      }
      .boxel-multi-select__icon--remove {
        width: var(--boxel-multi-select-width);
        height: var(--boxel-multi-select-height);
        --icon-color: var(--boxel-light);
      }
      .ember-power-select-multiple-remove-btn {
        display: none; /* We have to remove the default x button placed on selected items*/
      }
      .boxel-multi-select-has-more-item {
        --pill-gap: var(--boxel-sp-xxs);
        --pill-background-color: var(--boxel-700);
        --pill-font-color: var(--boxel-light);
      }
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
