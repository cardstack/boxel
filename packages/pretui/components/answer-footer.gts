// Pretui — AnswerFooter: the quiet actions under an assistant's final reply.
import Component from '@glimmer/component';
import XIcon from '@cardstack/boxel-icons/x';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { CopyButton } from './copy-button';

export interface AnswerFooterDiff {
  files: number;
  added: number;
  removed: number;
}

export interface AnswerFooterSignature {
  Args: {
    /** the reply as markdown, for Copy */
    text: string;
    /** keep the reply as a card; resolves to the saved card's name, which
     * the footer then shows in the button's place */
    onSave?: () => Promise<string | void>;
    /** open what was saved */
    onOpenSaved?: () => void;
    /** what the turn changed, summed; its button opens the review */
    diff?: AnswerFooterDiff;
    onReview?: (from: HTMLElement) => void;
    /** ask again */
    onRetry?: () => void;
    /** what the turn cost, as the caller words it: '18 credits' */
    cost?: string;
    /** a later answer took over: the footer keeps its space but steps out
     * of sight until the pointer or focus comes to it (or to whatever the
     * host lets set `--pretui-answerfooter-reveal: 1`) */
    superseded?: boolean;
  };
  Element: HTMLDivElement;
}

/**
 * Copy · Save as card · 1 file +3 −1 · Review · Retry ··· 18 credits.
 * Always there, in the muted ink, so it takes its line without competing
 * with the answer above it; each action takes the foreground under the
 * pointer or focus.
 */
export class AnswerFooter extends Component<AnswerFooterSignature> {
  @tracked saving = false;
  @tracked savedName: string | undefined;
  @tracked saveError: string | undefined;

  get files(): string {
    let n = this.args.diff?.files ?? 0;
    return `${n} ${n === 1 ? 'file' : 'files'}`;
  }

  save = async () => {
    if (!this.args.onSave || this.saving || this.savedName) {
      return;
    }
    this.saving = true;
    this.saveError = undefined;
    try {
      this.savedName = (await this.args.onSave()) || 'card';
    } catch (e) {
      this.saveError = e instanceof Error ? e.message : String(e);
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.saving = false;
      }
    }
  };
  openSaved = () => this.args.onOpenSaved?.();
  review = (event: Event) =>
    this.args.onReview?.(event.currentTarget as HTMLElement);
  retry = () => this.args.onRetry?.();

  <template>
    <div
      class='pretui-answerfooter'
      data-superseded={{if @superseded 'true'}}
      data-test-pretui-answer-footer
      ...attributes
    >
      <CopyButton
        class='pretui-answerfooter-copy'
        @text={{@text}}
        @label='Copy answer'
        @appearance='plain'
        @size='s'
        data-test-pretui-answer-copy
      />
      {{#if this.savedName}}
        <button
          type='button'
          class='pretui-answerfooter-action'
          data-test-pretui-answer-saved
          {{on 'click' this.openSaved}}
        >Saved · {{this.savedName}}</button>
      {{else if @onSave}}
        <button
          type='button'
          class='pretui-answerfooter-action'
          disabled={{this.saving}}
          aria-busy={{if this.saving 'true'}}
          data-test-pretui-answer-save
          {{on 'click' this.save}}
        >{{if this.saving 'Saving…' 'Save as card'}}</button>
      {{/if}}
      {{#if @diff}}
        <button
          type='button'
          class='pretui-answerfooter-action'
          data-diff='true'
          data-test-pretui-answer-diff
          {{on 'click' this.review}}
        >{{this.files}}
          <span
            class='pretui-answerfooter-count'
            data-op='add'
          >+{{@diff.added}}</span>
          <span
            class='pretui-answerfooter-count'
            data-op='del'
          >−{{@diff.removed}}</span>
          · Review</button>
      {{/if}}
      {{#if @onRetry}}
        <button
          type='button'
          class='pretui-answerfooter-action'
          data-test-pretui-answer-retry
          {{on 'click' this.retry}}
        >Retry</button>
      {{/if}}
      {{#if this.saveError}}
        <span class='pretui-answerfooter-error' role='status'><XIcon
            class='pretui-answerfooter-error-mark'
            width='11'
            height='11'
            aria-hidden='true'
          />{{this.saveError}}</span>
      {{/if}}
      {{#if @cost}}
        <span
          class='pretui-answerfooter-cost'
          data-test-pretui-answer-cost
        >{{@cost}}</span>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-answerfooter[data-superseded] {
          opacity: var(--pretui-answerfooter-reveal, 0);
          transition: opacity var(--pretui-dur-snap, 130ms) ease-out;
        }
        .pretui-answerfooter[data-superseded]:is(:hover, :focus-within) {
          opacity: 1;
        }
        .pretui-answerfooter {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 2px;
          min-height: 28px;
          /* plain-row hang: the first action's text stays on the edge */
          margin-inline-start: calc(-1 * var(--boxel-sp-xs));
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--subtle-foreground);
        }
        .pretui-answerfooter-copy {
          color: inherit;
        }
        .pretui-answerfooter-action {
          height: 28px;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background: none;
          font: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          color: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        .pretui-answerfooter-action:hover:not(:disabled) {
          background: var(--hover, var(--inset, var(--boxel-100)));
          color: var(--primary-ink);
        }
        .pretui-answerfooter-action:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-answerfooter-action:disabled {
          cursor: default;
        }
        .pretui-answerfooter-action[data-diff] {
          font-variant-numeric: tabular-nums;
        }
        .pretui-answerfooter-count[data-op='add'] {
          color: var(--success, var(--boxel-highlight));
        }
        .pretui-answerfooter-count[data-op='del'] {
          color: var(--destructive-ink);
        }
        /* a failure colours its mark, not its words */
        .pretui-answerfooter-error {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--foreground);
        }
        .pretui-answerfooter-error-mark {
          margin-inline-end: var(--boxel-sp-4xs);
          vertical-align: -1px;
          color: var(--destructive-ink);
        }
        /* a receipt, not a string to paste: sans with tabular figures */
        .pretui-answerfooter-cost {
          margin-inline-start: auto;
          padding-inline-end: 2px;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
        }
      }
    </style>
  </template>
}
