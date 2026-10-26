// Pretui — JumpChip: scroll orientation for a growing stream, plus the scrollEdge measurement modifier it pairs with.
import Component from '@glimmer/component';
import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { VisuallyHidden } from './visually-hidden';

// ── scrollEdge ───────────────────────────────────────────────────────────
// The measurement JumpChip needs, and the reason the chip is not merely
// decorative: a passive `scroll` listener on the transcript that reports
// **only when the answer changes**. Reporting every frame is what makes a
// naive version of this re-render a list on every wheel tick; the boolean
// latch means a full scroll to the bottom produces exactly one state write.
//
// It is an `ember-modifier`, so the listener is removed in the destructor.
// No timer is involved at any point — a re-arming debounce here would block
// `await settled()` and hang the whole test suite.
export const scrollEdge = modifier(
  (
    el: HTMLElement,
    [onChange]: [(atEnd: boolean, element: HTMLElement) => void],
    named: { threshold?: number },
  ) => {
    let threshold = named.threshold ?? 24;
    let last: boolean | undefined;
    let report = () => {
      let distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      let atEnd = distance <= threshold;
      if (atEnd !== last) {
        last = atEnd;
        onChange(atEnd, el);
      }
    };
    el.addEventListener('scroll', report, { passive: true });
    report();
    return () => el.removeEventListener('scroll', report);
  },
);

// ── JumpChip ─────────────────────────────────────────────────────────────
// Scroll orientation for a stream that grows while you are reading it. Two
// jobs in one control, distinguished by whether anything arrived: "3 new
// messages" when it did, "Back to bottom" when it did not. The news is also
// said once through a polite status region, since a chip that appears at
// the edge of the frame is easy to miss and invisible to a screen reader.
//
// A reader who takes the jump from the keyboard keeps their focus: when the
// caller hides the chip in answer, it stays reachable (not inert) until
// focus leaves it, so focus never drops to the page body.
//
// Presentational by contract — the caller owns the scroller and decides when
// the chip is warranted (`scrollEdge` above is the measurement, offered
// separately so a caller with their own virtualiser can ignore it). The chip
// positions itself against the nearest positioned ancestor, which is stated
// here because it is the one thing a caller must do for it to land right.

export interface JumpChipSignature {
  Args: {
    /** whether the chip is offered at all */
    visible?: boolean;
    /**
     * messages that arrived while the reader was away: count messages, not
     * transcript rows (a tool call or a system line is not a message).
     * Non-zero switches the chip to its "new messages" voice and shows the
     * count.
     */
    count?: number;
    /** override the derived label entirely */
    label?: string;
    /** which way the jump goes (default 'down') */
    direction?: 'down' | 'up';
    /** fires when the reader takes the jump */
    onJump?: () => void;
  };
  Element: HTMLDivElement;
}

const PLURAL = new Intl.PluralRules('en');
const COUNT = new Intl.NumberFormat('en');

/** "1 new message", "3 new messages", "1,204 new messages" */
function newMessages(count: number): string {
  let noun = PLURAL.select(count) === 'one' ? 'message' : 'messages';
  return `${COUNT.format(count)} new ${noun}`;
}

// A hidden chip is inert, except while it holds keyboard focus: then inert
// waits for focus to leave, because putting it on the focused button would
// drop focus to the page body. Pointer focus does not hold it (the reader's
// next action is not on the chip).
const inertWhileHidden = modifier((el: HTMLElement, [visible]: [boolean]) => {
  if (visible) {
    el.inert = false;
    return;
  }
  if (!el.querySelector(':focus-visible')) {
    el.inert = true;
    return;
  }
  let release = () => {
    el.inert = true;
  };
  el.addEventListener('focusout', release, { once: true });
  return () => el.removeEventListener('focusout', release);
});

