// Pretui — JumpChip: scroll orientation for a growing stream, plus the scrollEdge measurement modifier it pairs with.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';

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
// messages" when it did, "Back to bottom" when it did not.
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
     * items that arrived while the reader was away. Non-zero switches the
     * chip to its "new message" voice and shows the count.
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
      return this.count === 1 ? '1 new message' : this.count + ' new messages';
    }
    return this.direction === 'up' ? 'Back to top' : 'Back to bottom';
  }

  jump = () => this.args.onJump?.();

  <template>
    <div
      class='pretui-jump'
      data-visible={{if this.visible 'true'}}
      data-direction={{this.direction}}
      data-news={{if this.isNews 'true'}}
      inert={{unless this.visible true}}
      data-test-pretui-jump-chip
      ...attributes
    >
      <button
        type='button'
        class='pretui-jump-btn'
        data-test-pretui-jump-chip-button
        {{on 'click' this.jump}}
      >
        <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
          <path
            d='M12 5v14M6 13l6 6 6-6'
            fill='none'
            stroke='currentColor'
            stroke-width='2.2'
            stroke-linecap='round'
            stroke-linejoin='round'
          />
        </svg>
        <span>{{this.label}}</span>
      </button>
    </div>

    <style scoped>
      /* absolute against the caller's positioned scroll frame — stated in the
         docs because it is the one thing the caller must provide */
      .pretui-jump {
        position: absolute;
        inset-inline: 0;
        bottom: var(--pretui-jump-offset, 12px);
        display: flex;
        justify-content: center;
        pointer-events: none;
        z-index: var(--pretui-z-sticky, 10);
      }
      .pretui-jump[data-direction='up'] {
        bottom: auto;
        top: var(--pretui-jump-offset, 12px);
      }
      .pretui-jump-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 30px;
        padding: 0 13px;
        border: 0;
        border-radius: 999px;
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 8px 28px rgb(0 0 0 / 0.18)
        );
        font: inherit;
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        color: var(--foreground);
        cursor: pointer;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(8px) scale(0.96);
        transition:
          opacity 180ms ease-out,
          transform 220ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
      }
      .pretui-jump[data-visible] .pretui-jump-btn {
        opacity: 1;
        transform: none;
      }
      /* hidden means hidden: no pointer events, no tab stop, no hit area */
      .pretui-jump:not([data-visible]) .pretui-jump-btn {
        pointer-events: none;
        visibility: hidden;
        transition:
          opacity 180ms ease-out,
          transform 220ms ease-out,
          visibility 0s linear 220ms;
      }
      .pretui-jump-btn:hover {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-jump-btn:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-jump-btn > svg {
        width: 13px;
        height: 13px;
        flex: none;
        color: var(--ink-3, var(--boxel-400));
      }
      .pretui-jump[data-direction='up'] .pretui-jump-btn > svg {
        transform: rotate(180deg);
      }
      /* news is never colour alone — the count is in the label */
      .pretui-jump[data-news] .pretui-jump-btn {
        background: color-mix(
          in oklch,
          var(--primary) 12%,
          var(--card)
        );
        box-shadow:
          0 0 0 1px
            color-mix(in oklch, var(--primary) 45%, var(--border)),
          0 8px 28px rgb(0 0 0 / 0.18);
      }
      .pretui-jump[data-news] .pretui-jump-btn > svg {
        color: color-mix(
          in oklch,
          var(--foreground) 18%,
          var(--primary)
        );
      }
      @media (any-pointer: coarse) {
        .pretui-jump-btn {
          min-height: 44px;
          padding: 0 18px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-jump-btn {
          transition: none;
          transform: none;
        }
      }
    </style>
  </template>
}
