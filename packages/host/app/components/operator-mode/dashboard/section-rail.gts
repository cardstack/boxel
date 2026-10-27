import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Button } from '@cardstack/pretui/components/button';
import { restartableTask, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { isAimingAt, type Point } from './menu-aim';

import type DashboardSections from './sections';
import type { DashboardSection } from './sections';

// How long a flyout waits before following the pointer to another entry
// while the pointer is still traveling into the open flyout, and before
// closing once the pointer has left its entry.
const FLYOUT_AIM_DELAY_MS = 260;
const FLYOUT_CLOSE_DELAY_MS = 320;

interface Signature {
  Element: HTMLElement;
  Args: {
    sections: DashboardSections;
  };
}

// Pointer handlers ignore touch: a tap is a click, and a hover opened by one
// would close as soon as the finger lifts.
function isTouch(event: Event) {
  return (event as PointerEvent).pointerType === 'touch';
}

// The dashboard's section rail: one entry per registered section, in page
// order, with its count. An entry jumps to its section and is marked while
// that section is being read; hovering or focusing one opens its flyout.
export default class SectionRail extends Component<Signature> {
  @tracked private openId: string | null = null;
  // Escape folds the rail back to its icons while focus stays on an entry;
  // the next hover or focus move opens it again.
  @tracked private isFolded = false;

  @action private unfold() {
    if (this.isFolded) {
      this.isFolded = false;
    }
  }

  private flyoutId = (id: string) => `${guidFor(this)}-${id}-flyout`;
  private flyoutTitleId = (id: string) => `${guidFor(this)}-${id}-flyout-title`;

  private get entries() {
    return this.args.sections.sections.map((section) => ({
      section,
      count: section.count?.(),
    }));
  }

  private get currentId() {
    return this.args.sections.currentId;
  }

  private railElement: HTMLElement | null = null;
  private flyoutElement: HTMLElement | null = null;

  // Pointer down, not up: a tap's focus lands before its pointer comes up.
  private captureRail = modifier((element: HTMLElement) => {
    this.railElement = element;
    element.addEventListener('pointerdown', this.onRailPointerDown);
    return () => {
      element.removeEventListener('pointerdown', this.onRailPointerDown);
      this.railElement = null;
    };
  });

  // A flyout opened by hover or a tap leaves focus on the page, so Escape is
  // heard from anywhere while one is open, and a press outside the rail
  // closes it. Inside the rail, the rail's own handler has already taken
  // Escape.
  private captureFlyout = modifier((element: HTMLElement) => {
    this.flyoutElement = element;
    document.addEventListener('keydown', this.onKeydown);
    document.addEventListener('pointerdown', this.onPointerDownOutside);
    return () => {
      document.removeEventListener('keydown', this.onKeydown);
      document.removeEventListener('pointerdown', this.onPointerDownOutside);
      if (this.flyoutElement === element) {
        this.flyoutElement = null;
      }
    };
  });

  // The pointer's last two positions over the rail, for the aim test.
  private previousPoint: Point | null = null;
  private currentPoint: Point | null = null;

  @action private trackPointer(event: Event) {
    let { clientX, clientY } = event as PointerEvent;
    this.previousPoint = this.currentPoint;
    this.currentPoint = { x: clientX, y: clientY };
  }

  private get isAimingAtOpenFlyout() {
    if (!this.flyoutElement || !this.previousPoint || !this.currentPoint) {
      return false;
    }
    return isAimingAt(
      this.previousPoint,
      this.currentPoint,
      this.flyoutElement.getBoundingClientRect(),
    );
  }

  @action private showFlyout(section: DashboardSection) {
    this.flyoutIntentTask.cancelAll();
    this.openId = section.flyout ? section.id : null;
  }

  // Focus moved onto an entry by Escape returns there without reopening it.
  private isReturningFocus = false;
  // A tap can focus the entry it lands on (Safari doesn't); its click
  // decides the flyout instead, so the focus doesn't open it first.
  private isTapping = false;

  @action private onEntryFocus(section: DashboardSection) {
    if (!this.isReturningFocus && !this.isTapping) {
      this.showFlyout(section);
    }
  }

  @action private onRailPointerDown(event: Event) {
    this.isTapping = isTouch(event);
  }

  @action private onPointerDownOutside(event: Event) {
    if (!this.railElement?.contains(event.target as Node)) {
      this.closeFlyout();
    }
  }

  // Hovering an entry opens its flyout at once, unless another flyout is
  // open and the pointer is on its way into it; then the switch waits, and
  // happens only if the pointer stops short.
  @action private hoverEntry(section: DashboardSection, event: Event) {
    if (isTouch(event)) {
      return;
    }
    if (this.openId === section.id) {
      this.flyoutIntentTask.cancelAll();
      return;
    }
    if (this.openId && this.isAimingAtOpenFlyout) {
      this.flyoutIntentTask.perform(
        section,
        FLYOUT_AIM_DELAY_MS,
        this.currentPoint,
      );
      return;
    }
    this.showFlyout(section);
  }

  // Leaving an entry closes its flyout after a grace period; entering the
  // flyout (part of the entry) or another entry cancels it.
  @action private leaveEntry(event: Event) {
    if (!isTouch(event) && this.openId) {
      this.flyoutIntentTask.perform(null, FLYOUT_CLOSE_DELAY_MS, null);
    }
  }

  // `from` is where the pointer was when the wait began. A pointer that
  // hasn't moved since has stopped short of the flyout, so the switch
  // happens; one still traveling into it gets another look.
  private flyoutIntentTask = restartableTask(
    async (
      section: DashboardSection | null,
      delay: number,
      from: Point | null,
    ) => {
      await timeout(delay);
      if (section && this.currentPoint !== from && this.isAimingAtOpenFlyout) {
        this.flyoutIntentTask.perform(section, delay, this.currentPoint);
        return;
      }
      this.openId = section?.flyout ? section.id : null;
    },
  );

  // Focus leaving the rail closes its flyout, as the pointer leaving it
  // does. Focus can leave in the middle of a render (a pick inside a flyout
  // removes the focused row), so the flyout closes on the next run loop.
  @action private onFocusOut(event: Event) {
    let { currentTarget, relatedTarget } = event as FocusEvent;
    if ((currentTarget as HTMLElement).contains(relatedTarget as Node)) {
      return;
    }
    this.unfold();
    next(() => {
      // A click on a part of the rail that takes no focus blurs it too; the
      // pointer still over the rail keeps it.
      if (
        this.isDestroying ||
        this.isDestroyed ||
        this.railElement?.matches(':hover')
      ) {
        return;
      }
      this.flyoutIntentTask.cancelAll();
      this.openId = null;
    });
  }

  // Escape closes an open flyout, then folds the rail, and goes no further
  // than the rail.
  @action private onKeydown(event: Event) {
    // Keys mean the keyboard is in use, so focus opens flyouts again.
    this.isTapping = false;
    if ((event as KeyboardEvent).key !== 'Escape') {
      return;
    }
    if (!this.openId) {
      if (!this.isFolded && this.railElement?.contains(event.target as Node)) {
        event.stopPropagation();
        this.isFolded = true;
      }
      return;
    }
    event.stopPropagation();
    let openId = this.openId;
    this.flyoutIntentTask.cancelAll();
    // Focus inside the flyout would be lost with it, so it goes back to the
    // flyout's entry first.
    if (this.flyoutElement?.contains(document.activeElement)) {
      let entry = this.railElement?.querySelector<HTMLElement>(
        `[data-section-rail-entry="${openId}"]`,
      );
      this.isReturningFocus = true;
      entry?.focus();
      this.isReturningFocus = false;
    }
    this.openId = null;
  }

  // A click jumps to the section. With a mouse, whose hover opened the
  // flyout, it closes the flyout too; a tap, which has no hover, toggles it.
  @action private jumpTo(section: DashboardSection, event: Event) {
    let isTap = this.isTapping || isTouch(event);
    this.isTapping = false;
    this.flyoutIntentTask.cancelAll();
    this.openId =
      isTap && section.flyout && this.openId !== section.id ? section.id : null;
    this.args.sections.scrollTo(section.id);
  }

  @action private closeFlyout() {
    this.flyoutIntentTask.cancelAll();
    this.openId = null;
  }

  <template>
    {{! Escape closes the flyout from any control inside the rail. }}
    {{! template-lint-disable no-invalid-interactive }}
    <nav
      class={{cn 'section-rail' is-folded=this.isFolded}}
      aria-label='Dashboard sections'
      data-theme='dark'
      data-dashboard-rail
      {{this.captureRail}}
      {{on 'pointermove' this.trackPointer}}
      {{on 'pointerenter' this.unfold}}
      {{on 'focusin' this.unfold}}
      {{on 'focusout' this.onFocusOut}}
      {{on 'keydown' this.onKeydown}}
      data-test-section-rail
      data-test-section-rail-folded={{if this.isFolded 'true' 'false'}}
      ...attributes
    >
      {{#each this.entries key='section.id' as |entry|}}
        {{#let
          entry.section
          (eq this.currentId entry.section.id)
          (eq this.openId entry.section.id)
          as |section isCurrent isOpen|
        }}
          <div
            class='rail-item'
            {{on 'pointerenter' (fn this.hoverEntry section)}}
            {{on 'pointerleave' this.leaveEntry}}
            data-test-section-rail-item={{section.id}}
          >
            <Button
              class={{cn 'rail-button' is-current=isCurrent}}
              @tone={{if isCurrent 'primary' 'neutral'}}
              @appearance={{if isOpen 'filled' 'plain'}}
              aria-current={{if isCurrent 'location'}}
              aria-expanded={{if section.flyout (if isOpen 'true' 'false')}}
              aria-controls={{if isOpen (this.flyoutId section.id)}}
              data-section-rail-entry={{section.id}}
              {{on 'focus' (fn this.onEntryFocus section)}}
              {{on 'click' (fn this.jumpTo section)}}
              data-test-section-rail-entry={{section.id}}
            >
              {{! Laid out at the open rail's width, so the icon holds still
                  and the label and count slide out from under the edge. }}
              <span class='rail-button-content'>
                <section.icon
                  class='rail-icon'
                  width='20'
                  height='20'
                  aria-hidden='true'
                />
                <span class='rail-label'>{{section.label}}</span>
                {{#if entry.count}}
                  <span
                    class='rail-count'
                    data-test-section-rail-count
                  >{{entry.count}}</span>
                {{/if}}
              </span>
            </Button>
            {{#if isOpen}}
              {{#if section.flyout}}
                {{! The wrapper's inline padding bridges the gap to the rail,
                    so the pointer can cross it without leaving the entry. }}
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
        --_rail-icon-size: 1.25rem;
        --_rail-open-width: 12.5rem;
        --_rail-closed-width: calc(
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

        /* Centered on the column the wordmark already stands in, below the
           top bar and above the bottom bar. */
        position: absolute;
        top: calc(
          var(--operator-mode-top-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );
        bottom: calc(
          var(--operator-mode-bottom-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );
        left: calc(var(--operator-mode-spacing) - var(--_rail-pad));
        z-index: var(--host-dashboard-rail-z-index);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        box-sizing: border-box;
        width: var(--_rail-closed-width);
        padding: var(--_rail-pad);
        border: 1px solid var(--boxel-light-10);
        border-radius: calc(var(--_rail-radius) + var(--_rail-pad));
        background-color: var(--_rail-glass);
        backdrop-filter: blur(1.125rem) saturate(140%);
        box-shadow:
          0 1.5rem 3rem var(--_rail-shadow),
          inset 0 1px 0 var(--boxel-light-10);
        color: var(--foreground);
        transition: width 180ms var(--_rail-ease);
      }
      /* Labels and counts slide out over the page on hover or focus; the
         icons hold still. */
      .section-rail:is(:hover, :focus-within) {
        width: var(--_rail-open-width);
      }
      .section-rail.is-folded {
        width: var(--_rail-closed-width);
      }
      /* Below 80rem the page has no room to spare, so the rail stays as
         icons; a flyout still opens beside it. */
      @media (width < 80rem) {
        .section-rail:is(:hover, :focus-within) {
          width: var(--_rail-closed-width);
        }
      }

      .rail-item {
        position: relative;
      }
      .rail-button {
        --pretui-button-h: var(--container-button-size);
        --pretui-button-px: calc(
          (var(--container-button-size) - var(--_rail-icon-size)) / 2 - 1px
        );
        --pretui-button-radius: var(--_rail-radius);
        justify-content: flex-start;
        width: 100%;
        overflow: hidden;
      }
      /* The section being read. The filled wordmark above already says which
         screen this is, so the rail marks its section with a ring, never a
         second fill. */
      .rail-button.is-current {
        box-shadow: inset 0 0 0 1.5px var(--_rail-ring);
      }
      .rail-button-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: calc(
          var(--_rail-open-width) - 2 * var(--_rail-pad) - 2px -
            var(--container-button-size) + var(--_rail-icon-size)
        );
      }
      .rail-icon {
        flex-shrink: 0;
      }
      .rail-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .rail-count {
        flex-shrink: 0;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }

      .flyout {
        /* A phone leaves the flyout the width past the rail. */
        --_flyout-width: min(20rem, 100vw - 6rem);
        --_flyout-max-height: 26rem;
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
        .section-rail,
        .flyout {
          transition: none;
          animation: none;
        }
      }
    </style>
  </template>
}
