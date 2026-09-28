// Pretui — BrokenLink: an honest "this reference is gone" marker.
import Component from '@glimmer/component';

export interface BrokenLinkSignature {
  Args: { label?: string; refId?: string };
  Element: HTMLSpanElement;
}

// An honest "this reference is gone" (Boxel-specific obligation).
export class BrokenLink extends Component<BrokenLinkSignature> {
  get label() {
    return this.args.label ?? 'missing card';
  }
  <template>
    <span class='pretui-broken' title='This reference is gone' data-test-pretui-broken-link ...attributes>
      <svg width='11' height='11' viewBox='0 0 12 12' aria-hidden='true'><path d='M4.5 7.5 2.8 9.2a1.7 1.7 0 0 1-2.4-2.4L2.8 4.4M7.5 4.5l1.7-1.7a1.7 1.7 0 0 1 2.4 2.4L9.2 7.6M1 1l10 10' fill='none' stroke='currentColor' stroke-width='1.3' stroke-linecap='round' /></svg>
      <span>{{this.label}}</span>
      {{#if @refId}}<span class='pretui-broken-id'>{{@refId}}</span>{{/if}}
    </span>
    <style scoped>
      .pretui-broken {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 6px;
        background: var(--inset, var(--boxel-100));
        color: var(--ink-3, var(--boxel-400));
        font-size: var(--text-ui-sm, 11.5px);
        font-family: var(--font-mono);
        outline: 1px dashed var(--line-strong, var(--boxel-400));
        outline-offset: -1px;
        text-decoration: line-through;
        text-decoration-color: color-mix(in oklch, var(--ink-3, var(--boxel-400)) 50%, transparent);
      }
      .pretui-broken svg {
        flex: none;
      }
      .pretui-broken-id {
        opacity: 0.7;
      }
    </style>
  </template>
}
