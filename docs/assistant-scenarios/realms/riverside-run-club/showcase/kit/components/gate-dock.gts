// Pretui — GateDock: the decisions waiting on the reader, above the composer, when their rows are out of view.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

export interface GateDockSignature {
  Args: {
    /** how many decisions wait */
    count: number;
    /** what waits, in a word: 'question', 'approval'. Default 'decision' */
    noun?: string;
    /** what else is going on, said after: 'nothing else running' */
    note?: string;
    /** bring the waiting row into view */
    onJump?: () => void;
    /** settle every waiting call at once; offered only for approvals */
    onApproveAll?: () => unknown;
    /** open the calls to review one by one */
    onReview?: () => void;
    onDecline?: () => unknown;
  };
  Element: HTMLDivElement;
}

/**
 * "● 1 question waiting · Jump ↓". A gate is asked in its row; when that
 * row has scrolled out of view the dock says it is there, so a waiting run
 * is never only somewhere above. For several approvals it offers the bulk
 * answers too: Approve all · Review · Decline.
 */
export class GateDock extends Component<GateDockSignature> {
  @tracked busy = false;
  get text(): string {
    let n = this.args.count;
    let noun = this.args.noun ?? 'decision';
    return `${n} ${noun}${n === 1 ? '' : 's'} waiting`;
  }
  jump = () => this.args.onJump?.();
  review = () => this.args.onReview?.();
  private run = async (action?: () => unknown) => {
    if (!action || this.busy) {
      return;
    }
    this.busy = true;
    try {
      await action();
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.busy = false;
      }
    }
  };
  approveAll = () => this.run(this.args.onApproveAll);
  decline = () => this.run(this.args.onDecline);
  <template>
    <div
      class='pretui-gatedock'
      role='status'
      aria-busy={{if this.busy 'true'}}
      data-test-pretui-gate-dock
      ...attributes
    >
      <span class='pretui-gatedock-dot' aria-hidden='true'></span>
      <span class='pretui-gatedock-text'>{{this.text}}{{#if @note}}<span
            class='pretui-gatedock-note'
          > · {{@note}}</span>{{/if}}</span>
      <span class='pretui-gatedock-actions'>
        {{#if @onApproveAll}}
          <button
            type='button'
            class='pretui-gatedock-action'
            data-kind='primary'
            disabled={{this.busy}}
            data-test-pretui-gate-dock-approve
            {{on 'click' this.approveAll}}
          >Approve all</button>
        {{/if}}
        {{#if @onReview}}
          <button
            type='button'
            class='pretui-gatedock-action'
            disabled={{this.busy}}
            data-test-pretui-gate-dock-review
            {{on 'click' this.review}}
          >Review</button>
        {{/if}}
        {{#if @onDecline}}
          <button
            type='button'
            class='pretui-gatedock-action'
            data-kind='quiet'
            disabled={{this.busy}}
            data-test-pretui-gate-dock-decline
            {{on 'click' this.decline}}
          >Decline</button>
        {{/if}}
        {{#if @onJump}}
          <button
            type='button'
            class='pretui-gatedock-action'
            data-kind='quiet'
            data-test-pretui-gate-dock-jump
            {{on 'click' this.jump}}
          >Jump ↓</button>
        {{/if}}
      </span>
    </div>
    <style scoped>
      @layer PretComponent {
        /* needs you: the edge and the dot take the attention state; the
           fill stays the card, so the state never colours the whole row */
        .pretui-gatedock {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--step-4, 4px) var(--step-8, 8px);
          min-height: 36px;
          padding: var(--step-4, 4px) var(--step-4, 4px) var(--step-4, 4px)
            var(--step-12, 12px);
          border-radius: var(--round-row, 8px);
          background: var(--card);
          box-shadow: inset 0 0 0 1px
            var(--state-attention, var(--pretui-attention));
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--foreground);
        }
        .pretui-gatedock-dot {
          flex: none;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--state-attention, var(--pretui-attention));
        }
        .pretui-gatedock-text {
          flex: 1 1 auto;
          min-width: 0;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .pretui-gatedock-note {
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-gatedock-actions {
          display: flex;
          gap: var(--step-4, 4px);
          margin-inline-start: auto;
        }
        .pretui-gatedock-action {
          height: 28px;
          padding: 0 var(--step-12, 12px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          font: inherit;
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
          white-space: nowrap;
        }
        /* Approve all is the one answer */
        .pretui-gatedock-action[data-kind='primary'] {
          box-shadow: none;
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .pretui-gatedock-action[data-kind='quiet'] {
          box-shadow: none;
          font-weight: 400;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-gatedock-action[data-kind='quiet']:hover {
          color: var(--foreground);
        }
        .pretui-gatedock-action:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-gatedock-action:disabled {
          cursor: default;
          opacity: 0.6;
        }
      }
    </style>
  </template>
}
