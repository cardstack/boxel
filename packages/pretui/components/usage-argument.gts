// Pretui — UsageArgument: one documented argument row (doc lens: table row; prop lens: nothing).
import Component from '@glimmer/component';
import { VisuallyHidden } from './visually-hidden';
import { isPresent, readOnlyText } from '../internal/freestyle';
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
    return readOnlyText(this.args.defaultValue);
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
        {{! the name heads the row, so each cell is announced with it }}
        <th scope='row' class='pretui-usage-arg-name'>
          <span class='u-sig'>{{this.sigilPre}}</span>{{#if
            @name
          }}{{@name}}{{/if}}<span class='u-sig'>{{this.sigilPost}}</span>
          {{#if @required}}<span
              class='u-req'
              aria-hidden='true'
              data-test-pretui-usage-arg-required
            >*</span><VisuallyHidden> (required)</VisuallyHidden>{{/if}}
        </th>
        <td class='pretui-usage-arg-type'>{{this.typeLabel}}</td>
        <td><span
            class='pretui-usage-arg-description-text'
          >{{@description}}</span></td>
        <td class='pretui-usage-arg-default'>
          {{#if this.shouldRenderDefaultValue}}
            {{this.defaultText}}
          {{else}}
            —
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
        font-weight: inherit;
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
        color: var(--muted-foreground);
        white-space: nowrap;
        width: 1%;
      }
      /* on a span: table layout ignores max-width on a cell */
      .pretui-usage-arg-description-text {
        display: block;
        max-width: var(--pretui-usage-arg-description-max-w);
      }
      .pretui-usage-arg-default {
        font-family: var(--font-mono);
        color: var(--muted-foreground);
        text-align: end;
        white-space: nowrap;
        width: 1%;
      }
    </style>
  </template>
}
