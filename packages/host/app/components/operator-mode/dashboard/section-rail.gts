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

import { cn, cssVar, eq } from '@cardstack/boxel-ui/helpers';

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

// Only a mouse hovers. A finger or a pen enters an entry as it touches down,
// so a hover would open the flyout the same press's click then closes.
function isMouse(event: Event) {
  return (event as PointerEvent).pointerType === 'mouse';
}

// The dashboard's section rail: one entry per registered section, in page
// order, with its count. An entry jumps to its section and is marked while
// that section is being read; hovering or pressing one opens its flyout.
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

  // A flyout opened by hover or a tap leaves focus on the page, so Escape is
  // heard from anywhere, and a press outside the rail closes an open flyout.
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

  // The pointer's last two positions over the rail, for the aim test.
  private previousPoint: Point | null = null;
  private currentPoint: Point | null = null;

  @action private trackPointer(event: Event) {
    let { clientX, clientY } = event as PointerEvent;
    if (this.currentPoint?.x === clientX && this.currentPoint?.y === clientY) {
      return;
    }
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

  @action private onPointerDownOutside(event: Event) {
    if (this.openId && !this.railElement?.contains(event.target as Node)) {
      this.closeFlyout();
    }
  }

  // Hovering an entry opens its flyout at once, unless another flyout is
  // open and the pointer is on its way into it; then the switch waits, and
  // happens only if the pointer stops short.
  @action private hoverEntry(section: DashboardSection, event: Event) {
    if (!isMouse(event)) {
      return;
    }
    // The browser fires pointerenter ahead of the pointermove to the same
    // point, so the aim test reads the point from here.
    this.trackPointer(event);
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
    if (isMouse(event) && this.openId) {
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

  // Focus leaving the rail unfolds it and closes its flyout, as the pointer
  // leaving it does. Focus can leave in the middle of a render (a pick inside
  // a flyout removes the focused row), so both wait for the next run loop.
  @action private onFocusOut(event: Event) {
    let { currentTarget, relatedTarget } = event as FocusEvent;
    if ((currentTarget as HTMLElement).contains(relatedTarget as Node)) {
      return;
    }
    next(() => {
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      this.unfold();
      // A click on a part of the rail that takes no focus blurs it too; the
      // pointer still over the rail keeps it.
      if (this.railElement?.matches(':hover')) {
        return;
      }
      this.flyoutIntentTask.cancelAll();
      this.openId = null;
    });
  }

  // Escape closes an open flyout, then folds the rail, and goes no further.
  @action private onKeydown(event: Event) {
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
    this.closeFlyout();
  }

  // A click jumps to the section and toggles its flyout. A mouse's hover has
  // already opened it, so its click closes it; a tap, a key, or a screen
  // reader's press, which no click can tell apart from a mouse's, has no
  // hover, so its click opens it.
  @action private jumpTo(section: DashboardSection) {
    this.flyoutIntentTask.cancelAll();
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
    this.flyoutIntentTask.cancelAll();
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
      class={{cn
        'section-rail'
        is-folded=this.isFolded
        is-compact=@sections.isCompact
      }}
      aria-label='Dashboard sections'
      data-theme='dark'
      {{this.captureRail}}
      {{on 'pointermove' this.trackPointer}}
      {{on 'pointerenter' this.unfold}}
      {{on 'focusin' this.unfold}}
      {{on 'focusout' this.onFocusOut}}
      data-test-section-rail
      data-test-section-rail-folded={{if this.isFolded 'true' 'false'}}
      ...attributes
    >
      {{#each this.entries key='section.id' as |entry index|}}
        {{#let
          entry.section
          (eq this.currentId entry.section.id)
          (eq this.openId entry.section.id)
          as |section isCurrent isOpen|
        }}
          <div
            class='rail-item'
            style={{cssVar _rail-item-index=index}}
            {{on 'pointerenter' (fn this.hoverEntry section)}}
            {{on 'pointerleave' this.leaveEntry}}
            data-test-section-rail-item={{section.id}}
          >
            <Button
              class={{cn 'rail-button' is-current=isCurrent}}
              @tone={{if isOpen 'neutral' (if isCurrent 'primary' 'neutral')}}
              @appearance={{if isOpen 'filled' 'plain'}}
              aria-current={{if isCurrent 'location'}}
              aria-expanded={{if section.flyout (if isOpen 'true' 'false')}}
              aria-controls={{if isOpen (this.flyoutId section.id)}}
              data-section-rail-entry={{section.id}}
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
           top bar and above the bottom bar. */
        position: absolute;
        top: var(--_rail-top);
        bottom: var(--_rail-bottom);
        left: calc(var(--operator-mode-spacing) - var(--_rail-pad));
        z-index: var(--host-dashboard-rail-z-index);
        display: flex;
        flex-direction: column;
        gap: var(--_rail-gap);
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
         icons hold still. A touch screen's hover sticks after a tap, so only
         a pointer that can hover opens the rail by it. */
      @media (hover: hover) {
        .section-rail:hover {
          width: var(--_rail-open-width);
        }
      }
      .section-rail:focus-within {
        width: var(--_rail-open-width);
      }
      /* A compact dashboard has no room to spare, so the rail stays as
         icons; a flyout still opens beside it. */
      .section-rail:is(.is-folded, .is-compact) {
        width: var(--_rail-closed-width);
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
         second fill; an open entry's fill is the neutral one. */
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
        /* The viewport, not a container: the rail stands outside the
           dashboard. A phone leaves the flyout the width past the rail. */
        --_flyout-width: min(
          20rem,
          100vw - var(--_rail-closed-width) + var(--_rail-pad) -
            var(--boxel-sp-sm) - 2 * var(--operator-mode-spacing)
        );
        /* No taller than the room from its entry down to the rail's bottom,
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
        .section-rail,
        .flyout {
          transition: none;
          animation: none;
        }
      }
    </style>
  </template>
}
