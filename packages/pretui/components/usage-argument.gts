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
      <tr class='FreestyleUsageArgument'>
        <td class='FreestyleUsageArgument-name'>
          <span class='u-sig'>{{this.sigilPre}}</span>{{#if @name}}{{@name}}{{/if}}<span
            class='u-sig'
          >{{this.sigilPost}}</span>
          {{#if @required}}<span class='u-req' title='Required'>*</span>{{/if}}
        </td>
        <td class='FreestyleUsageArgument-type'>{{this.typeLabel}}</td>
        <td class='FreestyleUsageArgument-description'>{{@description}}</td>
        <td class='FreestyleUsageArgument-default'>
          {{#if this.shouldRenderDefaultValue}}
            {{this.defaultText}}
          {{else}}
            <span class='u-none'>—</span>
          {{/if}}
        </td>
      </tr>
    {{/if}}
    <style scoped>
      .FreestyleUsageArgument-name {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        white-space: nowrap;
        width: 1%;
      }
      .u-sig {
        color: var(--ink-3, var(--boxel-400));
      }
      .u-req {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .FreestyleUsageArgument-type {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        white-space: nowrap;
        width: 1%;
        text-transform: lowercase;
      }
      .FreestyleUsageArgument-description {
        color: var(--foreground);
        max-width: 520px;
      }
      .FreestyleUsageArgument-default {
        font-family: var(--font-mono);
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
        text-align: right;
        white-space: nowrap;
        width: 1%;
      }
      .u-none {
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}
