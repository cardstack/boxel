import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type {
  Select,
  PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import { IconX, CaretDown } from '@cardstack/boxel-ui/icons';

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

interface SelectAPI {
  actions: {
    close: () => void;
    open: () => void;
  };
  isOpen: boolean;
}

export default class BoxelMultiSelect extends Component<Signature> {
  @tracked selectAPI: SelectAPI | null = null;
  @tracked showMore = false;
  @tracked visibleItemCount = 0;
  @tracked isOpen = false;

  @action
  onClearAll() {
    if (typeof this.args.onChange === 'function') {
      this.args.onChange([], {
        selected: [],
        searchText: '',
        actions: this.selectAPI?.actions || {},
      } as Select);
    }
  }

  <template>
    <div class='boxel-multi-select__wrapper'>
      <PowerSelectMultiple
        @options={{@options}}
        @selected={{@selected}}
        @selectedItemComponent={{component CustomSelectedItemComponent}}
        @triggerComponent={{component CustomTriggerComponent}}
        @placeholder={{@placeholder}}
        @onChange={{@onChange}}
        @onBlur={{@onBlur}}
        @renderInPlace={{@renderInPlace}}
        @verticalPosition={{@verticalPosition}}
        @dropdownClass={{'boxel-multi-select__dropdown'}}
        @disabled={{@disabled}}
        @matchTriggerWidth={{@matchTriggerWidth}}
        @eventType='click'
        @searchEnabled={{true}}
        @searchField='name'
        @beforeOptionsComponent={{component BeforeOptions}}
        as |option|
      >
        {{yield option}}
      </PowerSelectMultiple>
      <div
        class='boxel-multi-select__icons-wrapper
          {{if @selected.length "has-selections"}}'
      >
        {{#if @selected.length}}
          <IconX
            {{on 'click' this.onClearAll}}
            class='boxel-multi-select__clear-icon'
            aria-label='clear all selections'
          />
        {{else}}
          <CaretDown
            class='boxel-multi-select__caret-icon'
            aria-label='toggle dropdown'
          />
        {{/if}}
      </div>
    </div>

    <style scoped>
      .boxel-multi-select__wrapper {
        position: relative;
        display: flex;
        align-items: stretch;
        flex-grow: 1;
        overflow: hidden;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-sm);
      }

      .boxel-multi-select {
        background: none;
        border: 0;
        outline: none;
        padding: var(--boxel-sp-xxxs);
        cursor: pointer;
      }

      .ember-basic-dropdown-trigger {
        padding: var(--boxel-sp-xxxs);
        display: flex;
        align-items: center;
        flex-grow: 1;
        border: none;
      }

      .ember-power-select-trigger:focus,
      .ember-power-select-trigger--active {
        border: none;
        box-shadow: none;
        outline: none;
      }

      .ember-power-select-trigger:after {
        margin-left: 10px;
      }

      .boxel-multi-select__icons-wrapper {
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

      .boxel-multi-select__icons-wrapper.has-selections {
        pointer-events: auto;
      }

      .boxel-multi-select__clear-icon,
      .boxel-multi-select__caret-icon {
        width: 12px;
        height: 12px;
        cursor: pointer;
      }

      .ember-power-select-multiple-options {
        list-style: none;
        gap: var(--boxel-sp-xxxs);
        width: auto;
      }
      .ember-power-select-multiple-option {
        padding: var(--boxel-sp-5xs);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
        color: var(--boxel-multi-select-pill-color, var(--boxel-dark));
        background-color: var(
          --boxel-selected-pill-background-color,
          var(--boxel-200)
        );
        margin: 0;
      }

      .boxel-multi-select__dropdown {
        box-shadow: var(--boxel-box-shadow);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .boxel-multi-select__dropdown ul {
        list-style: none;
        padding: 0;
        overflow: auto;
        flex-grow: 1;
      }
      .boxel-multi-select__dropdown li {
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
      }

      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-selected='true'] {
        background: var(--boxel-200);
      }

      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-current='true'] {
        color: black;
        background: var(--boxel-200);
      }

      .boxel-multi-select__dropdown .ember-power-select-search-input:focus {
        border: 1px solid var(--boxel-outline-color);
        box-shadow: var(--boxel-box-shadow-hover);
        outline: var(--boxel-outline);
      }

      .boxel-multi-select__dropdown
        .ember-power-select-option--no-matches-message {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
      }
    </style>
  </template>
}

interface CustomSelectedItemComponentArgs<ItemT> {
  option: ItemT;
  placeholder: string;
  select: {
    actions: {
      select: (items: ItemT[]) => void;
    };
    selected: ItemT[];
  };
}

interface CustomSelectedItemComponentSignature<ItemT> {
  Args: CustomSelectedItemComponentArgs<ItemT>;
  Element: HTMLElement;
}

class CustomSelectedItemComponent<ItemT> extends Component<
  CustomSelectedItemComponentSignature<ItemT>
> {
  private maxVisibleItems = 3;

  get visibleContent(): ItemT[] {
    return this.args.select.selected.slice(0, this.maxVisibleItems);
  }

  get hasMoreItems(): boolean {
    return this.args.select.selected.length > this.maxVisibleItems;
  }

  get itemName() {
    return (item: ItemT) => {
      if (!item) return;
      if (typeof item === 'object' && 'name' in item) {
        return String(item.name);
      }
      return String(item);
    };
  }

  get remainingItemsCount(): number {
    return this.args.select.selected.length - this.maxVisibleItems;
  }

  @action
  removeItem(item: ItemT, event: MouseEvent) {
    event.stopPropagation();
    const newSelected = this.args.select.selected.filter((i) => i !== item);
    this.args.select.selected = [...newSelected];
    this.args.select.actions.select(newSelected);
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

  <template>
    {{#if @select.selected.length}}
      <div class='ember-power-select-multiple-options'>
        {{#each this.visibleContent as |item|}}
          <span class='ember-power-select-multiple-option'>
            {{this.itemName item}}
            <IconX
              {{on 'click' (fn this.removeItem item)}}
              class='boxel-multi-select__remove-icon'
              aria-label='remove item'
            />
          </span>
        {{/each}}

        {{#if this.hasMoreItems}}
          <span class='ember-power-select-multiple-option'>
            +
            {{this.remainingItemsCount}}
            more
            <IconX
              {{on 'click' this.removeExcessItems}}
              class='boxel-multi-select__remove-icon'
              aria-label='remove item'
            />
          </span>
        {{/if}}
      </div>
    {{else}}
      <div class='ember-power-select-placeholder'>{{@placeholder}}</div>
    {{/if}}

    <style scoped>
      .boxel-multi-select__remove-icon {
        width: 8px;
        height: 8px;
        cursor: pointer;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}

interface TriggerComponentSignature<ItemT> {
  Args: {
    disabled?: boolean;
    extra: Record<string, unknown>;
    onBlur: (e: FocusEvent) => void;
    onFocus: (e: FocusEvent) => void;
    onKeydown: (e: KeyboardEvent) => void;
    placeholder?: string;
    searchEnabled?: boolean;
    searchField?: string | null;
    select: Select;
    selected: ItemT | ItemT[] | null;
    selectedItemComponent: any;
  };
  Element: HTMLElement;
}

class CustomTriggerComponent<ItemT> extends Component<
  TriggerComponentSignature<ItemT>
> {
  get shouldShowPlaceholder() {
    return this.args.placeholder && this.args.select.selected.length === 0;
  }

  <template>
    <div class='custom-trigger'>
      {{#let (component @selectedItemComponent) as |SelectedItemComponent|}}
        <SelectedItemComponent @select={{@select}} />
        {{#if this.shouldShowPlaceholder}}
          <div class='custom-trigger-placeholder'>{{@placeholder}}</div>
        {{/if}}
      {{/let}}
    </div>

    <style scoped>
      .custom-trigger-placeholder {
        color: var(--boxel-400);
      }
    </style>
  </template>
}
