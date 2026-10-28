// Pretui — ContextRing: how much of the model's context the conversation uses, as a small ring.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

export interface ContextRingSignature {
  Args: {
    /** tokens the conversation uses */
    used: number;
    /** the model's context window, in tokens */
    limit: number;
    /** the share at which the ring warns. Default 0.8 */
    warnAt?: number;
    /** the ring alone: the percentage moves to its tooltip, for a tight
     * composer bar */
    compact?: boolean;
  };
  Element: HTMLSpanElement;
}

function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

/**
 * A small ring and its percentage, beside the model picker: how full the
 * context is, so a reader sees compaction coming before it happens. The
 * ring turns to the attention colour past @warnAt, and its name says
 * "nearly full". A conversation larger than the window, as after a switch
 * to a model with a smaller one, shows "Full" in the attention colour and
 * says how far over it is: the next prompt is too long, so its earlier
 * messages may get summarized. A limit of 0 or less is unknown, so it is
 * never over.
 */
export class ContextRing extends Component<ContextRingSignature> {
  get share(): number {
    let { used, limit } = this.args;
    return limit > 0 ? Math.min(Math.max(used / limit, 0), 1) : 0;
  }
  get percent(): number {
    return Math.round(this.share * 100);
  }
  get over(): boolean {
    let { used, limit } = this.args;
    return limit > 0 && used > limit;
  }
  get warns(): boolean {
    return this.over || this.share >= (this.args.warnAt ?? 0.8);
  }
  get ringStyle() {
    return htmlSafe(`--pretui-ring-share: ${this.share * 360}deg`);
  }
  /** the accessible name and tooltip; past @warnAt it says so in words, so
   * the warning never rests on the ring's colour alone */
  get label(): string {
    if (this.over) {
      let { used, limit } = this.args;
      return `Context full: ${compact(used)} tokens, ${compact(used - limit)} more than the ${compact(limit)} this model holds. Earlier messages may be summarized when the next one is sent`;
    }
    let warning = this.warns ? ', nearly full' : '';
    return `Context ${this.percent}% used${warning}: ${compact(this.args.used)} of ${compact(this.args.limit)} tokens`;
  }
  <template>
    <span
      class='pretui-contextring'
      role='img'
      aria-label={{this.label}}
      title={{this.label}}
      data-warn={{if this.warns 'true'}}
      data-over={{if this.over 'true'}}
      data-test-pretui-context-ring
      ...attributes
    >
      <span
        class='pretui-contextring-ring'
        style={{this.ringStyle}}
        aria-hidden='true'
      ></span>
      {{#unless @compact}}<span
          class='pretui-contextring-pct'
          data-test-pretui-context-ring-pct
          aria-hidden='true'
        >{{#if this.over}}Full{{else}}{{this.percent}}%{{/if}}</span>{{/unless}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-contextring {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-contextring-ring {
          --_contextring-ink: var(--muted-foreground);
          width: 0.875rem;
          height: 0.875rem;
          border-radius: 50%;
          background: conic-gradient(
            var(--_contextring-ink) var(--pretui-ring-share),
            var(--border-strong) 0
          );
          -webkit-mask: radial-gradient(
            circle,
            transparent 0.25rem,
            black 0.28125rem
          );
          mask: radial-gradient(circle, transparent 0.25rem, black 0.28125rem);
        }
        /* past the warning share the ring (the mark) takes the attention
           ink, and the digits step up to the full foreground */
        .pretui-contextring[data-warn] {
          color: var(--foreground);
        }
        .pretui-contextring[data-warn] .pretui-contextring-ring {
          --_contextring-ink: var(--attention-ink);
        }
      }
    </style>
  </template>
}
