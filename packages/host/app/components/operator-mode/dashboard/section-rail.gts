import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Button } from '@cardstack/pretui/components/button';
import { Tooltip } from '@cardstack/pretui/components/tooltip';
import { modifier } from 'ember-modifier';

import { cn, cssVar, eq } from '@cardstack/boxel-ui/helpers';

import type DashboardSections from './sections';
import type { DashboardSection } from './sections';

interface Signature {
  Element: HTMLElement;
  Args: {
    sections: DashboardSections;
  };
}

// The dashboard's section rail: one icon per registered section, in page
// order, named by a tooltip. An entry jumps to its
// section and is marked while that section is being read; pressing one also
// opens its flyout.
export default class SectionRail extends Component<Signature> {
  @tracked private openId: string | null = null;

  private flyoutId = (id: string) => `${guidFor(this)}-${id}-flyout`;
  private flyoutTitleId = (id: string) => `${guidFor(this)}-${id}-flyout-title`;

  private get currentId() {
    return this.args.sections.currentId;
  }

  private railElement: HTMLElement | null = null;
  private flyoutElement: HTMLElement | null = null;

  // A flyout opened by a tap leaves focus on the page, so Escape is heard
  // from anywhere, and a press outside the rail closes an open flyout.
  // Escape is heard in the capture phase, ahead of the page's other Escape
  // handlers, so the one press it takes reaches none of them. These live on
  // the rail, not the flyout: switching flyouts installs the next one before
  // the last one's teardown runs, which would remove the shared listeners.
  private captureRail = modifier((element: HTMLElement) => {
    this.railElement = element;
    document.addEventListener('keydown', this.onKeydown, true);
    document.addEventListener('pointerdown', this.onPointerDownOutside);
    return () => {
      document.removeEventListener('keydown', this.onKeydown, true);
      document.removeEventListener('pointerdown', this.onPointerDownOutside);
      this.railElement = null;
    };
  });

  private captureFlyout = modifier((element: HTMLElement) => {
    this.flyoutElement = element;
    return () => {
      if (this.flyoutElement === element) {
        this.flyoutElement = null;
      }
    };
  });

  @action private onPointerDownOutside(event: Event) {
    if (this.openId && !this.railElement?.contains(event.target as Node)) {
      this.closeFlyout();
    }
  }

  // Focus leaving the rail closes its flyout. Focus can leave in the middle
  // of a render (a pick inside a flyout removes the focused row), so it waits
  // for the next run loop.
  @action private onFocusOut(event: Event) {
    let { currentTarget, relatedTarget } = event as FocusEvent;
    if ((currentTarget as HTMLElement).contains(relatedTarget as Node)) {
      return;
    }
    next(() => {
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      // A click on a part of the rail that takes no focus blurs it too; the
      // pointer still over the rail keeps it.
      if (this.railElement?.matches(':hover')) {
        return;
      }
      this.openId = null;
    });
  }

  @action private onKeydown(event: Event) {
    if ((event as KeyboardEvent).key !== 'Escape' || !this.openId) {
      return;
    }
    event.stopPropagation();
    this.closeFlyout();
  }

  // A press jumps to the section and toggles its flyout.
  @action private jumpTo(section: DashboardSection) {
    this.openId =
      section.flyout && this.openId !== section.id ? section.id : null;
    this.args.sections.scrollTo(section.id);
  }

  @action private showSection(section: DashboardSection) {
    this.args.sections.scrollTo(section.id);
  }

  // Focus inside the flyout would be lost with it, so it goes back to the
  // flyout's entry first.
  @action private closeFlyout() {
    if (this.openId && this.flyoutElement?.contains(document.activeElement)) {
      this.railElement
        ?.querySelector<HTMLElement>(
          `[data-section-rail-entry="${this.openId}"]`,
        )
        ?.focus();
    }
    this.openId = null;
  }