export class JumpChip extends Component<JumpChipSignature> {
  get count(): number {
    return this.args.count ?? 0;
  }
  get direction(): 'down' | 'up' {
    return this.args.direction ?? 'down';
  }
  get visible(): boolean {
    return this.args.visible ?? true;
  }
  get isNews(): boolean {
    return this.count > 0;
  }
  get label(): string {
    if (this.args.label) {
      return this.args.label;
    }
    if (this.isNews) {
      return newMessages(this.count);
    }
    return this.direction === 'up' ? 'Back to top' : 'Back to bottom';
  }
  /** what the status region says: the news while the chip offers it,
   * nothing otherwise */
  get announcement(): string {
    return this.visible && this.isNews ? this.label : '';
  }

  jump = () => this.args.onJump?.();

  <template>
    <div
      class='pretui-jump'
      data-visible={{if this.visible 'true'}}
      data-direction={{this.direction}}
      data-news={{if this.isNews 'true'}}
      {{inertWhileHidden this.visible}}
      data-test-pretui-jump-chip
      ...attributes
    >
      <button
        type='button'
        class='pretui-jump-btn'
        {{on 'click' this.jump}}
        data-test-pretui-jump-chip-button
      >
        <ArrowDownIcon width='13' height='13' aria-hidden='true' />
        <span>{{this.label}}</span>
      </button>
    </div>
    {{! outside the chip, which is inert while hidden: an inert region is
        not in the accessibility tree, so its change would not be heard }}
    <VisuallyHidden
      role='status'
      data-test-pretui-jump-chip-status
    >{{this.announcement}}</VisuallyHidden>

    <style scoped>
      @layer PretComponent {
        /* absolute against the caller's positioned scroll frame — stated in the
           docs because it is the one thing the caller must provide */
        .pretui-jump {
          position: absolute;
          inset-inline: 0;
          bottom: var(--pretui-jump-offset, var(--boxel-sp-sm));
          display: flex;
          justify-content: center;
          pointer-events: none;
          z-index: var(--pretui-z-sticky, 10);
        }
        .pretui-jump[data-direction='up'] {
          bottom: auto;
          top: var(--pretui-jump-offset, var(--boxel-sp-sm));
        }
        .pretui-jump-btn {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-3xs);
          min-height: 1.75rem;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--card);
          box-shadow: var(
            --pretui-shadow-overlay,
            0 0 0 1px var(--border),
            var(--shadow-lg)
          );
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--foreground);
          cursor: pointer;
          pointer-events: auto;
          opacity: 0;
          transform: translateY(0.5rem) scale(0.96);
          transition:
            opacity 180ms ease-out,
            transform 220ms
              var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        /* shown while offered, and while it holds the keyboard focus a jump
           left on it, so a focused control never vanishes under the reader */
        .pretui-jump[data-visible] .pretui-jump-btn,
        .pretui-jump:focus-within .pretui-jump-btn {
          opacity: 1;
          transform: none;
        }
        /* hidden means hidden: no pointer events, no tab stop, no hit area */
        .pretui-jump:not([data-visible]):not(:focus-within) .pretui-jump-btn {
          pointer-events: none;
          visibility: hidden;
          transition:
            opacity 180ms ease-out,
            transform 220ms ease-out,
            visibility 0s linear 220ms;
        }
        /* --hover is translucent, so it lays over the card face rather than
           replacing it: the chip floats over the transcript */
        .pretui-jump-btn:hover {
          background-image: linear-gradient(var(--hover), var(--hover));
        }
        .pretui-jump-btn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-jump-btn > svg {
          flex: none;
          color: var(--subtle-foreground);
        }
        .pretui-jump[data-direction='up'] .pretui-jump-btn > svg {
          transform: rotate(180deg);
        }
        /* news is never colour alone — the count is in the label; the
           arrow (the mark) takes the live state, the chip stays the card */
        .pretui-jump[data-news] .pretui-jump-btn > svg {
          color: var(--primary-ink);
        }
        @media (any-pointer: coarse) {
          .pretui-jump-btn {
            min-height: 2.75rem;
            padding: 0 var(--boxel-sp);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-jump-btn {
            transition: none;
            transform: none;
          }
        }
      }
    </style>
  </template>
}
