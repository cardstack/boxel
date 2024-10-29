import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type { Select } from 'ember-power-select/components/power-select';

import IconX from '../../icons/icon-x.gts';
import BoxelSelectTrigger from '../select/trigger.gts';
import BoxelSelectedItem, {
  type SelectedItemSignature,
} from './selected-item.gts';

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

  get hasNonZeroSelected() {
    return this.args.select.selected && this.args.select.selected.length > 0;
  }

  @action
  onClearAll() {
    this.args.select.actions.select([]);
  }

  <template>
    <BoxelSelectTrigger @placeholder={{@placeholder}} @select={{this.select}}>
      <:default>
        <div class='boxel-multi-select-trigger'>
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
            <div class='ember-power-select-hasMore-item'>
              +
              {{this.remainingItemsCount}}
              more
              <IconX
                width='10'
                height='10'
                {{on 'click' this.removeExcessItems}}
                class='boxel-multi-select__remove-icon'
              />
            </div>
          {{/if}}
          {{#if this.hasNonZeroSelected}}
            <div class='has-selections'>
              <IconX
                class='boxel-multi-select__icon'
                width='10'
                height='10'
                {{on 'click' this.onClearAll}}
              />
            </div>
          {{/if}}
        </div>
      </:default>
    </BoxelSelectTrigger>

    <style scoped>
      .boxel-multi-select-trigger {
        display: flex;
      }
      .boxel-multi-select__icon {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
      }
      .boxel-multi-select__remove-icon {
        --icon-color: var(--boxel-multi-select-pill-color);
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
      }
      .ember-power-select-hasMore-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        background-color: var(--boxel-700);
        color: var(--boxel-light);
        padding: 0 4px;
        border: 1px solid gray;
        border-radius: 4px;
      }
      .ember-power-select-hasMore-item > svg {
        --icon-color: var(--boxel-light) !important;
      }
      .ember-power-select-multiple-remove-btn {
        display: none; /* We have to remove the default x button placed on selected items*/
      }
    </style>
  </template>
}
