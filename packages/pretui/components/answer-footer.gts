// Pretui — AnswerFooter: the quiet actions under an assistant's final reply.
import Component from '@glimmer/component';
import XIcon from '@cardstack/boxel-icons/x';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { CopyButton } from './copy-button';
import { VisuallyHidden } from './visually-hidden';

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
     * the same button then shows, and opens with `@onOpenSaved` */
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
  /** one button saves, waits and then opens what was saved, so focus stays
   * on it through each step */
  pressSave = () => (this.savedName ? this.openSaved() : this.save());
  get saveText(): string {
    if (this.savedName) {
      return `Saved · ${this.savedName}`;
    }
    return this.saving ? 'Saving…' : 'Save as card';
  }
  /** what the status region says: the outcome of a save, once */
  get saveAnnouncement(): string {
    if (this.savedName) {
      return `Saved as ${this.savedName}`;
    }
    return this.saveError ? `Couldn’t save: ${this.saveError}` : '';
  }
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
      {{#if @onSave}}
        {{! aria-disabled, not disabled, while saving: a disabled button
            drops focus to the page }}
        <button
          type='button'
          class='pretui-answerfooter-action'
          aria-disabled={{if this.saving 'true'}}
          aria-busy={{if this.saving 'true'}}
          data-saved={{if this.savedName 'true'}}
          {{on 'click' this.pressSave}}
          data-test-pretui-answer-save
        >{{this.saveText}}</button>
        <VisuallyHidden
          role='status'
          aria-atomic='true'
          data-test-pretui-answer-save-status
        >{{this.saveAnnouncement}}</VisuallyHidden>
      {{/if}}
      {{#if @diff}}
        <button
          type='button'
          class='pretui-answerfooter-action'
          data-diff='true'
          {{on 'click' this.review}}
          data-test-pretui-answer-diff
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
          {{on 'click' this.retry}}
          data-test-pretui-answer-retry
        >Retry</button>
      {{/if}}
      {{#if this.saveError}}
        <span
          class='pretui-answerfooter-error'
          data-test-pretui-answer-save-error
        ><XIcon
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
          gap: var(--boxel-sp-6xs);
          min-height: 1.75rem;
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
          height: 1.75rem;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          color: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        .pretui-answerfooter-action:hover:not([aria-disabled='true']) {
          background-color: var(--hover);
          color: var(--primary-ink);
        }
        .pretui-answerfooter-action:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-answerfooter-action[aria-disabled='true'] {
          cursor: default;
        }
        .pretui-answerfooter-action[data-diff] {
          font-variant-numeric: tabular-nums;
        }
        .pretui-answerfooter-count[data-op='add'] {
          color: var(--success-ink);
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
          vertical-align: -0.0625rem;
          color: var(--destructive-ink);
        }
        /* a receipt, not a string to paste: sans with tabular figures */
        .pretui-answerfooter-cost {
          margin-inline-start: auto;
          padding-inline-end: var(--boxel-sp-6xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
        }
      }
    </style>
  </template>
}
