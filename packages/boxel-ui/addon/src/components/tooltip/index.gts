import { registerDestructor } from '@ember/destroyable';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import type { MiddlewareState } from '@floating-ui/dom';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Velcro } from 'ember-velcro';

import cn from '../../helpers/cn.ts';

export const TOOLTIP_VARIANTS = [
  'default',
  'main',
  'primary',
  'secondary',
  'accent',
  'muted',
  'destructive',
] as const;
export type ThemeVariant = (typeof TOOLTIP_VARIANTS)[number];

interface Signature {
  Args: {
    offset?: number;
    placement?: MiddlewareState['placement'];
    variant?: ThemeVariant;
  };
  Blocks: {
    content: [];
    trigger: [];
  };
  Element: HTMLElement;
}
export default class Tooltip extends Component<Signature> {
  @tracked isHoverOnTrigger = false;
  private overlayContainer?: HTMLElement | null = null;
  private triggerElement?: HTMLElement | null = null;
  private themeObserver?: MutationObserver | null = null;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    registerDestructor(this, () => this.cleanup());
  }

  get triggerEl(): HTMLElement {
    return this.triggerElement as HTMLElement;
  }

  get appRootEl(): HTMLElement {
    // @ts-expect-error rootElement exists at runtime
    const root = getOwner(this)?.rootElement ?? document.body;
    return typeof root === 'string'
      ? (document.querySelector(root) as HTMLElement)
      : root;
  }

  get tooltipOverlay(): HTMLElement {
    if (!this.overlayContainer) {
      let container = document.querySelector(
        '#tooltip-overlay',
      ) as HTMLElement | null;
      if (!container) {
        container = document.createElement('div');
        container.id = 'tooltip-overlay';
        this.appRootEl.appendChild(container);
      }
      // eslint-disable-next-line ember/no-side-effects
      this.overlayContainer = container;
      // Do initial sync when overlay is created
      this.syncCustomProps();
    }
    return this.overlayContainer!;
  }

  private syncCustomProps() {
    if (!this.triggerEl || !this.overlayContainer) return;
    const cs = getComputedStyle(this.triggerEl);

    const themeVars = [
      '--background',
      '--foreground',
      '--popover',
      '--popover-foreground',
      '--border',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--accent',
      '--accent-foreground',
      '--muted',
      '--muted-foreground',
      '--destructive',
      '--destructive-foreground',
    ];

    themeVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);
      if (value && this.overlayContainer) {
        this.overlayContainer.style.setProperty(varName, value);
      }
    });

    const tooltipVars = [
      '--boxel-tooltip-background-color',
      '--boxel-tooltip-text-color',
      '--boxel-tooltip-border-color',
      '--boxel-tooltip-border-radius',
      '--boxel-tooltip-padding',
      '--boxel-tooltip-font',
    ];

    tooltipVars.forEach((varName) => {
      const value = cs.getPropertyValue(varName);
      if (value && this.overlayContainer) {
        this.overlayContainer.style.setProperty(varName, value);
      }
    });
  }

  private startObservingTheme() {
    if (!this.triggerEl) return;

    this.syncCustomProps();

    this.stopObservingTheme();
    this.themeObserver = new MutationObserver(() => this.syncCustomProps());
    this.themeObserver.observe(this.triggerEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: false,
    });
  }

  private stopObservingTheme() {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }

  private cleanup() {
    this.stopObservingTheme();
    this.triggerElement = null;
    this.overlayContainer = null;
  }

  @action
  onMouseEnter(event: Event) {
    this.triggerElement = event.currentTarget as HTMLElement;
    this.isHoverOnTrigger = true;
    this.startObservingTheme();
  }

  @action
  onMouseLeave() {
    this.isHoverOnTrigger = false;
    this.stopObservingTheme();
    this.triggerElement = null;
  }

  <template>
    <Velcro
      @placement={{if @placement @placement 'top'}}
      @offsetOptions={{if @offset @offset 6}}
      as |velcro|
    >
      <div
        class='trigger'
        {{! @glint-ignore velcro.hook }}
        {{velcro.hook}}
        {{on 'mouseenter' this.onMouseEnter}}
        {{on 'mouseleave' this.onMouseLeave}}
        data-tooltip-trigger='true'
        ...attributes
      >
        {{yield to='trigger'}}
      </div>
      {{#if this.isHoverOnTrigger}}
        {{#in-element this.tooltipOverlay}}
          {{! @glint-ignore velcro.loop }}
          <div
            class={{cn
              'tooltip'
              (if @variant (concat 'variant-' @variant) 'variant-default')
            }}
            {{velcro.loop}}
            data-test-tooltip-content
          >
            {{yield to='content'}}
          </div>
        {{/in-element}}
      {{/if}}
    </Velcro>

    <style scoped>
      .trigger {
        width: fit-content;
      }

      .tooltip {
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--boxel-light-35)
        );
        background-color: var(--tooltip-background-color);
        box-shadow: 0 0 0 1px var(--tooltip-border-color);
        color: var(--tooltip-text-color);
        text-align: center;
        border-radius: var(
          --boxel-tooltip-border-radius,
          var(--boxel-border-radius-sm)
        );
        padding: var(
          --boxel-tooltip-padding,
          var(--boxel-sp-xxxs) var(--boxel-sp-sm)
        );
        width: max-content;
        position: absolute;
        font: var(--boxel-tooltip-font, var(--boxel-font-xs));
        font-family: inherit;
        z-index: 5;
      }

      .variant-default {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--boxel-dark-80)
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--boxel-light)
        );
      }

      .variant-main {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--popover, var(--background))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--popover-foreground, var(--foreground))
        );
      }

      .variant-primary {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--primary)
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--primary-foreground)
        );
      }

      .variant-secondary {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--secondary)
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--secondary-foreground)
        );
      }

      .variant-accent {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--accent)
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--accent-foreground)
        );
      }

      .variant-muted {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--muted)
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--muted-foreground)
        );
      }

      .variant-destructive {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--destructive)
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--destructive-foreground)
        );
      }

      :global(#tooltip-overlay) {
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
