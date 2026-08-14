import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';

import CircleCheckIcon from '@cardstack/boxel-icons/circle-check';
import ClockIcon from '@cardstack/boxel-icons/clock';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import CircleXIcon from '@cardstack/boxel-icons/circle-x';
import PauseIcon from '@cardstack/boxel-icons/pause';

import { stateColor, type Hue } from '../utils/index';
import {
  TIMER_HUE,
  timerSnapshot,
  type TimerFacts,
  type TimerState,
} from '../utils/sla';

// The clock moved to utils/sla-clock so the lens predicates can read the
// same instant this badge draws. Re-exported: the badge is where every
// existing importer looks for it.
export { slaClock } from '../utils/sla-clock';
import { slaClock } from '../utils/sla-clock';

const STATE_ICON = {
  met: CircleCheckIcon,
  healthy: ClockIcon,
  warning: ClockIcon,
  urgent: AlertTriangleIcon,
  breached: CircleXIcon,
  paused: PauseIcon,
};

interface Signature {
  Args: {
    /** The timer's raw fields. Accepts an SlaTimerField model directly. */
    facts?: TimerFacts;
    /** 'First response', 'Resolution' — omitted in the tightest slots. */
    caption?: string;
    /**
     * Tick once a second. Only ever true where the component is hydrated:
     * prerendered fitted views render once at index time, so a live badge
     * there would freeze at whatever second it was built, which reads as a
     * bug. Those views pass `false` and show the stored snapshot instead.
     */
    live?: boolean;
    /** Show the proportional bar under the chip. */
    showBar?: boolean;
  };
  Element: HTMLElement;
}

export class SlaTimerBadge extends GlimmerComponent<Signature> {
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args as never);
    if (this.args.live) {
      slaClock.subscribe();
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.args.live) {
      slaClock.unsubscribe();
    }
  }

  get snapshot() {
    // Reading `slaClock.now` is what subscribes this component to the tick;
    // in static mode we deliberately do not touch it, so the badge never
    // re-renders.
    let now = this.args.live ? slaClock.now : new Date();
    return timerSnapshot(this.args.facts ?? {}, now);
  }

  get state(): TimerState {
    return this.snapshot.state;
  }

  get icon() {
    return STATE_ICON[this.state];
  }

  get colors() {
    return stateColor(TIMER_HUE[this.state] as Hue);
  }

  get chipStyle() {
    let { bg, fg } = this.colors;
    // A breach is the one state allowed to shout: solid fill rather than the
    // 14% dilution every other state uses, because "you have already missed
    // this" should not look like a sibling of "you have time".
    // No border on either branch: a fill and an outline in the same hue is the
    // same information drawn twice, around the most-read element on the page.
    if (this.state === 'breached') {
      return htmlSafe(
        `background: ${this.colors.ring}; color: var(--background, var(--boxel-light));`,
      );
    }
    return htmlSafe(`background: ${bg}; color: ${fg};`);
  }

  /**
   * Hand-rolled, and this one stays hand-rolled — recorded as an upstream gap
   * rather than a shortcut.
   *
   * boxel-ui's `ProgressBar` is the right component and it takes the fill
   * colour through `--boxel-progress-bar-fill-color`, but its track is a
   * hard-coded `height: 1.5em` with no variable in front of it. This bar sits
   * under a chip inside a slab cell and has to be a 4px hairline; getting
   * there through the library would mean overriding `.progress-bar-container`
   * from outside, which is reaching into another component's markup — the
   * fork this app is not allowed to make.
   *
   * The fix belongs upstream: a `--boxel-progress-bar-height` knob. Until then
   * this stays local and declared, not quietly duplicated.
   */
  get barStyle() {
    let pct = this.snapshot.percentRemaining ?? 0;
    return htmlSafe(`width: ${pct}%; background: ${this.colors.ring};`);
  }

  get hasBar() {
    return this.args.showBar && this.snapshot.percentRemaining != null;
  }

  <template>
    <span class='sla' data-sla-state={{this.state}} ...attributes>
      {{#if @caption}}
        <span class='sla-caption'>{{@caption}}</span>
      {{/if}}
      <span class='sla-chip' style={{this.chipStyle}}>
        <this.icon class='sla-icon' role='presentation' />
        {{! The state name is carried in text as well as colour — a red chip
            and an amber chip are the same chip to a colourblind agent. }}
        <span class='sla-text'>{{this.snapshot.shortLabel}}</span>
      </span>
      {{#if this.hasBar}}
        <span
          class='sla-bar'
          role='progressbar'
          aria-valuenow={{this.snapshot.percentRemaining}}
          aria-valuemin='0'
          aria-valuemax='100'
          aria-label='{{if @caption @caption "SLA"}} time remaining'
        >
          <span class='sla-bar-fill' style={{this.barStyle}}></span>
        </span>
      {{/if}}
      {{#if (eq this.state 'breached')}}
        <span class='sr-only'>SLA breached</span>
      {{/if}}
    </span>

    <style scoped>
      .sla {
        display: inline-flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      .sla-caption {
        font-size: 0.625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .sla-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        align-self: flex-start;
        max-width: 100%;
        padding: 0.12em 0.42em;
        border-radius: 4px;
        font-size: 0.6875rem;
        font-weight: 600;
        line-height: 1.4;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .sla-icon {
        width: 12px;
        height: 12px;
        flex: none;
      }
      .sla-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sla-bar {
        display: block;
        height: 4px;
        width: 100%;
        border-radius: 2px;
        overflow: hidden;
        background: var(--muted, var(--boxel-200));
      }
      .sla-bar-fill {
        display: block;
        height: 100%;
        /* Only the width animates, and only in the live view — a bar that
           eases on every re-render looks like the number changed when it did
           not. */
        transition: width 0.9s linear;
      }
      @media (prefers-reduced-motion: reduce) {
        .sla-bar-fill {
          transition: none;
        }
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    </style>
  </template>
}

export default SlaTimerBadge;
