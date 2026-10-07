// Pretui — Token: a machine value set as jewelry — an id, a key, a code (Law 3).
import Component from '@glimmer/component';
import { hueStyle } from '../internal/ink';
import { keepStyle, type KeptProperty } from '../internal/keep-style';
import { cssValue } from '../pretui-css';
import {
  resolveSize,
  type PretuiSize,
  type PretuiSizeArg,
} from '../pretui-primitives';

export interface TokenSignature {
  Args: {
    value?: string;
    hue?: string;
    /** house scale xs|s|m|l|xl; omitted or 'default', the size is `--boxel-font-size-xs` */
    size?: PretuiSizeArg;
    /** let a long value wrap instead of overflowing on one line */
    wrap?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

const HUE_PROPERTY = '--pretui-token-hue';

// Law 3 — a machine value set like jewelry: mono pill, inline in prose.
// Carries .35ch side margins; flush (margin 0) as a direct cell/dd child.
export class Token extends Component<TokenSignature> {
  get style() {
    return hueStyle(HUE_PROPERTY, this.args.hue);
  }
  // The same property again, kept on top of a caller's `style`: @hue wins over
  // the caller's hue, and the caller's comes back when @hue is cleared.
  get keptStyle(): KeptProperty[] {
    return [
      { property: HUE_PROPERTY, value: cssValue(this.args.hue), strength: 'arg' },
    ];
  }
  // 'default' is the component's own default, which for Token is no step.
  get size(): PretuiSize | undefined {
    let { size } = this.args;
    return size === undefined || size === 'default'
      ? undefined
      : resolveSize(size);
  }
  <template>
    <code
      class='pretui-token'
      style={{this.style}}
      data-size={{this.size}}
      data-wrap={{if @wrap 'true'}}
      {{keepStyle this.keptStyle}}
      data-test-pretui-token
      ...attributes
    >
      {{#if @value}}{{@value}}{{else}}{{yield}}{{/if}}
    </code>
    <style scoped>
      @layer PretComponent {
        .pretui-token {
          --_th: var(--pretui-token-hue, var(--primary-ink));
          display: inline-block;
          margin-inline: 0.35ch;
          vertical-align: baseline;
          font-family: var(--font-mono);
          font-size: var(--pretui-token-font-size, var(--boxel-font-size-xs));
          line-height: 1.5;
          padding: 0 var(--boxel-sp-3xs);
          border-radius: var(--boxel-border-radius-xs);
          background-color: color-mix(in oklch, var(--_th) 8%, var(--card));
          color: var(--foreground);
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--_th) 30%, var(--border));
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        /* size scale: the steps of the Boxel font-size ladder */
        .pretui-token[data-size='xs'] {
          font-size: var(--boxel-font-size-2xs);
        }
        .pretui-token[data-size='s'] {
          font-size: var(--boxel-font-size-xs);
        }
        .pretui-token[data-size='m'] {
          font-size: var(--boxel-font-size-sm);
        }
        .pretui-token[data-size='l'] {
          font-size: var(--boxel-font-size);
        }
        .pretui-token[data-size='xl'] {
          font-size: var(--boxel-font-size-md);
        }
        .pretui-token[data-wrap] {
          white-space: normal;
          overflow-wrap: break-word;
        }
        :where(td, dd) > .pretui-token {
          margin-inline: 0;
        }
      }
    </style>
  </template>
}
