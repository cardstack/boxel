import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import type { MiddlewareState } from '@floating-ui/dom';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Velcro } from 'ember-velcro';

import cn from '../../helpers/cn.ts';

interface Signature {
  Args: {
    offset?: number;
    placement?: MiddlewareState['placement'];
    variant?: 'primary' | 'secondary' | 'muted' | 'destructive' | 'default';
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
  private themeObserver?: MutationObserver | null = null;

  get triggerEl(): HTMLElement {
    return document.querySelector('[data-tooltip-trigger]') as HTMLElement;
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

    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(() => this.syncCustomProps());
    this.themeObserver.observe(this.triggerEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: false,
    });
  }

  @action
  onMouseEnter() {
    this.isHoverOnTrigger = true;
    this.startObservingTheme();
  }

  @action
  onMouseLeave() {
    this.isHoverOnTrigger = false;
    this.themeObserver?.disconnect();
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
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--background, rgb(0 0 0 / 80%))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--foreground, var(--boxel-light))
        );
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--border, var(--boxel-light-500))
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
          var(--background, rgb(0 0 0 / 80%))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--foreground, var(--boxel-light))
        );
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--border, var(--boxel-light-500))
        );
      }

      .variant-primary {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--primary, var(--boxel-600))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--primary-foreground, var(--boxel-light))
        );
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--primary, var(--boxel-600))
        );
      }

      .variant-secondary {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--secondary, var(--boxel-400))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--secondary-foreground, var(--boxel-dark))
        );
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--secondary, var(--boxel-400))
        );
      }

      .variant-muted {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--muted, var(--boxel-200))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--muted-foreground, var(--boxel-dark))
        );
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--muted, var(--boxel-200))
        );
      }

      .variant-destructive {
        --tooltip-background-color: var(
          --boxel-tooltip-background-color,
          var(--destructive, var(--boxel-600))
        );
        --tooltip-text-color: var(
          --boxel-tooltip-text-color,
          var(--destructive-foreground, var(--boxel-light))
        );
        --tooltip-border-color: var(
          --boxel-tooltip-border-color,
          var(--destructive, var(--boxel-600))
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
