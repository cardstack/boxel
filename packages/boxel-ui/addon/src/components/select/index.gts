import Check from '@cardstack/boxel-icons/check';
import { eq } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { get } from '@ember/object';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import PowerSelect, {
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import 'ember-power-select/styles';
import PowerSelectOptions from 'ember-power-select/components/power-select/options';

import cn from '../../helpers/cn.ts';
import { BoxelSelectDefaultTrigger } from './trigger.gts';

export interface BoxelSelectArgs<ItemT> extends PowerSelectArgs {
  options: ItemT[];
  variant?: 'primary' | 'secondary' | 'muted' | 'destructive' | 'default';
}

interface Signature<ItemT = any> {
  Args: BoxelSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

export default class BoxelSelect<ItemT> extends Component<Signature<ItemT>> {
  private themeObserver?: MutationObserver | null = null;
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
    if (!this.selectEl || !this.dropdownContainer) return;
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

  private startObservingTheme() {
    if (!this.selectEl) return;

    // Don't set up theme observation when renderInPlace is true
    // as the dropdown will inherit styles naturally through CSS
    if (this.args.renderInPlace) {
      return;
    }

    this.syncCustomProps();
    this.detectAndSetThemeColors();

    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(() => {
      this.syncCustomProps();
      this.detectAndSetThemeColors();
    });
    this.themeObserver.observe(this.selectEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: false,
    });
  }

  @action
  onOpen() {
    // Only start theme observation if not rendering in place
    if (!this.args.renderInPlace) {
      this.startObservingTheme();
    }
  }

  private detectAndSetThemeColors() {
    if (!this.selectEl || !this.dropdownContainer) return;

    // Check if theme variables are available
    const cs = getComputedStyle(this.selectEl);
    const hasBackground = cs.getPropertyValue('--background').trim() !== '';
    const hasForeground = cs.getPropertyValue('--foreground').trim() !== '';
    const parentHasTheme =
      this.selectEl.closest(
        '[style*="--background"], [style*="--foreground"]',
      ) !== null;

    const hasThemeVariables = hasBackground || hasForeground || parentHasTheme;

    const variant = this.args.variant || 'default';
    const variantColors = {
      default: {
        bg: 'var(--background, var(--boxel-light))',
        fg: 'var(--foreground, var(--boxel-dark))',
      },
      primary: {
        bg: 'var(--primary, var(--boxel-600))',
        fg: 'var(--primary-foreground, var(--boxel-dark))',
      },
      secondary: {
        bg: 'var(--secondary, var(--boxel-400))',
        fg: 'var(--secondary-foreground, var(--boxel-dark))',
      },
      muted: {
        bg: 'var(--muted, var(--boxel-200))',
        fg: 'var(--muted-foreground, var(--boxel-dark))',
      },
      destructive: {
        bg: 'var(--destructive, var(--boxel-danger))',
        fg: 'var(--destructive-foreground, var(--boxel-light))',
      },
    };

    if (hasThemeVariables) {
      const { bg, fg } = variantColors[variant];
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
      class={{cn
        'boxel-select'
        (if @variant (concat 'variant-' @variant) 'variant-default')
      }}
      @options={{@options}}
      @searchField={{@searchField}}
      @selected={{@selected}}
      @selectedItemComponent={{@selectedItemComponent}}
      @placeholder={{@placeholder}}
      @onChange={{@onChange}}
      @onBlur={{@onBlur}}
      @renderInPlace={{@renderInPlace}}
      @verticalPosition={{@verticalPosition}}
      @dropdownClass={{cn
        'boxel-select__dropdown'
        @dropdownClass
        (if @variant (concat 'variant-' @variant) 'variant-default')
      }}
      @loadingMessage={{@loadingMessage}}
      @onFocus={{this.onOpen}}
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
        (component
          BoxelSelectDefaultTrigger
          invertIcon=(eq @verticalPosition 'above')
          variant=@variant
        )
      }}
      @disabled={{@disabled}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchEnabled={{@searchEnabled}}
      @beforeOptionsComponent={{if
        @beforeOptionsComponent
        @beforeOptionsComponent
        (component BeforeOptions autofocus=false)
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
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--primary, var(--boxel-dark))
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
        border-color: var(--select-focus-border-color);
      }

      .boxel-select:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight-hover));
      }

      .boxel-select :deep(.boxel-trigger) {
        padding: var(--boxel-sp-xs)
          calc(var(--boxel-sp-xxxs) + var(--boxel-sp-xxs));
      }

      .variant-default {
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
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--primary, var(--boxel-dark))
        );
      }

      .variant-primary {
        --select-background-color: var(
          --boxel-select-background-color,
          var(--primary, var(--boxel-600))
        );
        --select-border-color: var(
          --boxel-select-border-color,
          var(--primary, var(--boxel-600))
        );
        --select-text-color: var(
          --boxel-select-text-color,
          var(--primary-foreground, var(--boxel-light))
        );
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--primary, var(--boxel-600))
        );
      }

      .variant-secondary {
        --select-background-color: var(
          --boxel-select-background-color,
          var(--secondary, var(--boxel-400))
        );
        --select-border-color: var(
          --boxel-select-border-color,
          var(--secondary, var(--boxel-400))
        );
        --select-text-color: var(
          --boxel-select-text-color,
          var(--secondary-foreground, var(--boxel-dark))
        );
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--secondary, var(--boxel-400))
        );
      }

      .variant-muted {
        --select-background-color: var(
          --boxel-select-background-color,
          var(--muted, var(--boxel-200))
        );
        --select-border-color: var(
          --boxel-select-border-color,
          var(--muted, var(--boxel-200))
        );
        --select-text-color: var(
          --boxel-select-text-color,
          var(--muted-foreground, var(--boxel-dark))
        );
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--muted, var(--boxel-200))
        );
      }

      .variant-destructive {
        --select-background-color: var(
          --boxel-select-background-color,
          var(--destructive, var(--boxel-600))
        );
        --select-border-color: var(
          --boxel-select-border-color,
          var(--destructive, var(--boxel-600))
        );
        --select-text-color: var(
          --boxel-select-text-color,
          var(--destructive-foreground, var(--boxel-light))
        );
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--destructive, var(--boxel-danger))
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
          --boxel-dropdown-hover-color,
          var(--theme-highlight-hover, var(--boxel-highlight))
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

      .boxel-select__dropdown .ember-power-select-option[aria-selected='true'] {
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

      /* All variants use the same reusable theme variables */
      .boxel-select__dropdown[class*='variant-'] {
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          var(--theme-highlight, var(--boxel-highlight))
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--theme-highlight-hover, var(--boxel-highlight-hover))
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--theme-hover, var(--boxel-light-100))
        );
      }

      .boxel-select__dropdown.variant-primary {
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          var(--primary, var(--boxel-600))
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--primary, var(--boxel-600))
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--theme-hover, var(--boxel-500))
        );
        --dropdown-selected-text-color: var(
          --primary-foreground,
          var(--foreground, var(--boxel-light))
        );
        --dropdown-focus-border-color: var(
          --primary,
          var(--boxel-outline-color)
        );
      }

      .boxel-select__dropdown.variant-secondary {
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          var(--secondary, var(--boxel-400))
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--secondary, var(--boxel-400))
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--theme-hover, var(--boxel-light-100))
        );
        --dropdown-selected-text-color: var(
          --secondary-foreground,
          var(--foreground, var(--boxel-dark))
        );
        --dropdown-focus-border-color: var(
          --secondary,
          var(--boxel-outline-color)
        );
      }

      .boxel-select__dropdown.variant-muted {
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          var(--muted, var(--boxel-200))
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--muted, var(--boxel-200))
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--theme-hover, var(--boxel-light-100))
        );
        --dropdown-selected-text-color: var(
          --muted-foreground,
          var(--foreground, var(--boxel-dark))
        );
        --dropdown-focus-border-color: var(--muted, var(--boxel-outline-color));
      }

      .boxel-select__dropdown.variant-destructive {
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          var(--destructive, var(--boxel-danger))
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--destructive, var(--boxel-danger))
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          var(--theme-hover, var(--boxel-light-100))
        );
        --dropdown-selected-text-color: var(
          --destructive-foreground,
          var(--foreground, var(--boxel-dark))
        );
        --dropdown-focus-border-color: var(
          --destructive,
          var(--boxel-outline-color)
        );
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
          class={{cn
            'boxel-select-option-item'
            'ember-power-select-option'
            (if
              (eq option @select.selected) 'ember-power-select-option--selected'
            )
            (if
              (eq option @select.highlighted)
              'ember-power-select-option--highlighted'
            )
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

      .boxel-select-option-item.ember-power-select-option--highlighted {
        background-color: var(--dropdown-hover-color);
        color: var(--dropdown-selected-text-color);
      }

      .boxel-select-option-item.ember-power-select-option--selected {
        background-color: var(--dropdown-highlight-color);
        color: var(--dropdown-selected-text-color);
      }

      .boxel-select-option-item.ember-power-select-option--selected.ember-power-select-option--highlighted,
      .boxel-select-option-item.ember-power-select-option--selected:hover {
        background-color: color-mix(
          in oklab,
          var(--dropdown-highlight-color) 95%,
          var(--dropdown-selected-text-color)
        );
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
