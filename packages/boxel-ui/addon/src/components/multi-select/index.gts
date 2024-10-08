import { BoxelButton } from '@cardstack/boxel-ui/components';
import { CaretDown, IconX } from '@cardstack/boxel-ui/icons';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import type {
  PowerSelectArgs,
  Select,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';

import cn from '../../helpers/cn.ts';

export interface BoxelMultiSelectArgs<ItemT> extends PowerSelectArgs {
  customSelectedItem?: ComponentLike<any> | undefined;
  hasCheckbox?: boolean;
  labelledBy?: string;
  options: ItemT[];
  selected: ItemT[];
  useCustomTriggerComponent?: boolean;
}

export interface Signature<ItemT = any> {
  Args: BoxelMultiSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

export interface SelectAPI {
  actions: {
    close: () => void;
    open: () => void;
    search: (term: string) => void;
  };
}

export default class BoxelMultiSelect<ItemT> extends Component<
  Signature<ItemT>
> {
  @tracked selectAPI: SelectAPI | null = null;
  @tracked showMore = false;
  @tracked visibleItemCount = 0;
  @tracked isClosingAllowed = false;

  @action
  onOpenWrapper(_select: Select, _e: Event) {
    this.isClosingAllowed = false;
    return undefined;
  }

  @action
  allowClosing() {
    this.isClosingAllowed = true;
  }

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

  get isOptionSelected() {
    return (option: ItemT) => {
      return (
        Array.isArray(this.args.selected) && this.args.selected.includes(option)
      );
    };
  }

  <template>
    <div class='boxel-multi-select__wrapper'>
      <PowerSelectMultiple
        @options={{@options}}
        @selected={{@selected}}
        {{! @glint-ignore - Type instantiation is excessively deep and possibly infinite. }}
        @triggerComponent={{if
          @useCustomTriggerComponent
          (component
            CustomTriggerComponent
            customSelectedItem=@customSelectedItem
            useCustomTriggerComponent=true
          )
          (component
            DefaultTriggerComponent
            customSelectedItem=null
            useCustomTriggerComponent=false
          )
        }}
        @placeholder={{@placeholder}}
        @onChange={{@onChange}}
        @onOpen={{this.onOpenWrapper}}
        @onBlur={{@onBlur}}
        @renderInPlace={{@renderInPlace}}
        @verticalPosition={{@verticalPosition}}
        @dropdownClass={{'boxel-multi-select__dropdown'}}
        @disabled={{@disabled}}
        @matchTriggerWidth={{@matchTriggerWidth}}
        @eventType='click'
        @searchEnabled={{true}}
        @closeOnSelect={{false}}
        @searchField='name'
        @beforeOptionsComponent={{component BeforeOptions}}
        @afterOptionsComponent={{component
          BoxelAfterOptionsComponent
          allowClosing=this.allowClosing
        }}
        ...attributes
        aria-labelledby={{@labelledBy}}
        aria-label={{if @labelledBy undefined 'Select items'}}
        as |option|
      >
        {{#if @hasCheckbox}}
          <div class='checkbox-indicator'>
            <span
              class={{cn
                'check-icon'
                check-icon--selected=(this.isOptionSelected option)
              }}
            >
              <CheckMark width='12' height='12' />
            </span>
          </div>
        {{/if}}

        {{yield option}}
      </PowerSelectMultiple>
      <div
        class='boxel-multi-select__icons-wrapper
          {{if @selected.length "has-selections"}}'
      >
        {{#if @selected.length}}
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
    {{! template-lint-disable require-scoped-style }}
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
      .boxel-multi-select__icon-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
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
      .boxel-multi-select__icon {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
      }
      .boxel-multi-select__icon-button--clear {
        --icon-color: var(--boxel-multi-select-pill-color);
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
      .boxel-multi-select__dropdown .ember-power-select-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
      }
      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-selected='true'] {
        background: var(--boxel-100);
      }
      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-current='true'] {
        color: black;
        background: var(--boxel-100);
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
      .boxel-multi-select__icon {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
      }
      .boxel-multi-select__icon--clear {
        --icon-color: var(--boxel-multi-select-pill-color);
      }
      .boxel-multi-select__dropdown .checkbox-indicator {
        width: 16px;
        height: 16px;
        border: 1px solid var(--boxel-500);
        border-radius: 3px;
        margin-right: var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .boxel-multi-select__dropdown .checkbox-indicator:hover,
      .boxel-multi-select__dropdown .checkbox-indicator:focus {
        box-shadow: 0 0 0 2px var(--boxel-dark-teal);
      }
      .boxel-multi-select__dropdown .check-icon {
        --icon-color: var(--boxel-dark-teal);
        visibility: collapse;
        display: contents;
      }

      .boxel-multi-select__dropdown .check-icon--selected {
        visibility: visible;
      }
    </style>
  </template>
}

export interface SelectedItemSignature<ItemT> {
  Args: {
    customSelectedItem?: ComponentLike<any> | undefined;
    item: ItemT | any;
    removeItem: (item: ItemT, event: MouseEvent) => void;
    useCustomTriggerComponent?: boolean;
  };
  Blocks: {
    content: [];
    icon: [];
  };
  Element: any;
}

export class SelectedItem<ItemT> extends Component<
  SelectedItemSignature<ItemT>
> {
  get getItemDisplayValue(): any {
    return (item: ItemT) => {
      if (item && typeof item === 'object' && 'name' in item) {
        return item.name;
      }
      return String(item);
    };
  }

  <template>
    <div class='ember-power-select-multiple-option'>
      {{#if @useCustomTriggerComponent}}
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{else}}
          {{this.getItemDisplayValue @item}}
        {{/if}}

        <button
          type='button'
          class='boxel-multi-select__icon boxel-multi-select__icon--remove'
          {{on 'click' (fn @removeItem @item)}}
        >
          {{yield to='icon'}}
        </button>
      {{else}}
        {{this.getItemDisplayValue @item}}

        <IconX
          {{on 'click' (fn @removeItem @item)}}
          class='boxel-multi-select__icon boxel-multi-select__icon--remove'
        />
      {{/if}}
    </div>

    <style scoped>
      .ember-power-select-multiple-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .boxel-multi-select__icon--remove {
        all: unset;
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}

export interface defaultTriggerComponentSignature<ItemT> {
  Args: {
    customSelectedItem?: ComponentLike<any> | undefined;
    hasCheckbox?: boolean;
    option: ItemT;
    placeholder: string;
    removeItem: (item: ItemT, event: MouseEvent) => void;
    select: {
      actions: {
        select: (items: ItemT[]) => void;
      };
      selected: ItemT[];
    };
    useCustomTriggerComponent?: boolean;
  };
  Blocks: {
    default: [];
  };
}

export class DefaultTriggerComponent<ItemT> extends Component<
  defaultTriggerComponentSignature<ItemT>
> {
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
  removeItem(item: ItemT, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const newSelected = this.args.select.selected.filter(
      (i: ItemT) => i !== item,
    );
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
          <SelectedItem
            @item={{item}}
            @removeItem={{this.removeItem}}
            @useCustomTriggerComponent={{false}}
            @customSelectedItem={{undefined}}
          />
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
      </div>
    {{else}}
      <div class='ember-power-select-placeholder'>{{@placeholder}}</div>
    {{/if}}

    <style scoped>
      .boxel-multi-select__icon--remove {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}

export interface TriggerComponentSignature<ItemT> {
  Args: {
    customSelectedItem?: ComponentLike<any> | undefined;
    disabled?: boolean;
    extra: Record<string, unknown>;
    onBlur: (e: FocusEvent) => void;
    onFocus: (e: FocusEvent) => void;
    onKeydown: (e: KeyboardEvent) => void;
    placeholder?: string;
    removeItem: (item: ItemT, event: MouseEvent) => void;
    searchEnabled?: boolean;
    searchField?: string | null;
    select: Select;
    selected: ItemT | ItemT[] | null;
    useCustomTriggerComponent?: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export class CustomTriggerComponent<ItemT> extends Component<
  TriggerComponentSignature<ItemT>
> {
  get shouldShowPlaceholder() {
    return (
      this.args.placeholder &&
      this.args.select.selected.length == 0 &&
      this.args.customSelectedItem
    );
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
  removeItem(item: ItemT, event: MouseEvent) {
    event.stopPropagation();
    const newSelected = this.args.select.selected.filter(
      (i: ItemT) => i !== item,
    );
    this.args.select.selected = [...newSelected];
    this.args.select.actions.select(newSelected);
  }

  <template>
    <div class='boxel-trigger'>

      {{#if this.shouldShowPlaceholder}}
        <div class='boxel-trigger-placeholder'>{{@placeholder}}</div>
      {{/if}}

      {{#if @customSelectedItem}}
        {{#each this.visibleContent as |item|}}
          {{#let (component @customSelectedItem) as |SelectedItem|}}
            <SelectedItem
              @item={{item}}
              @removeItem={{this.removeItem}}
              @useCustomTriggerComponent={{true}}
              @customSelectedItem={{@customSelectedItem}}
            />
          {{/let}}
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
      {{else}}
        <div class='error-message'>
          Error: You are required to create a custom selected component.
        </div>
      {{/if}}
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
      .boxel-multi-select__icon--remove {
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}

export interface BoxelAfterOptionComponentArgs {
  Args: {
    allowClosing: () => void;
    select: Select;
  };
}

class BoxelAfterOptionsComponent extends Component<BoxelAfterOptionComponentArgs> {
  @action
  onClearAll() {
    this.args.select.actions.select([]);
  }

  @action
  onClose() {
    this.args.select.actions.close();
    this.args.allowClosing();
  }
  <template>
    <div class='control-buttons'>
      <BoxelButton
        @kind='secondary-light'
        @size='extra-small'
        class='control-button'
        {{on 'click' this.onClearAll}}
      >
        Clear
      </BoxelButton>

      <BoxelButton
        @kind='secondary-light'
        @size='extra-small'
        class='control-button'
        {{on 'click' this.onClose}}
      >
        Close
      </BoxelButton>
    </div>
    <style scoped>
      .control-buttons {
        display: flex;
        justify-content: start;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        border-top: 1px solid var(--boxel-100);
      }
      .control-button {
        flex-grow: 1;
      }
    </style>
  </template>
}
