// Pretui — Delta: a signed change with its direction made legible.
import Component from '@glimmer/component';

export interface DeltaSignature {
  Args: { value: number | string; format?: (n: number) => string };
  Element: HTMLSpanElement;
}

// Signed delta — the pill-less Token variant: bare mono, colored by sign.
export class Delta extends Component<DeltaSignature> {
  get n() {
    return Number(this.args.value);
  }
  get sign() {
    return this.n > 0 ? 'up' : this.n < 0 ? 'down' : 'flat';
  }
  get text() {
    if (this.args.format) {
      return this.args.format(this.n);
    }
    return (this.n > 0 ? '+' : '') + this.n;
  }
  <template>
    <span class='pretui-delta' data-sign={{this.sign}} data-test-pretui-delta ...attributes>{{this.text}}</span>
    <style scoped>
      .pretui-delta {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
      }
      .pretui-delta[data-sign='up'] {
        color: var(--success, var(--boxel-success));
      }
      .pretui-delta[data-sign='down'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-delta[data-sign='flat'] {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
