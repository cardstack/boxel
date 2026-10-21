// Pretui — PatchBlock: a change the assistant proposes in its reply, applied only when the reader says so.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { DiffBlock, lineDiff } from './diff-block';
import type { DiffLine } from './diff-block';
import { CopyButton } from './copy-button';

export type PatchState = 'proposed' | 'applied' | 'reverted' | 'conflict';

export interface PatchBlockSignature {
  Args: {
    path: string;
    before?: string;
    after?: string;
    lines?: DiffLine[];
    /** 'proposed' (default), 'applied', 'reverted', or 'conflict' (the
     * file moved on since the patch was written) */
    state?: PatchState;
    /** the patch as text, for Copy */
    patch?: string;
    /** apply the patch; a returned promise keeps Apply busy */
    onApply?: () => unknown;
    onRevert?: () => unknown;
  };
  Element: HTMLDivElement;
}

const STATE_TEXT: Record<PatchState, string> = {
  proposed: 'Proposed',
  applied: 'Applied',
  reverted: 'Reverted',
  conflict: 'The file changed since this patch',
};

/**
 * A diff inside an answer, for a change the assistant suggests rather than
 * makes: "Proposed · relaunch.gts +1 · Apply". It changes nothing until
 * Apply; once applied it says so and offers Revert. A file that moved on
 * since the patch was written reads as a conflict, and Apply waits.
 */
export class PatchBlock extends Component<PatchBlockSignature> {
  @tracked busy = false;
  get state(): PatchState {
    return this.args.state ?? 'proposed';
  }
  get stateText(): string {
    return STATE_TEXT[this.state];
  }
  get lines(): DiffLine[] {
    return this.args.lines ?? lineDiff(this.args.before, this.args.after, { context: 2 });
  }
  get canApply(): boolean {
    return (this.state === 'proposed' || this.state === 'reverted') && Boolean(this.args.onApply);
  }
  get canRevert(): boolean {
    return this.state === 'applied' && Boolean(this.args.onRevert);
  }
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
  apply = () => this.run(this.args.onApply);
  revert = () => this.run(this.args.onRevert);
  <template>
    <div class='pretui-patch' data-state={{this.state}} data-test-pretui-patch-block={{this.state}} ...attributes>
      <div class='pretui-patch-head'>
        <span class='pretui-patch-state' role='status'>{{this.stateText}}</span>
        <span class='pretui-patch-actions'>
          {{#if @patch}}<CopyButton @text={{@patch}} @label='Copy patch' @appearance='plain' @size='s' />{{/if}}
          {{#if this.canApply}}
            <button type='button' class='pretui-patch-act' data-kind='primary' disabled={{this.busy}} aria-busy={{if this.busy 'true'}} data-test-pretui-patch-apply {{on 'click' this.apply}}>{{if this.busy 'Applying…' 'Apply'}}</button>
          {{/if}}
          {{#if this.canRevert}}
            <button type='button' class='pretui-patch-act' disabled={{this.busy}} data-test-pretui-patch-revert {{on 'click' this.revert}}>{{if this.busy 'Reverting…' 'Revert'}}</button>
          {{/if}}
        </span>
      </div>
      <DiffBlock @lines={{this.lines}} @filename={{@path}} @lineNumbers={{true}} @maxLines={{10}} @expandLabel='Show all' />
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-patch {
          display: grid;
          gap: var(--step-4, 4px);
        }
        .pretui-patch-head {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          min-height: 28px;
        }
        /* the state is a word, not a kicker: sans UI, sentence case */
        .pretui-patch-state {
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* applied is done: ink with a check, not green */
        .pretui-patch[data-state='applied'] .pretui-patch-state {
          color: var(--foreground);
        }
        .pretui-patch[data-state='applied'] .pretui-patch-state::before {
          content: '✓ ' / '';
        }
        /* a conflict needs the reader: the mark takes the attention colour,
           the words stay ink */
        .pretui-patch[data-state='conflict'] .pretui-patch-state {
          color: var(--foreground);
        }
        .pretui-patch[data-state='conflict'] .pretui-patch-state::before {
          content: '● ' / '';
          color: var(
            --state-attention,
            var(--pretui-attention-ink, var(--pretui-attention, var(--boxel-fuschia)))
          );
        }
        .pretui-patch-actions {
          display: flex;
          align-items: center;
          gap: var(--step-4, 4px);
          margin-inline-start: auto;
        }
        .pretui-patch-act {
          height: 28px;
          padding: 0 var(--step-12, 12px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-weight: 400;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-patch-act[data-kind='primary'] {
          box-shadow: none;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-dark));
        }
        .pretui-patch-act:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .pretui-patch-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
      }
    </style>
  </template>
}
