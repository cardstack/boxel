import { concat, fn, hash } from '@ember/helper';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import BasicDropdown, {
  type Dropdown,
} from 'ember-basic-dropdown/components/basic-dropdown';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import {
  type FunctionBasedModifier,
  modifier as createModifier,
} from 'ember-modifier';

import cn from '../../helpers/cn.ts';

type DropdownTriggerElement = HTMLButtonElement | HTMLAnchorElement;
type DropdownTriggerNamedArgs = {
  [named: string]: unknown;
  dropdown: Dropdown;
  eventType?: 'click' | 'mousedown';
  id: string;
  stopPropagation?: boolean;
};

interface DropdownTriggerSignature {
  Args: {
    Named: DropdownTriggerNamedArgs;
    Positional: unknown[];
  };
  Element: DropdownTriggerElement;
}

export type DropdownAPI = Dropdown;

interface Signature {
  Args: {
    autoClose?: boolean;
    contentClass?: string;
    initiallyOpened?: boolean;
    matchTriggerWidth?: boolean;
    onClose?: () => void;
    registerAPI?: (publicAPI: Dropdown) => void;
    variant?: 'primary' | 'secondary' | 'default';
  };
  Blocks: {
    content: [{ close: () => void }];
    trigger: [
      FunctionBasedModifier<{
        Args: {
          Positional: unknown[];
        };
        // note: should only be used with Button, but HTMLAnchorElement is included so that the
        // trigger bindings can be applied to BoxelButton without glint error
        Element: HTMLButtonElement | HTMLAnchorElement;
      }>,
    ];
  };
  Element: HTMLDivElement;
}

// Needs to be class, BasicDropdown doesn't work with const
class BoxelDropdown extends Component<Signature> {
  private themeObserver?: MutationObserver | null = null;
  private dropdownId = guidFor(this);

  get dropdownEl(): HTMLElement | null {
    return document.getElementById(this.dropdownId);
  }

  get dropdownContainer(): HTMLElement | null {
    return document.querySelector(
      '#ember-basic-dropdown-wormhole',
    ) as HTMLElement;
  }

