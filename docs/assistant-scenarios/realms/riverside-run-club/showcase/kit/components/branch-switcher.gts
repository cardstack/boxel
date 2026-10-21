// Pretui — BranchSwitcher: the versions of one reply, after Regenerate.
import Component from '@glimmer/component';
import ChevronLeftIcon from '@cardstack/boxel-icons/chevron-left';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import { on } from '@ember/modifier';

export interface BranchSwitcherSignature {
  Args: {
    /** the version shown, from 0 */
    index: number;
    /** how many versions the reply has */
    count: number;
    onChange: (index: number) => void;
  };
  Element: HTMLSpanElement;
}

/**
 * "‹ 2 of 3 ›" beside a reply that was regenerated: each regenerated
 * reply is a branch of that one reply, and the reader steps between them.
 * (A fork is a new session from this point; that is SystemLine's.)
 */
export class BranchSwitcher extends Component<BranchSwitcherSignature> {
  get label(): string {
    return `${this.args.index + 1} of ${this.args.count}`;
  }
  get atStart() {
    return this.args.index <= 0;
  }
  get atEnd() {
    return this.args.index >= this.args.count - 1;
  }
  prev = () => !this.atStart && this.args.onChange(this.args.index - 1);
  next = () => !this.atEnd && this.args.onChange(this.args.index + 1);
  <template>
    {{#if (if @count true false)}}
      <span class='pretui-branch' role='group' aria-label='Reply versions' data-test-pretui-branch-switcher ...attributes>
        <button type='button' class='pretui-branch-step' aria-label='Previous version' disabled={{this.atStart}} data-test-pretui-branch-prev {{on 'click' this.prev}}><ChevronLeftIcon width='14' height='14' /></button>
        <span class='pretui-branch-pos' aria-live='polite' data-test-pretui-branch-position>{{this.label}}</span>
        <button type='button' class='pretui-branch-step' aria-label='Next version' disabled={{this.atEnd}} data-test-pretui-branch-next {{on 'click' this.next}}><ChevronRightIcon width='14' height='14' /></button>
      </span>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-branch {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-branch-step {
          width: 22px;
          height: 22px;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: none;
          font: inherit;
          font-size: 14px;
          line-height: 1;
          color: inherit;
          cursor: pointer;
        }
        .pretui-branch-step:hover:not(:disabled) {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-branch-step:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .pretui-branch-step:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
