import { eq } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import PowerSelect, {
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';

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
  private selectId = `boxel-select-${Math.random()
    .toString(36)
    .substring(2, 11)}`;

  get selectEl(): HTMLElement | null {
    return document.getElementById(this.selectId);
  }

  get dropdownContainer(): HTMLElement {
    return document.querySelector(
      '#ember-basic-dropdown-wormhole',
    ) as HTMLElement;
  }

  private syncCustomProps() {
    if (!this.selectEl) return;
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
    ];

    themeVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);

      this.dropdownContainer.style.setProperty(varName, value);
    });

    dropdownVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);
      this.dropdownContainer.style.setProperty(varName, value);
    });
  }

  private startObservingTheme() {
    if (!this.selectEl) return;

    this.syncCustomProps();

    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(() => this.syncCustomProps());
    this.themeObserver.observe(this.selectEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: false,
    });
  }

  @action
  onOpen() {
    this.startObservingTheme();
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
      @eventType='click'
      @searchEnabled={{@searchEnabled}}
      @beforeOptionsComponent={{if
        @beforeOptionsComponent
        @beforeOptionsComponent
        (component BeforeOptions autofocus=false)
      }}
      @afterOptionsComponent={{@afterOptionsComponent}}
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
        --select-focus-border-color: var(
          --boxel-select-focus-border-color,
          var(--primary, var(--boxel-outline-color))
        );

        position: relative;
        display: flex;
        align-items: stretch;
        overflow: hidden;
        border: 1px solid var(--select-border-color);
        border-radius: var(--boxel-border-radius-sm);
        max-width: 100%;
        width: 100%;
        background-color: var(--select-background-color);
        color: var(--select-text-color);
        transition: border-color var(--boxel-transition);
      }

      .boxel-select:hover {
        cursor: pointer;
      }

      .boxel-select:focus-within {
        border-color: var(--select-focus-border-color);
        box-shadow: 0 0 0 1px var(--select-focus-border-color);
      }

      .boxel-select :deep(.boxel-trigger-placeholder) {
        font-family: inherit;
        color: var(--select-text-color);
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
          var(--primary, var(--boxel-outline-color))
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
          var(--destructive, var(--boxel-600))
        );
      }

      .ember-power-select-trigger {
        padding: 0;
      }
    </style>
    {{! template-lint-disable require-scoped-style }}
    <style>
      .boxel-select__dropdown {
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
          color-mix(
            in oklch,
            var(
                --dropdown-background-color,
                var(--background, var(--boxel-light))
              )
              92%,
            var(--foreground, var(--boxel-dark))
          )
        );

        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-highlight-hover-color,
          color-mix(
            in oklch,
            var(
                --dropdown-background-color,
                var(--background, var(--boxel-light))
              )
              88%,
            var(--foreground, var(--boxel-dark))
          )
        );

        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          color-mix(
            in oklch,
            var(
                --dropdown-background-color,
                var(--background, var(--boxel-100))
              )
              94%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-focus-border-color: var(
          --boxel-dropdown-focus-border-color,
          var(--border, var(--boxel-border-color))
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
        max-height: 200px;
        overflow: hidden;
      }

      .boxel-select__dropdown ul {
        list-style: none;
        padding: 0;
        margin: 0;
        overflow: auto;
        max-height: inherit;
      }

      .boxel-select__dropdown .ember-power-select-option {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--dropdown-background-color);
        color: var(--dropdown-text-color);
        transition: background-color var(--boxel-transition);
        cursor: pointer;
        border: none;
        width: 100%;
        text-align: left;
        font-family: inherit;
        font-size: var(--boxel-font-sm);
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
        font-size: var(--boxel-font-sm);
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

      /* Variant-specific dropdown styling */
      .boxel-select__dropdown.variant-primary {
        --dropdown-background-color: var(
          --boxel-dropdown-background-color,
          color-mix(
            in oklch,
            var(--primary, var(--boxel-600)) 15%,
            var(--background, var(--boxel-light)) 85%
          )
        );
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          color-mix(
            in oklch,
            var(--primary, var(--boxel-600)) 88%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-highlight-hover-color,
          color-mix(
            in oklch,
            var(--primary, var(--boxel-600)) 82%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          color-mix(
            in oklch,
            var(--primary, var(--boxel-600)) 90%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-selected-text-color: var(
          --primary-foreground,
          var(--foreground, var(--boxel-dark))
        );
        --dropdown-focus-border-color: var(
          --primary,
          var(--boxel-outline-color)
        );
      }

      .boxel-select__dropdown.variant-secondary {
        --dropdown-background-color: var(
          --boxel-dropdown-background-color,
          color-mix(
            in oklch,
            var(--secondary, var(--boxel-400)) 15%,
            var(--background, var(--boxel-light)) 85%
          )
        );
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          color-mix(
            in oklch,
            var(--secondary, var(--boxel-400)) 88%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-highlight-hover-color,
          color-mix(
            in oklch,
            var(--secondary, var(--boxel-400)) 82%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          color-mix(
            in oklch,
            var(--secondary, var(--boxel-400)) 90%,
            var(--foreground, var(--boxel-dark))
          )
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
        --dropdown-background-color: var(
          --boxel-dropdown-background-color,
          color-mix(
            in oklch,
            var(--muted, var(--boxel-200)) 15%,
            var(--background, var(--boxel-light)) 85%
          )
        );
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          color-mix(
            in oklch,
            var(--muted, var(--boxel-200)) 88%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-highlight-hover-color,
          color-mix(
            in oklch,
            var(--muted, var(--boxel-200)) 82%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          color-mix(
            in oklch,
            var(--muted, var(--boxel-200)) 90%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-selected-text-color: var(
          --muted-foreground,
          var(--foreground, var(--boxel-dark))
        );
        --dropdown-focus-border-color: var(--muted, var(--boxel-outline-color));
      }

      .boxel-select__dropdown.variant-destructive {
        --dropdown-background-color: var(
          --boxel-dropdown-background-color,
          color-mix(
            in oklch,
            var(--destructive, var(--boxel-600)) 15%,
            var(--background, var(--boxel-light)) 85%
          )
        );
        --dropdown-highlight-color: var(
          --boxel-dropdown-highlight-color,
          color-mix(
            in oklch,
            var(--destructive, var(--boxel-600)) 88%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-highlight-hover-color: var(
          --boxel-dropdown-highlight-hover-color,
          color-mix(
            in oklch,
            var(--destructive, var(--boxel-600)) 82%,
            var(--foreground, var(--boxel-dark))
          )
        );
        --dropdown-hover-color: var(
          --boxel-dropdown-hover-color,
          color-mix(
            in oklch,
            var(--destructive, var(--boxel-600)) 90%,
            var(--foreground, var(--boxel-dark))
          )
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
    </style>
  </template>
}
