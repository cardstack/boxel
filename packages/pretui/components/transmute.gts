// Pretui — Transmute: the VERB → LABEL → CALL tiers of one tool call; hover promotes one tier.
import Component from '@glimmer/component';

export interface TransmuteSignature {
  Args: {
    verb: string;
    label?: string;
    call?: string;
    tier?: 't0' | 't1' | 't2';
  };
  Element: HTMLSpanElement;
}

// TRANSMUTATION — three cuts of one truth: T0 VERB · T1 LABEL · T2 CALL.
// The verb never moves; only the tail grows (grid-fr morph, quint-out).
// Hover promotes one tier — pure CSS here (no JS state).
export class Transmute extends Component<TransmuteSignature> {
  get tier() {
    return this.args.tier ?? 't1';
  }
  <template>
    <span class='pretui-transmute' data-tier={{this.tier}} data-test-pretui-transmute ...attributes>
      <span class='pretui-verb'>{{@verb}}</span>
      <span class='pretui-transmute-tail' data-t='1'><span>{{@label}}</span></span>
      <span class='pretui-transmute-tail' data-t='2'><span>{{@call}}</span></span>
    </span>
    <style scoped>
      .pretui-verb {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: var(--muted-foreground);
        flex: none;
        margin-right: 0;
      }
      .pretui-transmute {
        display: grid;
        width: 100%;
        min-width: 0;
        overflow: hidden;
        grid-template-columns: auto minmax(0, 0fr) minmax(0, 1fr) 0px;
        align-items: baseline;
        transition: grid-template-columns 380ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-transmute-tail {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        opacity: 0;
        transition: opacity 300ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-transmute-tail > span {
        padding-left: 8px;
      }
      .pretui-transmute-tail[data-t='2'] {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-transmute[data-tier='t0'] {
        grid-template-columns: auto minmax(0, 0fr) minmax(0, 0fr) 1fr;
      }
      .pretui-transmute[data-tier='t1'] {
        grid-template-columns: auto minmax(0, 1fr) minmax(0, 0fr) 1fr;
      }
      .pretui-transmute[data-tier='t1'] .pretui-transmute-tail[data-t='1'] {
        opacity: 1;
      }
      .pretui-transmute[data-tier='t2'] {
        grid-template-columns: auto minmax(0, 0fr) minmax(0, 1fr) 0px;
      }
      .pretui-transmute[data-tier='t2'] .pretui-transmute-tail[data-t='2'] {
        opacity: 1;
      }
      /* hover promotes one tier — CSS-only */
      .pretui-transmute[data-tier='t0']:hover {
        grid-template-columns: auto minmax(0, 1fr) minmax(0, 0fr) 1fr;
      }
      .pretui-transmute[data-tier='t0']:hover .pretui-transmute-tail[data-t='1'] {
        opacity: 1;
      }
      .pretui-transmute[data-tier='t1']:hover {
        grid-template-columns: auto minmax(0, 0fr) minmax(0, 1fr) 0px;
      }
      .pretui-transmute[data-tier='t1']:hover .pretui-transmute-tail[data-t='1'] {
        opacity: 0;
      }
      .pretui-transmute[data-tier='t1']:hover .pretui-transmute-tail[data-t='2'] {
        opacity: 1;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-transmute,
        .pretui-transmute-tail {
          transition: none;
        }
      }
    </style>
  </template>
}
