// Pretui — Token: a machine value set as jewelry — an id, a key, a code (Law 3).
import Component from '@glimmer/component';
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
    /** house scale xs|s|m|l|xl; omitted or 'default', Chip's size */
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
  // `@hue` is written through the CSSOM, on top of any `style` a caller
  // passes, rather than in a `style` attribute, which a strict Content
  // Security Policy refuses. A caller string, so it goes through `cssValue`.
  get keptStyle(): KeptProperty[] {
    return [
      {
        property: HUE_PROPERTY,
        value: cssValue(this.args.hue),
        strength: 'arg',
      },
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
      data-size={{this.size}}
      data-wrap={{if @wrap 'true'}}
      data-test-pretui-token
      {{keepStyle this.keptStyle}}
      ...attributes
    >
      {{#if @value}}{{@value}}{{else}}{{yield}}{{/if}}
    </code>
    <style scoped>
      @layer PretComponent {
        /* Chip's radius, padding and height, so the two line up side by side,
           but outlined on --card where Chip is filled with --muted: a value,
           not a label. --pretui-token-hue is the text color; callers set it on
           the Token or an ancestor, so it is read with a fallback rather than
           declared here. */
        .pretui-token {
          display: inline-block;
          margin-inline: 0.35ch;
          vertical-align: baseline;
          font-family: var(--font-mono);
          font-size: var(--pretui-token-font-size, var(--boxel-font-size-2xs));
          /* 18px, matching Chip, until the text needs more */
          line-height: max(1.125rem, 1.5em);
          padding: 0 var(--boxel-sp-2xs);
          border-radius: var(--boxel-border-radius-xs);
          background-color: var(--card);
          color: var(--pretui-token-hue, var(--card-foreground));
          box-shadow: inset 0 0 0 1px var(--border);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        /* size scale, the same steps as Autocomplete's; the ladder has no
           step under 11px, so xs and s share it */
        .pretui-token[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--boxel-font-size-2xs));
        }
        .pretui-token[data-size='s'] {
          font-size: var(--pretui-size-s, var(--boxel-font-size-2xs));
        }
        .pretui-token[data-size='m'] {
          font-size: var(--pretui-size-m, var(--boxel-font-size-xs));
        }
        .pretui-token[data-size='l'] {
          font-size: var(--pretui-size-l, var(--boxel-font-size-sm));
        }
        .pretui-token[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--boxel-font-size));
        }
        .pretui-token[data-wrap] {
          white-space: normal;
          overflow-wrap: anywhere;
        }
        :where(td, dd) > .pretui-token {
          margin-inline: 0;
        }
      }
    </style>
  </template>
}
