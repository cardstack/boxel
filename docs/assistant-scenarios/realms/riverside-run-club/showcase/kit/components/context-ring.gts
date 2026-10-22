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
 * A 14px ring and its percentage, beside the model picker: how full the
 * context is, so a reader sees compaction coming before it happens. The
 * ring turns to the attention colour past @warnAt.
 */
export class ContextRing extends Component<ContextRingSignature> {
  get share(): number {
    let { used, limit } = this.args;
    return limit > 0 ? Math.min(Math.max(used / limit, 0), 1) : 0;
  }
  get percent(): number {
    return Math.round(this.share * 100);
  }
  get warns(): boolean {
    return this.share >= (this.args.warnAt ?? 0.8);
  }
  get ringStyle() {
    return htmlSafe(`--pretui-ring-share: ${this.share * 360}deg`);
  }
  get label(): string {
    return `Context ${this.percent}% used: ${compact(this.args.used)} of ${compact(this.args.limit)} tokens`;
  }
  <template>
    <span
      class='pretui-contextring'
      role='img'
      aria-label={{this.label}}
      title={{this.label}}
      data-warn={{if this.warns 'true'}}
      data-test-pretui-context-ring
      ...attributes
    >
      <span class='pretui-contextring-ring' style={{this.ringStyle}} aria-hidden='true'></span>
      {{#unless @compact}}<span class='pretui-contextring-pct' aria-hidden='true'>{{this.percent}}%</span>{{/unless}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-contextring {
          display: inline-flex;
          align-items: center;
          gap: var(--step-4, 4px);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-variant-numeric: tabular-nums;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-contextring-ring {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: conic-gradient(
            var(--pretui-contextring-ink, var(--ink-2, var(--muted-foreground)))
              var(--pretui-ring-share),
            var(--border-strong, var(--border)) 0
          );
          -webkit-mask: radial-gradient(circle, transparent 4px, #000 4.5px);
          mask: radial-gradient(circle, transparent 4px, #000 4.5px);
        }
        /* past the warning share the ring (the mark) takes the attention
           state; the digits step up to ink-1 */
        .pretui-contextring[data-warn] {
          --pretui-contextring-ink: var(
            --state-attention,
            var(--pretui-attention)
          );
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