  <template>
    <nav
      class='section-rail'
      aria-label='Dashboard sections'
      data-theme='dark'
      {{this.captureRail}}
      {{on 'focusout' this.onFocusOut}}
      data-test-section-rail
      ...attributes
    >
      {{#each @sections.sections key='id' as |section index|}}
        {{#let
          (eq this.currentId section.id) (eq this.openId section.id)
          as |isCurrent isOpen|
        }}
          <div
            class='rail-item'
            style={{cssVar _rail-item-index=index}}
            data-test-section-rail-item={{section.id}}
          >
            {{! Hidden while a flyout is open: the flyout names its section
                and covers where the tooltips below it would show. }}
            <Tooltip
              @content={{section.label}}
              @side='right'
              @labels={{true}}
              @disabled={{if this.openId true false}}
            >
              <Button
                class={{cn 'rail-button' is-current=isCurrent}}
                @tone={{if isOpen 'neutral' (if isCurrent 'primary' 'neutral')}}
                @appearance={{if isOpen 'filled' 'plain'}}
                @icon={{section.icon}}
                aria-current={{if isCurrent 'location'}}
                aria-expanded={{if section.flyout (if isOpen 'true' 'false')}}
                aria-controls={{if isOpen (this.flyoutId section.id)}}
                data-section-rail-entry={{section.id}}
                {{on 'click' (fn this.jumpTo section)}}
                data-test-section-rail-entry={{section.id}}
              />
            </Tooltip>
            {{#if isOpen}}
              {{#if section.flyout}}
                <div class='flyout' {{this.captureFlyout}}>
                  <div
                    id={{this.flyoutId section.id}}
                    class='flyout-panel'
                    role='group'
                    aria-labelledby={{this.flyoutTitleId section.id}}
                    data-test-section-rail-flyout={{section.id}}
                  >
                    <section.flyout
                      @close={{this.closeFlyout}}
                      @titleId={{this.flyoutTitleId section.id}}
                      @showSection={{fn this.showSection section}}
                    />
                  </div>
                </div>
              {{/if}}
            {{/if}}
          </div>
        {{/let}}
      {{/each}}
    </nav>

    <style scoped>
      .section-rail {
        --_rail-pad: var(--boxel-sp-4xs);
        --_rail-width: calc(
          var(--container-button-size) + 2 * var(--_rail-pad) + 2px
        );
        --_rail-radius: var(--boxel-border-radius-lg);
        --_rail-glass: color-mix(in oklch, var(--boxel-800) 72%, transparent);
        --_rail-ring: color-mix(
          in oklch,
          var(--boxel-highlight) 70%,
          transparent
        );
        --_rail-shadow: color-mix(in oklch, var(--boxel-dark) 45%, transparent);
        --_rail-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
        /* Read by the flyout too, which must fit between them. */
        --_rail-gap: var(--boxel-sp-4xs);
        --_rail-top: calc(
          var(--operator-mode-top-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );
        --_rail-bottom: calc(
          var(--operator-mode-bottom-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );

        /* Centered on the column the wordmark already stands in, below the
           top bar, as tall as its entries and never past the bottom bar. */
        position: absolute;
        top: var(--_rail-top);
        max-height: calc(100% - var(--_rail-top) - var(--_rail-bottom));
        left: calc(var(--operator-mode-spacing) - var(--_rail-pad));
        z-index: var(--host-dashboard-rail-z-index);
        display: flex;
        flex-direction: column;
        gap: var(--_rail-gap);
        box-sizing: border-box;
        width: var(--_rail-width);
        padding: var(--_rail-pad);
        border: 1px solid var(--boxel-light-10);
        border-radius: calc(var(--_rail-radius) + var(--_rail-pad));
        background-color: var(--_rail-glass);
        backdrop-filter: blur(1.125rem) saturate(140%);
        box-shadow:
          0 1.5rem 3rem var(--_rail-shadow),
          inset 0 1px 0 var(--boxel-light-10);
        color: var(--foreground);
      }

      .rail-item {
        position: relative;
      }
      .rail-button {
        --pretui-button-h: var(--container-button-size);
        --pretui-button-px: 0;
        --pretui-button-radius: var(--_rail-radius);
        --pretui-button-min-w: var(--container-button-size);
      }
      /* The section being read. The filled wordmark above already says which
         screen this is, so the rail marks its section with a ring, never a
         second fill; an open entry's fill is the neutral one. */
      .rail-button.is-current {
        box-shadow: inset 0 0 0 1.5px var(--_rail-ring);
      }
      .flyout {
        /* The viewport, not a container: the rail stands outside the
           dashboard. A phone leaves the flyout the width past the rail. */
        --_flyout-width: min(
          20rem,
          100vw - var(--_rail-width) + var(--_rail-pad) - var(--boxel-sp-sm) -
            2 * var(--operator-mode-spacing)
        );
        /* No taller than the room from its entry down to the bottom bar,
           since the main panel clips whatever runs past the viewport. */
        --_flyout-max-height: min(
          26rem,
          100dvh - var(--_rail-top) - var(--_rail-bottom) -
            var(--_rail-item-index) *
            (var(--container-button-size) + var(--_rail-gap))
        );
        position: absolute;
        top: calc(-1 * var(--_rail-pad));
        left: 100%;
        padding-left: var(--boxel-sp-sm);
        animation: flyout-in 180ms var(--_rail-ease);
      }
      .flyout-panel {
        /* The width a flyout's content lays out in; a row that must fill it
           exactly, as a truncating name does, reads it. */
        --section-rail-flyout-content-width: calc(
          var(--_flyout-width) - 2 * var(--boxel-sp-xs) - 2px
        );
        width: var(--_flyout-width);
        max-height: var(--_flyout-max-height);
        overflow-y: auto;
        overscroll-behavior: contain;
        box-sizing: border-box;
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-light-10);
        border-radius: var(--boxel-border-radius-xl);
        background-color: var(--boxel-700);
        box-shadow: 0 1.5rem 3.5rem var(--_rail-shadow);
        color: var(--foreground);
      }
      @keyframes flyout-in {
        from {
          opacity: 0;
          transform: translateX(-0.375rem);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .flyout {
          animation: none;
        }
      }
    </style>
  </template>
}
