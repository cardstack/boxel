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
  isOpen: boolean;
  actions: {
    close: () => void;
    open: () => void;
  };
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
        @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
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
            style='width: 12px; height: 12px; cursor: pointer;'
            aria-label='clear all selections'
          />
        {{else}}
          <CaretDown
            style='width: 12px; height: 12px; cursor: pointer;'
            aria-label='toggle dropdown'
          />
        {{/if}}
      </div>
    </div>

    <style>
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

      .boxel-multi-select__clear-all,
      .boxel-multi-select__caret {
        position: relative;
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
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
  select: {
    selected: ItemT[];
    actions: {
      select: (items: ItemT[]) => void;
    };
  };
  placeholder: string;
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
    {{#if this.args.select.selected.length}}
      <div class='ember-power-select-multiple-options'>
        {{#each this.visibleContent as |item|}}
          <span class='ember-power-select-multiple-option'>
            {{this.itemName item}}
            <IconX
              {{on 'click' (fn this.removeItem item)}}
              style='width: 8px; height: 8px; cursor: pointer; --icon-color: var(--boxel-multi-select-pill-color);'
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
              {{on 'click' (fn this.removeExcessItems)}}
              style='width: 8px; height: 8px; cursor: pointer; --icon-color: var(--boxel-multi-select-pill-color);'
              aria-label='remove item'
            />
          </span>
        {{/if}}
      </div>
    {{else}}
      <div class='ember-power-select-placeholder'>{{@placeholder}}</div>
    {{/if}}
  </template>
}

interface TriggerComponentSignature<ItemT> {
  Args: {
    select: Select;
    placeholder?: string;
    selectedItemComponent: any;
    extra: Record<string, unknown>;
    onFocus: (e: FocusEvent) => void;
    onBlur: (e: FocusEvent) => void;
    onKeydown: (e: KeyboardEvent) => void;
    searchEnabled?: boolean;
    searchField?: string | null;
    disabled?: boolean;
    selected: ItemT | ItemT[] | null;
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
      {{#let
        (component this.args.selectedItemComponent)
        as |SelectedItemComponent|
      }}
        <SelectedItemComponent @select={{this.args.select}} />
        {{#if this.shouldShowPlaceholder}}
          <div
            class='custom-trigger-placeholder'
          >{{this.args.placeholder}}</div>
        {{/if}}
      {{/let}}
    </div>

    <style>
      .custom-trigger-placeholder {
        color: var(--boxel-400);
      }
    </style>
  </template>
}
