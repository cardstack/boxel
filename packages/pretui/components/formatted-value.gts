// Pretui — FormattedValue: the visible/spoken pair every formatter renders through.
import Component from '@glimmer/component';
import { Token } from './token';

// ── FormattedValue — the shared visible/spoken pair ──────────────────────
// Exported as its own primitive because all three formatters (and anything
// else in the kit that abbreviates a value) need the same three things: the
// visible text, the optional sr-only mirror, and the optional Token dress.
export interface FormattedValueSignature {
  Args: {
    /** the visible, already-formatted text */
    text?: string;
    /** full-precision or spelled-out mirror for screen readers; when present the visible text is aria-hidden */
    spoken?: string;
    /** wear the Token dress (Law 3) instead of a prose numeral */
    token?: boolean;
    /** hue forwarded to Token when @token is set */
    hue?: string;
    /** marks the value as absent so the placeholder renders muted */
    empty?: boolean;
  };
  Element: HTMLSpanElement;
}

export class FormattedValue extends Component<FormattedValueSignature> {
  get hideVisible(): string | undefined {
    return this.args.spoken ? 'true' : undefined;
  }
  get emptyFlag(): string | undefined {
    return this.args.empty ? 'true' : undefined;
  }
  <template>
    <span
      class='pretui-fv'
      data-empty={{this.emptyFlag}}
      data-test-pretui-formatted-value
      ...attributes
    >
      <span class='pretui-fv-vis' aria-hidden={{this.hideVisible}}>
        {{#if @token}}<Token @value={{@text}} @hue={{@hue}} />{{else}}{{@text}}{{/if}}
      </span>
      {{#if @spoken}}<span class='pretui-fv-sr'>{{@spoken}}</span>{{/if}}
    </span>
    <style scoped>
      .pretui-fv {
        font-variant-numeric: tabular-nums;
      }
      .pretui-fv[data-empty='true'] {
        color: var(--muted-foreground);
      }
      .pretui-fv-vis {
        white-space: nowrap;
      }
      .pretui-fv-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    </style>
  </template>
}
