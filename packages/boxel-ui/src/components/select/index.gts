import Check from '@cardstack/boxel-icons/check';
import { eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { get } from '@ember/object';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import PowerSelect, {
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import type { PowerSelectBeforeOptionsSignature } from 'ember-power-select/components/power-select/before-options';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import PowerSelectOptions from 'ember-power-select/components/power-select/options';
import type { PowerSelectTriggerSignature } from 'ember-power-select/components/power-select/trigger';
import type {
  Option,
  PowerSelectAfterOptionsSignature,
  PowerSelectSelectedItemSignature,
  Select,
} from 'ember-power-select/types';

import cn from '../../helpers/cn.ts';
import { BoxelSelectDefaultTrigger } from './trigger.gts';

// glint cannot match curried/generic components against power-select's
// expected component-type unions; these shapes are structurally compatible
// (exercised by the test suite), so pin them to the expected member types.
// Exported for consumers that pass their own subcomponents to BoxelSelect /
// BoxelMultiSelect, since realm packages cannot import ember-power-select's
// types themselves.
export function toTriggerComponent(
  component: unknown,
): ComponentLike<PowerSelectTriggerSignature<any, any, false>> {
  return component as ComponentLike<
    PowerSelectTriggerSignature<any, any, false>
  >;
}

export function toMultiSelectTriggerComponent(
  component: unknown,
): ComponentLike<PowerSelectTriggerSignature<any, any, true>> {
  return component as ComponentLike<
    PowerSelectTriggerSignature<any, any, true>
  >;
}

export function toBeforeOptionsComponent(
  component: unknown,
): ComponentLike<PowerSelectBeforeOptionsSignature<any, any, false>> {
  return component as ComponentLike<
    PowerSelectBeforeOptionsSignature<any, any, false>
  >;
}

export function toSelectedItemComponent(
  component: unknown,
): ComponentLike<PowerSelectSelectedItemSignature<any, any, false>> {
  return component as ComponentLike<
    PowerSelectSelectedItemSignature<any, any, false>
  >;
}

export function toAfterOptionsComponent(
  component: unknown,
): ComponentLike<PowerSelectAfterOptionsSignature<any, any, false>> {
  return component as ComponentLike<
    PowerSelectAfterOptionsSignature<any, any, false>
  >;
}

// Consumers bind `selected` to app data, where "no selection" is
// conventionally `null`; power-select expresses it as `undefined`. Redeclare
// the pair null-tolerant here and translate at the boundary (below) so call
// sites don't each have to bridge the two conventions.
export interface BoxelSelectArgs<ItemT> extends Omit<
  PowerSelectArgs<ItemT>,
  'selected' | 'onChange'
> {
  onChange: (
    selection: ItemT | null,
    select: Select<ItemT, false>,
    event?: Event,
  ) => void;
  options: ItemT[];
  selected?: ItemT | Promise<ItemT | undefined> | null;
}

interface Signature<ItemT = any> {
  Args: BoxelSelectArgs<ItemT>;
  Blocks: {
    default: [Option<ItemT>];
  };
  Element: HTMLElement;
}

export default class BoxelSelect<ItemT = any> extends Component<
  Signature<ItemT>
> {
  private selectId = `boxel-select-${guidFor(this)}`;

  get selectEl(): HTMLElement | null {
    return document.getElementById(this.selectId);
  }

  get dropdownContainer(): HTMLElement | null {
    // When renderInPlace is true, the dropdown is rendered within the component
    // so we don't need to sync to the wormhole
    if (this.args.renderInPlace) {
      return null;
    }
    return document.querySelector(
      '#ember-basic-dropdown-wormhole',
    ) as HTMLElement;
  }

  private syncCustomProps() {
    if (!this.selectEl || !this.dropdownContainer) {
      return;
    }
    const cs = getComputedStyle(this.selectEl);

    const themeVars = [
      '--background',
      '--foreground',
      '--border',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--destructive',
      '--destructive-foreground',
      'font-family',
    ];

    const dropdownVars = [
      '--boxel-dropdown-background-color',
      '--boxel-dropdown-border-color',
      '--boxel-dropdown-text-color',
      '--boxel-dropdown-selected-text-color',
      '--boxel-dropdown-focus-border-color',
      '--boxel-dropdown-highlight-color',
      '--boxel-dropdown-highlight-hover-color',
      '--boxel-dropdown-selected-highlighted-color',
      '--boxel-dropdown-selected-hover-color',
      '--boxel-dropdown-hover-color',
      '--boxel-form-control-border-radius',
    ];

    themeVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);

      this.dropdownContainer?.style.setProperty(varName, value);
    });

    dropdownVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);
      this.dropdownContainer?.style.setProperty(varName, value);
    });
  }

  // One-shot copy of the trigger's computed theme onto the shared wormhole.
  // Every open re-syncs before the content's first paint, so a theme that
  // changes while a dropdown is open corrects itself on the next open —
  // no mutation observation needed. Skipped for renderInPlace, where the
  // dropdown inherits the theme naturally through CSS.
  private syncTheme() {
    if (!this.selectEl || this.args.renderInPlace) {
      return;
    }
    this.syncCustomProps();
    this.detectAndSetThemeColors();
  }

  @action
  onOpen(
    select: Parameters<NonNullable<Signature<ItemT>['Args']['onOpen']>>[0],
    event?: Event,
  ) {
    if (this.args.onOpen?.(select, event as Event) === false) {
      return false;
    }
    // Sync theme vars onto the shared wormhole now, before the dropdown
    // content renders, so its first paint already carries the trigger's
    // theme. The focus handler alone is not enough: opens that don't move
    // focus (keyboard reopen, an already-focused trigger) never refire it.
    this.syncTheme();
    return true;
  }

  @action
  onFocus(
    select: Parameters<NonNullable<Signature<ItemT>['Args']['onFocus']>>[0],
    event: FocusEvent,
  ) {
    // Fallback for focus without an open transition (e.g. tabbing to the
    // trigger of an already-open select), and re-syncs after another
    // dropdown's sync overwrote the shared wormhole vars.
    this.syncTheme();
    this.args.onFocus?.(select, event);
  }

  // null↔undefined translation for the no-selection value (see
  // BoxelSelectArgs above). Option<ItemT> is a conditional type that only
  // unwraps group/array option shapes, so for our flat ItemT options the
  // casts are identities the compiler cannot reduce on an unresolved
  // type parameter.
  private get selectedForPowerSelect() {
    return (this.args.selected ?? undefined) as
      | Option<ItemT>
      | Promise<Option<ItemT> | undefined>
      | undefined;
  }

  @action
  private handleChange(
    selection: Option<ItemT> | undefined,
    select: Select<ItemT, false>,
    event?: Event,
  ) {
    this.args.onChange((selection ?? null) as ItemT | null, select, event);
  }

  private detectAndSetThemeColors() {
    if (!this.selectEl || !this.dropdownContainer) {
      return;
    }

    // Check if theme variables are available
    const cs = getComputedStyle(this.selectEl);
    const hasBackground = cs.getPropertyValue('--background').trim() !== '';
    const hasForeground = cs.getPropertyValue('--foreground').trim() !== '';
    const parentHasTheme =
      this.selectEl.closest(
        '[style*="--background"], [style*="--foreground"]',
      ) !== null;

    const hasThemeVariables = hasBackground || hasForeground || parentHasTheme;

    if (hasThemeVariables) {
      const bg = 'var(--background, var(--boxel-light))';
      const fg = 'var(--foreground, var(--boxel-dark))';
      const themeVars = {
        '--theme-highlight': `color-mix(in oklch, ${bg} 92%, ${fg})`,
        '--theme-highlight-hover': `color-mix(in oklch, ${bg} 88%, ${fg})`,
        '--theme-hover': `color-mix(in oklch, ${bg} 94%, ${fg})`,
      };
      Object.entries(themeVars).forEach(([key, value]) => {
        this.dropdownContainer?.style.setProperty(key, value);
      });
    } else {
      ['--theme-highlight', '--theme-highlight-hover', '--theme-hover'].forEach(
        (key) => {
          this.dropdownContainer?.style.removeProperty(key);
        },
      );
    }
  }

  <template>
    {{! template-lint-disable no-autofocus-attribute }}
    <PowerSelect
      id={{this.selectId}}
      class='boxel-select'
      @options={{@options}}
      @searchField={{@searchField}}
      @selected={{this.selectedForPowerSelect}}
      @selectedItemComponent={{@selectedItemComponent}}
      @placeholder={{@placeholder}}
      @onChange={{this.handleChange}}
      @onBlur={{@onBlur}}
      @onClose={{@onClose}}
      @renderInPlace={{@renderInPlace}}
      @verticalPosition={{@verticalPosition}}
      @dropdownClass={{cn 'boxel-select__dropdown' @dropdownClass}}
      @loadingMessage={{@loadingMessage}}
      @onOpen={{this.onOpen}}
      @onFocus={{this.onFocus}}
      @ariaLabel={{@ariaLabel}}
      @ariaLabelledBy={{@ariaLabelledBy}}
      @ariaDescribedBy={{@ariaDescribedBy}}
      @ariaInvalid={{@ariaInvalid}}
      @required={{@required}}
      @triggerRole={{@triggerRole}}
      {{! We can avoid providing arguments to the triggerComponent as long as they are specified here https://github.com/cibernox/ember-power-select/blob/913c85ec82d5c6aeb80a7a3b9d9c21ca9613e900/ember-power-select/src/components/power-select.hbs#L79-L106 }}
      {{! Even the custom BoxelTriggerWrapper will receive these arguments }}
      @triggerComponent={{if
        @triggerComponent
        @triggerComponent
        (toTriggerComponent
          (component
            BoxelSelectDefaultTrigger invertIcon=(eq @verticalPosition 'above')
          )
        )
      }}
      @disabled={{@disabled}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchEnabled={{@searchEnabled}}
      @beforeOptionsComponent={{if
        @beforeOptionsComponent
        @beforeOptionsComponent
        (toBeforeOptionsComponent (component BeforeOptions autofocus=false))
      }}
      @afterOptionsComponent={{@afterOptionsComponent}}
      @optionsComponent={{if
        @optionsComponent
        @optionsComponent
        (component BoxelSelectOptions)
      }}
      data-select-trigger='true'
      ...attributes
      as |item|
    >
      {{yield item}}
    </PowerSelect>

    <style scoped>
      .boxel-select {
        --select-background-color: var(
          --boxel-select-background-color,
          var(--background, var(--boxel-light))
        );
        --select-border-color: var(
          --boxel-select-border-color,
          var(--border, var(--boxel-border-color))
        );
        --select-text-color: var(
          --boxel-select-text-color,
          var(--foreground, var(--boxel-dark))
        );
        --select-placeholder-color: var(
          --boxel-select-placeholder-color,
          var(--muted-foreground, var(--boxel-450))
        );
        /* "--boxel-select-focus-border-color" refers to the hover color, NOT focus color */
        --select-hover-border-color: var(
          --boxel-select-focus-border-color,
          currentColor
        );

        position: relative;
        display: flex;
        align-items: stretch;
        padding: 0;
        overflow: hidden;
        border: 1px solid var(--select-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        max-width: 100%;
        width: 100%;
        background-color: var(--select-background-color);
        color: var(--select-text-color);
        transition: border-color var(--boxel-transition);
      }
      .boxel-select[aria-expanded='true'] {
        border-radius: var(--boxel-form-control-border-radius);
      }

      .boxel-select:not([aria-disabled='true']):hover {
        cursor: pointer;
        border-color: var(--select-hover-border-color);
      }

      .boxel-select:focus-visible {
        outline: 2px solid var(--ring);
      }

      .boxel-select :deep(.boxel-trigger) {
        padding: var(
          --boxel-select-trigger-padding,
          var(--boxel-sp-xs) calc(var(--boxel-sp-xxxs) + var(--boxel-sp-xxs))
        );
      }

      .boxel-select[aria-disabled='true'] {
        background-color: var(--muted, var(--boxel-100));
        color: var(--select-placeholder-color);
        cursor: not-allowed;
        pointer-events: none;
      }
    </style>
    {{! template-lint-disable require-scoped-style }}
    <style>
      /* Unscoped because the dropdown renders in a wormhole outside this
         component. See "CSS layers" in ../../../README.md. */
      @layer boxelComponentL1 {
        .boxel-select__dropdown.ember-power-select-dropdown {
          --dropdown-background-color: var(
            --boxel-dropdown-background-color,
            var(--background, var(--boxel-light))
          );
          --dropdown-border-color: var(
            --boxel-dropdown-border-color,
            var(--border, var(--boxel-border-color))
          );
          --dropdown-text-color: var(
            --boxel-dropdown-text-color,
            var(--foreground, var(--boxel-dark))
          );
          --dropdown-highlight-color: var(
            --boxel-dropdown-highlight-color,
            var(--theme-highlight, var(--boxel-highlight))
          );
          --dropdown-highlight-hover-color: var(
            --boxel-dropdown-highlight-hover-color,
            var(
              --boxel-dropdown-hover-color,
              var(--theme-highlight-hover, var(--boxel-highlight-hover))
            )
          );
          --dropdown-hover-color: var(
            --boxel-dropdown-hover-color,
            var(--theme-hover, var(--boxel-light-100))
          );
          --dropdown-focus-border-color: var(
            --boxel-dropdown-focus-border-color,
            var(--ring, var(--boxel-highlight-hover))
          );
          --dropdown-selected-text-color: var(
            --boxel-dropdown-selected-text-color,
            var(--foreground, var(--boxel-dark))
          );
          --dropdown-selected-highlighted-color: var(
            --boxel-dropdown-selected-highlighted-color,
            color-mix(
              in oklab,
              var(--dropdown-highlight-color) 95%,
              var(--dropdown-selected-text-color)
            )
          );
          --dropdown-selected-hover-color: var(
            --boxel-dropdown-selected-hover-color,
            var(
              --boxel-dropdown-highlight-hover-color,
              color-mix(
                in oklab,
                var(--dropdown-highlight-color) 95%,
                var(--dropdown-selected-text-color)
              )
            )
          );

          box-shadow: var(--boxel-box-shadow);
          border-radius: var(--boxel-form-control-border-radius);
          background-color: var(--dropdown-background-color);
          border: 1px solid var(--dropdown-border-color);
          z-index: var(--boxel-layer-modal-urgent);
          max-height: var(--boxel-select-max-height, 12.5rem);
          overflow: hidden;
          font-family: inherit;
        }

        .boxel-select__dropdown:not(.ember-basic-dropdown-content--above) {
          margin-top: 4px;
          margin-bottom: 0;
        }

        .boxel-select__dropdown ul {
          list-style: none;
          padding: var(--boxel-sp-xxxs);
          margin: 0;
          overflow: auto;
          max-height: inherit;
          font-family: inherit;
        }

        .boxel-select__dropdown .ember-power-select-option {
          padding: var(--boxel-sp-xxs);
          background-color: var(--dropdown-background-color);
          color: var(--dropdown-text-color);
          transition: background-color var(--boxel-transition);
          border-radius: var(--boxel-border-radius-sm);
          cursor: pointer;
          border: none;
          width: 100%;
          text-align: left;
          font-family: inherit;
          font-size: var(--boxel-font-size-sm);
          letter-spacing: var(--boxel-lsp-sm);
          margin-bottom: 2px;
        }

        .boxel-select__dropdown
          .ember-power-select-option[aria-selected='true'] {
          background-color: var(--dropdown-highlight-color);
          color: var(--dropdown-selected-text-color);
        }

        .boxel-select__dropdown
          .ember-power-select-option[aria-selected='true']:hover {
          background-color: var(--dropdown-highlight-hover-color);
          color: var(--dropdown-selected-text-color);
        }

        .boxel-select__dropdown .ember-power-select-option:hover {
          background-color: var(--dropdown-hover-color);
          color: var(--dropdown-selected-text-color);
        }

        .boxel-select__dropdown .ember-power-select-option:focus {
          outline: none;
          background-color: var(--dropdown-highlight-color);
          color: var(--dropdown-selected-text-color);
        }

        .boxel-select__dropdown .ember-power-select-search {
          padding: var(--boxel-sp-xs);
          border-bottom: 1px solid var(--dropdown-border-color);
        }

        .boxel-select__dropdown .ember-power-select-search-input {
          background-color: var(--dropdown-background-color);
          color: var(--dropdown-text-color);
          border: 1px solid var(--dropdown-border-color);
          border-radius: var(--boxel-border-radius-xs);
          padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          font-family: inherit;
          font-size: var(--boxel-font-size-sm);
          letter-spacing: var(--boxel-lsp-sm);
          width: 100%;
          box-sizing: border-box;
        }

        .boxel-select__dropdown .ember-power-select-search-input:focus {
          border: 1px solid var(--dropdown-focus-border-color);
          box-shadow: 0 0 0 1px var(--dropdown-focus-border-color);
          outline: none;
        }

        .boxel-select__dropdown .ember-power-select-option--no-matches-message {
          padding: var(--boxel-sp-sm);
          color: var(--dropdown-text-color);
          font-style: italic;
          text-align: center;
        }

        .boxel-select__dropdown .ember-power-select-option--loading-message {
          padding: var(--boxel-sp-sm);
          color: var(--dropdown-text-color);
          text-align: center;
        }
      }

      :global(#select-dropdown-overlay) {
        position: absolute;
        z-index: 10000;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      /* Accessibility: Status announcement region */
      .ember-power-select-visually-hidden {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }
    </style>
  </template>
}

export interface OptionsSignature<ItemT = any> {
  Args: {
    extra?: any;
    groupIndex?: string;
    highlighted: ItemT;
    options: ItemT[];
    searchText: string;
    select: {
      actions: {
        choose: (option: ItemT, event?: Event) => void;
        close: () => void;
        highlight: (option: ItemT) => void;
        select: (option: ItemT) => void;
      };
      selected: ItemT;
      uniqueId: string;
    };
  };
  Blocks: {
    default: [ItemT, any, boolean];
  };
  Element: HTMLDivElement;
}

export class BoxelSelectOptions extends PowerSelectOptions {
  @action
  handleSelect(option: any, select: any) {
    select.actions.select(option);
    select.actions.close();
    // Blur the target element after selection
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement) {
      activeElement.blur();
    }
  }

  <template>
    <ul
      class='boxel-select-options-list ember-power-select-options'
      role='listbox'
      aria-label='Select options'
      id='ember-power-select-options-{{@select.uniqueId}}'
    >
      {{#each @options as |option index|}}
        <li
          {{! `ember-power-select-option` stays: the addon's stylesheet and its
          `selectChoose` test helper both key off it. The selected/highlighted
          state is ours to name — the addon never reads those modifiers. }}
          class={{cn
            'boxel-select-option-item'
            'ember-power-select-option'
            is-selected=(eq option @select.selected)
            is-highlighted=(eq option @select.highlighted)
          }}
          id='{{@select.uniqueId}}-{{@groupIndex}}{{index}}'
          data-option-index='{{@groupIndex}}{{index}}'
          data-test-option={{index}}
          data-test-option-id={{option.id}}
          role='option'
          aria-selected={{eq option @select.selected}}
          aria-disabled={{if (get option 'disabled') 'true'}}
          aria-current={{eq option @select.highlighted}}
          {{on 'click' (fn this.handleSelect option @select)}}
          {{on 'mouseenter' (fn @select.actions.highlight option)}}
        >
          <span class='boxel-select-option-text'>
            {{yield option @select}}
          </span>
          {{#if @select.selected}}
            <span class='boxel-select-option-checkmark-container'>
              {{#if (eq option @select.selected)}}
                <Check
                  class='boxel-select-option-checkmark'
                  role='presentation'
                  width='16'
                  height='16'
                  aria-hidden='true'
                />
              {{/if}}
            </span>
          {{/if}}
        </li>
      {{/each}}
    </ul>

    <style scoped>
      .boxel-select-options-list {
        list-style: none;
        padding: var(--boxel-sp-xxxs);
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow-y: auto;
        max-width: 100%;
        max-height: var(--boxel-select-options-list-max-height, 12.25rem);
        position: relative;
        box-sizing: border-box;
      }

      .boxel-select-option-item {
        margin: 0;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        max-width: 100%;
        padding: var(--boxel-sp-xxs);
        margin-bottom: 1px;
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
        letter-spacing: var(--boxel-lsp-sm);
        text-align: left;
        background-color: var(--dropdown-background-color);
        color: var(--dropdown-text-color);
        border: none;
        transition:
          background-color var(--boxel-transition),
          color var(--boxel-transition);
        box-sizing: border-box;
      }

      .boxel-select-option-item:not([aria-disabled='true']):hover {
        background-color: var(--dropdown-hover-color);
        color: var(--dropdown-selected-text-color);
        cursor: pointer;
      }

      .boxel-select-option-item.is-highlighted {
        background-color: var(--dropdown-hover-color);
        color: var(--dropdown-selected-text-color);
      }

      .boxel-select-option-item.is-selected {
        background-color: var(--dropdown-highlight-color);
        color: var(--dropdown-selected-text-color);
      }

      .boxel-select-option-item.is-selected.is-highlighted {
        background-color: var(--dropdown-selected-highlighted-color);
      }

      /* Pointer state is declared after the keyboard state so it wins when both
         apply — hovering an option also highlights it. */
      .boxel-select-option-item.is-selected:hover {
        background-color: var(--dropdown-selected-hover-color);
      }

      .boxel-select-option-item[aria-disabled='true'] {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
      }

      .boxel-select-option-icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        flex-shrink: 0;
        margin-right: var(--boxel-sp-xxs);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .boxel-select-option-text {
        padding: 1px; /* spacing for 1px card box-shadow border */
        overflow: hidden;
        display: var(--boxel-select-option-text-display, flex);
        align-items: var(--boxel-select-option-text-align, center);
        gap: var(--boxel-select-option-text-gap, var(--boxel-sp-2xs));
      }

      .boxel-select-option-checkmark-container {
        /* maintain space for icon and keep content widths the same */
        width: var(--boxel-icon-med);
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .boxel-select-option-checkmark {
        height: var(--boxel-icon-xs);
        max-width: 100%;
        aspect-ratio: 1;
        flex-shrink: 0;
        --icon-color: currentColor;
      }
    </style>
  </template>
}
