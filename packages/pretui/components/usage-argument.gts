// Pretui — UsageArgument: one documented argument row (doc lens: table row; prop lens: nothing).
import Component from '@glimmer/component';
import { isPresent } from '../internal/freestyle';
import type { ArgsMode } from '../internal/freestyle';

// ── Freestyle::Usage::Argument (doc lens: table row; prop lens: nothing) ──
export interface UsageArgumentSignature {
  Args: {
    mode?: ArgsMode;
    name?: string;
    type?: string;
    typeLabel?: string;
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    optional?: boolean;
    hideControls?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export class UsageArgument extends Component<UsageArgumentSignature> {
  get isDoc() {
    return (this.args.mode ?? 'doc') === 'doc';
  }
  get typeLabel() {
    return this.args.typeLabel || this.args.type;
  }
  get shouldRenderDefaultValue() {
    return isPresent(this.args.defaultValue);
  }
  get defaultText() {
    return String(this.args.defaultValue);
  }
  // yields print as {{name}}, css vars bare (names carry --), args as @name
  get sigilPre() {
    if (this.args.type === 'Yield') return '{{';
    if (this.args.type === 'CSS' || this.args.typeLabel === 'CSS') return '';
    return '@';
  }
  get sigilPost() {
    return this.args.type === 'Yield' ? '}}' : '';
  }
  <template>
    {{#if this.isDoc}}
      <tr class='pretui-usage-arg' data-test-pretui-usage-arg>
        <td class='pretui-usage-arg-name'>
          <span class='u-sig'>{{this.sigilPre}}</span>{{#if
            @name
          }}{{@name}}{{/if}}<span class='u-sig'>{{this.sigilPost}}</span>
          {{#if @required}}<span
              class='u-req'
              title='Required'
              data-test-pretui-usage-arg-required
            >*</span>{{/if}}
        </td>
        <td class='pretui-usage-arg-type'>{{this.typeLabel}}</td>
        <td class='pretui-usage-arg-description'>{{@description}}</td>
        <td class='pretui-usage-arg-default'>
          {{#if this.shouldRenderDefaultValue}}
            {{this.defaultText}}
          {{else}}
            <span class='u-none'>—</span>
          {{/if}}
        </td>
      </tr>
    {{/if}}
    <style scoped>
      .pretui-usage-arg {
        --pretui-usage-arg-description-max-w: 32.5rem;
      }
      .pretui-usage-arg-name {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        white-space: nowrap;
        width: 1%;
      }
      .u-sig {
        color: var(--muted-foreground);
      }
      .u-req {
        color: var(--destructive-ink);
      }
      .pretui-usage-arg-type {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        white-space: nowrap;
        width: 1%;
        text-transform: lowercase;
      }
      .pretui-usage-arg-description {
        color: var(--foreground);
        max-width: var(--pretui-usage-arg-description-max-w);
      }
      .pretui-usage-arg-default {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        text-align: end;
        white-space: nowrap;
        width: 1%;
      }
      .u-none {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
