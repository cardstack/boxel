// Pretui — Token: a machine value set as jewelry — an id, a key, a code (Law 3).
import Component from '@glimmer/component';
import { hueStyle } from '../internal/ink';

export interface TokenSignature {
  Args: { value?: string; hue?: string };
  Blocks: { default: [] };
  Element: HTMLElement;
}

// Law 3 — a machine value set like jewelry: mono pill, inline in prose.
// Carries .35ch side margins; flush (margin 0) as a direct cell/dd child.
export class Token extends Component<TokenSignature> {
  get style() {
    return hueStyle('--pretui-token-hue', this.args.hue);
  }
  <template>
    <code class='pretui-token' style={{this.style}} data-test-pretui-token ...attributes>
      {{#if @value}}{{@value}}{{else}}{{yield}}{{/if}}
    </code>
    <style scoped>
      .pretui-token {
        --_th: var(--pretui-token-hue, var(--pretui-primary-ink, var(--primary)));
        display: inline-block;
        margin-inline: 0.35ch;
        vertical-align: baseline;
        font-family: var(--font-mono);
        font-size: calc(var(--text-body, 15px) - 3.5px);
        line-height: 1.5;
        padding: 0 5px;
        border-radius: 4px;
        background: color-mix(in oklch, var(--_th) 8%, var(--card));
        color: color-mix(in oklch, var(--foreground) 26%, var(--_th));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--_th) 30%, var(--border));
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      :where(td, dd) > .pretui-token {
        margin-inline: 0;
      }
    </style>
  </template>
}
