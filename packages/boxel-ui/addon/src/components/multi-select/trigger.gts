import { CaretDown, IconX } from '@cardstack/boxel-ui/icons';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type { Select } from 'ember-power-select/components/power-select';

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
    default: [];
  };
  Element: HTMLElement;
}

export default class BoxelTrigger<ItemT> extends Component<
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

  get select() {
    return {
      ...this.args.select,
      actions: {
        remove: this.removeItem,
        ...this.args.select.actions,
      },
    };
  }

  @action
  onClearAll() {
    this.args.select.actions.select([]);
  }

  <template>
    <div class='boxel-trigger'>

      {{#if this.showPlaceholder}}
        <div class='boxel-trigger-placeholder'>{{@placeholder}}</div>
      {{/if}}

      {{#each this.visibleContent as |item|}}
        {{#if @selectedItemComponent}}
          {{#let
            (component @selectedItemComponent option=item select=this.select)
            as |SelectedItemComponent|
          }}
            <SelectedItemComponent />
          {{/let}}
        {{else}}
          <BoxelSelectedItem @option={{item}} @select={{this.select}} />
        {{/if}}
      {{/each}}

      {{#if this.hasMoreItems}}
        <span class='ember-power-select-multiple-option'>
          +
          {{this.remainingItemsCount}}
          more
          <IconX
            {{on 'click' this.removeExcessItems}}
            class='boxel-multi-select__icon boxel-multi-select__icon--remove'
          />
        </span>
      {{/if}}
      <div
        class='boxel-multi-select__icons-wrapper
          {{if @select.selected.length "has-selections"}}'
      >
        {{#if @select.selected.length}}
          <span class='boxel-multi-select__clear-icon-wrapper'>
            <IconX
              class='boxel-multi-select__icon'
              {{on 'click' this.onClearAll}}
            />
          </span>
        {{else}}
          <span class='boxel-multi-select__icon-wrapper' aria-hidden='true'>
            <CaretDown class='boxel-multi-select__icon' />
          </span>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .boxel-trigger {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .boxel-trigger-placeholder {
        color: var(--boxel-400);
      }
      .error-message {
        color: var(--boxel-red);
      }
      .boxel-multi-select__icon {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
      }
      .boxel-multi-select__icon--remove {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
      .boxel-multi-select__icons-wrapper.has-selections {
        pointer-events: auto;
      }
      .boxel-multi-select__icon-wrapper {
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
        pointer-events: none;
      }
      .boxel-multi-select__clear-icon-wrapper {
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
    <style scoped>
      .ember-power-select-multiple-remove-btn {
        display: none; /* We have to remove the default x button placed on selected items*/
      }
    </style>
  </template>
}