  private syncCustomProps() {
    if (!this.dropdownEl || !this.dropdownContainer) return;
    const cs = getComputedStyle(this.dropdownEl);

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

    // Get computed styles from the component element
    themeVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);
      if (value.trim()) {
        this.dropdownContainer?.style.setProperty(varName, value);
      }
    });
  }

  private detectAndSetThemeColors() {
    if (!this.dropdownEl || !this.dropdownContainer) return;

    const cs = getComputedStyle(this.dropdownEl);
    const hasBackground = cs.getPropertyValue('--background').trim() !== '';
    const hasForeground = cs.getPropertyValue('--foreground').trim() !== '';
    const parentHasTheme =
      this.dropdownEl.closest(
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
        fg: 'var(--primary-foreground, var(--boxel-light))',
      },
      secondary: {
        bg: 'var(--secondary, var(--boxel-400))',
        fg: 'var(--secondary-foreground, var(--boxel-dark))',
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

  private startObservingTheme() {
    if (!this.dropdownEl) return;

    this.syncCustomProps();
    this.detectAndSetThemeColors();

    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(() => {
      this.syncCustomProps();
      this.detectAndSetThemeColors();
    });
    this.themeObserver.observe(this.dropdownEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: false,
    });
  }

  @action registerAPI(publicAPI: DropdownAPI) {
    this.args.registerAPI?.(publicAPI);
  }

  @action onMouseLeave(dropdown?: Dropdown) {
    if (this.args.autoClose && dropdown) {
      dropdown.actions.close();
    }
  }

  @action onOpen() {
    this.startObservingTheme();
  }

  <template>
    {{!--
      Note:
      ...attributes will only apply to BasicDropdown if @renderInPlace={{true}}
      because otherwise it does not render any HTML elements of its own, only its yielded content
    --}}
    <BasicDropdown
      @registerAPI={{this.registerAPI}}
      @onClose={{@onClose}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @initiallyOpened={{@initiallyOpened}}
      @onOpen={{this.onOpen}}
      as |dd|
    >
      {{#let
        (modifier
          this.dropdownModifier
          dropdown=dd
          id=this.dropdownId
          eventType='click'
          stopPropagation=false
        )
        as |ddModifier|
      }}
        {{! @glint-ignore }}
        {{yield ddModifier to='trigger'}}
      {{/let}}

      <dd.Content
        @onMouseLeave={{fn this.onMouseLeave dd}}
        data-test-boxel-dropdown-content
        class={{cn
          'boxel-dropdown__content'
          @contentClass
          (if @variant (concat 'variant-' @variant) 'variant-default')
        }}
        {{focusTrap
          isActive=dd.isOpen
          focusTrapOptions=(hash
            initialFocus=(concat
              "[aria-controls='ember-basic-dropdown-content-" dd.uniqueId "']"
            )
            onDeactivate=dd.actions.close
            allowOutsideClick=true
            fallbackFocus=(concat '#ember-basic-dropdown-content-' dd.uniqueId)
          )
        }}
      >
        {{yield (hash close=dd.actions.close) to='content'}}
      </dd.Content>
    </BasicDropdown>

    <style scoped>
      @layer {
        .boxel-dropdown__content {
          --boxel-dropdown-content-border-radius: var(--boxel-border-radius);
          --dropdown-background-color: var(
            --boxel-dropdown-background-color,
            var(--background, var(--boxel-light))
          );
          --dropdown-border-color: var(
            --boxel-dropdown-border-color,
            var(--border)
          );
          --dropdown-text-color: var(
            --boxel-dropdown-text-color,
            var(--foreground, var(--boxel-dark))
          );
          --dropdown-shadow: 0 5px 15px 0 rgb(0 0 0 / 25%);
          --dropdown-highlight-color: var(
            --boxel-dropdown-highlight-color,
            var(--theme-highlight, var(--boxel-highlight))
          );

          --dropdown-hover-color: var(
            --boxel-dropdown-hover-color,
            var(--theme-hover, var(--boxel-light-100))
          );

          background-color: var(--dropdown-background-color);
          border: 1px solid var(--dropdown-border-color);
          color: var(--dropdown-text-color);
          border-radius: var(--boxel-dropdown-content-border-radius);
          box-shadow: 0 5px 15px 0 rgb(0 0 0 / 25%);
        }

        /* Menu styling cater for dropdown */
        .boxel-dropdown__content :deep(.boxel-menu:not(.themeless)) {
          --boxel-menu-color: var(--dropdown-background-color) !important;
          --boxel-menu-text-color: var(--dropdown-text-color) !important;
          --boxel-menu-hover-color: var(--dropdown-hover-color) !important;
          --boxel-menu-current-color: var(--dropdown-hover-color) !important;
          --boxel-menu-selected-font-color: var(
            --dropdown-text-color
          ) !important;
        }

        .boxel-dropdown__content
          :deep(
            .boxel-menu:not(.themeless)
              .boxel-menu__item:not(.boxel-menu__item--disabled):hover
          ) {
          color: var(--dropdown-selected-text-color);
        }

        .boxel-dropdown__content
          :deep(.boxel-menu:not(.themeless) .boxel-menu__separator) {
          border-bottom-color: var(--dropdown-border-color) !important;
        }

        .boxel-dropdown__content[class*='variant-'] {
          --dropdown-highlight-color: var(
            --boxel-dropdown-highlight-color,
            var(--theme-highlight, var(--boxel-highlight))
          );
          --dropdown-hover-color: var(
            --boxel-dropdown-hover-color,
            var(--theme-hover, var(--boxel-light-100))
          );
        }

        .boxel-dropdown__content.variant-primary {
          --dropdown-highlight-color: var(
            --boxel-dropdown-highlight-color,
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

        .boxel-dropdown__content.variant-secondary {
          --dropdown-highlight-color: var(
            --boxel-dropdown-highlight-color,
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

        .ember-basic-dropdown-content--below.gap-above {
          margin-top: 4px;
        }

        @media (prefers-reduced-motion: no-preference) {
          .boxel-dropdown__content.ember-basic-dropdown-content--below.ember-basic-dropdown--transitioned-in {
            animation: drop-fade-below var(--boxel-transition);
          }

          .boxel-dropdown__content.ember-basic-dropdown-content--below.ember-basic-dropdown--transitioning-out {
            animation: drop-fade-below var(--boxel-transition) reverse;
          }
        }

        @keyframes drop-fade-below {
          0% {
            opacity: 0;
            transform: translateY(-20px);
          }

          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      }
    </style>
  </template>

  dropdownModifier = createModifier<DropdownTriggerSignature>(function (
    element: DropdownTriggerElement,
    _positional: unknown[],
    named: DropdownTriggerNamedArgs,
  ) {
    const {
      dropdown,
      id,
      eventType: desiredEventType,
      stopPropagation,
    } = named;

    if (element.tagName.toUpperCase() !== 'BUTTON') {
      throw new Error('Only buttons should be used with the dropdown modifier');
    }

    function updateAria() {
      element.setAttribute('aria-expanded', dropdown.isOpen ? 'true' : 'false');
      element.setAttribute(
        'aria-disabled',
        dropdown.disabled ? 'true' : 'false',
      );
    }

    function handleMouseEvent(e: MouseEvent) {
      if (typeof document === 'undefined') {
        return;
      }

      if (!dropdown || dropdown.disabled) {
        return;
      }

      const eventType = e.type;
      const notLeftClick = e.button !== 0;
      if (eventType !== desiredEventType || notLeftClick) {
        return;
      }

      if (stopPropagation) {
        e.stopPropagation();
      }

      dropdown.actions.toggle(e);
      updateAria();
    }

    function handleKeyDown(e: KeyboardEvent): void {
      const { disabled, actions } = dropdown;
      if (disabled) {
        return;
      }
      if (e.keyCode === 27) {
        actions.close(e);
      }
      updateAria();
    }
    element.addEventListener(
      'click',
      handleMouseEvent as EventListenerOrEventListenerObject,
    );
    element.addEventListener(
      'keydown',
      handleKeyDown as EventListenerOrEventListenerObject,
    );
    element.setAttribute('id', id);
    element.setAttribute('data-ebd-id', `${dropdown.uniqueId}-trigger`);
    element.setAttribute(
      'aria-owns',
      `ember-basic-dropdown-content-${dropdown.uniqueId}`,
    );
    element.setAttribute(
      'aria-controls',
      `ember-basic-dropdown-content-${dropdown.uniqueId}`,
    );
    updateAria();

    return function cleanup() {
      element.removeEventListener(
        'click',
        handleMouseEvent as EventListenerOrEventListenerObject,
      );
      element.removeEventListener(
        'keydown',
        handleKeyDown as EventListenerOrEventListenerObject,
      );
    };
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Boxel::Dropdown': typeof BoxelDropdown;
  }
}

export default BoxelDropdown;
