// Pretui — UserBubble: the reader's message, as a white bubble that knows its width, length and delivery.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { SpeakerLabel } from './speaker-label';
import { Tooltip } from './tooltip';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import { cssNumber, cssStyleFrom } from '../pretui-css';

export type UserBubbleDelivery =
  | 'sent'
  | 'pending'
  | 'steer'
  | 'queued'
  | 'rejected';

export interface UserBubbleSignature {
  Args: {
    /** the message, as text. Or pass the message as the default block
     * (rendered HTML, attachments), as the host does; with a block, still
     * pass `@text` (the message's source) for Edit to start from */
    text?: string;
    /** lines shown before "Show more". Default: all */
    maxLines?: number;
    /** where the message is: 'sent' (default, says nothing), 'pending'
     * (sending), 'steer' (read at the run's next step), 'queued' (sends
     * when the run ends), 'rejected' (not sent) */
    delivery?: UserBubbleDelivery;
    /** why a rejected message was not sent */
    reason?: string;
    /** send a rejected message again */
    onRetry?: () => void;
    /** edit the message, which rewinds the thread to it: the bubble turns
     * into an editor and hands the new text back. Edit shows only with
     * `@text`, the source it edits; an unchanged draft saves nothing */
    onEdit?: (text: string) => void;
    /** when, as the caller formats it; on hover */
    time?: string;
    /** the full date, as the caller formats it: a tooltip on the time */
    fullTime?: string;
    /** the time as an ISO string, for the time element's `datetime` */
    datetime?: string;
    /** who posted it. Shown above the bubble, so a room where several
     * people talk to the same assistant reads as one conversation with
     * names, not as a special case */
    author?: string;
    /** the reader's own message: the label says "You" */
    self?: boolean;
    /** the same person as the message above: the name is not repeated */
    continued?: boolean;
  };
  Blocks: {
    /** the message itself, when it is more than text */
    default: [];
    /** the author's avatar over the bubble (the host's profile mark), in
     * place of their initial */
    avatar: [];
    /** the context sent with it (CardPills), only when it changed from the
     * turn before */
    context: [];
    /** what the reader attached to this message (CardPills, files),
     * inside the bubble above the text, as the composer showed them */
    attachments: [];
  };
  Element: HTMLDivElement;
}

const DELIVERY: Record<UserBubbleDelivery, string> = {
  sent: '',
  pending: 'Sending…',
  steer: 'Steers the run at its next step',
  queued: 'Queued · sends when the run ends',
  rejected: 'Not sent',
};

/**
 * The reader's message: main's white bubble in every theme, a share of the
 * panel's width that grows on a narrow panel (92% at 320, 80%, 70% from
 * 600), clamped to `@maxLines` with "Show more", and a quiet line under it
 * while it is not yet simply sent.
 */
export class UserBubble extends Component<UserBubbleSignature> {
  @tracked expanded = false;
  @tracked overflows = false;
  @tracked editing = false;
  @tracked draft = '';
  readonly textId = guidFor(this) + '-text';

  get delivery(): UserBubbleDelivery {
    return this.args.delivery ?? 'sent';
  }
  get deliveryText(): string {
    let text = DELIVERY[this.delivery];
    return this.delivery === 'rejected' && this.args.reason
      ? `${text} · ${this.args.reason}`
      : text;
  }
  get clampStyle() {
    let n = cssNumber(this.args.maxLines, 1, 1000);
    return n && !this.expanded
      ? cssStyleFrom([`--pretui-bubble-lines: ${Math.round(n)}`])
      : undefined;
  }
  /** Edit needs the message's source to start from */
  get canEdit(): boolean {
    return Boolean(this.args.onEdit) && this.args.text !== undefined;
  }
  /** nothing to save: an empty draft */
  get draftEmpty(): boolean {
    return this.draft.trim() === '';
  }
  /** the name over the bubble: the author, "You" for the reader's own,
   * none for a continued run */
  get authorName(): string | undefined {
    if (this.args.continued) {
      return undefined;
    }
    return this.args.self ? 'You' : this.args.author;
  }
  get canRetry(): boolean {
    return (
      this.delivery === 'rejected' &&
      Boolean(this.args.onRetry) &&
      !this.editing
    );
  }
  get clamped(): boolean {
    return Boolean(this.args.maxLines) && !this.expanded;
  }

  // a clamped message shows "Show more" only when it really is cut
  measure = modifier(
    (
      element: HTMLElement,
      [_text, _clamped]: [string | undefined, boolean],
    ) => {
      if (typeof ResizeObserver !== 'function') {
        return;
      }
      let check = () => {
        this.overflows = element.scrollHeight > element.clientHeight + 1;
      };
      let observer = new ResizeObserver(check);
      observer.observe(element);
      return () => observer.disconnect();
    },
  );

  toggle = () => (this.expanded = !this.expanded);
  retry = () => this.args.onRetry?.();
  /** set when the editor closes, so the Edit button that comes back takes
   * focus; plain, not tracked, because the modifier reads it once */
  private returnFocusToEdit = false;

  startEdit = () => {
    this.draft = this.args.text ?? '';
    this.editing = true;
  };
  private closeEditor() {
    this.returnFocusToEdit = true;
    this.editing = false;
  }
  cancelEdit = () => this.closeEditor();
  typeDraft = (event: Event) =>
    (this.draft = (event.target as HTMLTextAreaElement).value);
  /** an empty draft keeps the editor open; an unchanged one is a Cancel,
   * since saving rewinds the thread */
  saveEdit = () => {
    let text = this.draft.trim();
    if (!text) {
      return;
    }
    if (text !== (this.args.text ?? '').trim()) {
      this.args.onEdit?.(text);
    }
    this.closeEditor();
  };
  /** the editor's own keys stop here, so a host's document-level Escape
   * does not also run */
  editKey = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelEdit();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.saveEdit();
    }
  };
  focusField = modifier((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
  focusEditOnReturn = modifier((element: HTMLButtonElement) => {
    if (this.returnFocusToEdit) {
      this.returnFocusToEdit = false;
      element.focus();
    }
  });

  <template>
    <div
      class='pretui-bubble-turn'
      data-continued={{if @continued 'true'}}
      data-delivery={{this.delivery}}
      data-test-pretui-user-bubble={{this.delivery}}
      ...attributes
    >
      {{#if this.authorName}}
        {{#if (has-block 'avatar')}}
          <SpeakerLabel
            class='pretui-bubble-author'
            @name={{this.authorName}}
            @time={{@time}}
            @fullTime={{@fullTime}}
            @datetime={{@datetime}}
            data-test-pretui-user-bubble-author={{this.authorName}}
          >
            <:mark>{{yield to='avatar'}}</:mark>
          </SpeakerLabel>
        {{else}}
          <SpeakerLabel
            class='pretui-bubble-author'
            @name={{this.authorName}}
            @time={{@time}}
            @fullTime={{@fullTime}}
            @datetime={{@datetime}}
            data-test-pretui-user-bubble-author={{this.authorName}}
          />
        {{/if}}
      {{/if}}
      {{#if this.editing}}
        <div
          class='pretui-bubble pretui-bubble-editor'
          data-test-pretui-user-bubble-editor
        >
          <textarea
            class='pretui-bubble-field'
            aria-label='Edit your message'
            rows='3'
            value={{this.draft}}
            {{on 'input' this.typeDraft}}
            {{on 'keydown' this.editKey}}
            {{this.focusField}}
          ></textarea>
          <p class='pretui-bubble-editnote'>Saving rewinds the thread to this
            message.</p>
          <div class='pretui-bubble-editactions'>
            <button
              type='button'
              class='pretui-bubble-act'
              {{on 'click' this.cancelEdit}}
              data-test-pretui-user-bubble-cancel
            >Cancel</button>
            <button
              type='button'
              class='pretui-bubble-act'
              data-kind='primary'
              disabled={{this.draftEmpty}}
              {{on 'click' this.saveEdit}}
              data-test-pretui-user-bubble-save
            >Save and resend</button>
          </div>
        </div>
      {{else}}
        <div class='pretui-bubble'>
          {{#if (has-block 'attachments')}}
            <div
              class='pretui-bubble-attachments'
              data-test-pretui-user-bubble-attachments
            >{{yield to='attachments'}}</div>
          {{/if}}
          {{#if (has-block)}}
            <div
              class='pretui-bubble-text'
              data-rich='true'
              id={{this.textId}}
              data-clamped={{if this.clamped 'true'}}
              style={{this.clampStyle}}
              {{this.measure @text this.clamped}}
              data-test-pretui-user-bubble-text
            >{{yield}}</div>
          {{else}}
            <p
              class='pretui-bubble-text'
              id={{this.textId}}
              data-clamped={{if this.clamped 'true'}}
              style={{this.clampStyle}}
              {{this.measure @text this.clamped}}
              data-test-pretui-user-bubble-text
            >{{@text}}</p>
          {{/if}}
          {{#if (if @maxLines (if this.expanded true this.overflows))}}
            <button
              type='button'
              class='pretui-bubble-more'
              aria-expanded={{if this.expanded 'true' 'false'}}
              aria-controls={{this.textId}}
              {{on 'click' this.toggle}}
              data-test-pretui-user-bubble-more
            ><span>{{if
                  this.expanded
                  'Show less'
                  'Show more'
                }}</span><ChevronDownIcon
                class='pretui-bubble-more-icon'
                width='12'
                height='12'
                aria-hidden='true'
              /></button>
          {{/if}}
        </div>
      {{/if}}
      {{#if (has-block 'context')}}
        <div class='pretui-bubble-context'>{{yield to='context'}}</div>
      {{/if}}
      <div class='pretui-bubble-foot'>
        {{#if this.deliveryText}}
          <span
            class='pretui-bubble-delivery'
            role='status'
            data-test-pretui-user-bubble-delivery
          >{{this.deliveryText}}</span>
        {{/if}}
        {{#if this.canRetry}}
          <button
            type='button'
            class='pretui-bubble-link'
            {{on 'click' this.retry}}
            data-test-pretui-user-bubble-retry
          >Retry</button>
        {{/if}}
        {{#if this.canEdit}}{{#unless this.editing}}
            <button
              type='button'
              class='pretui-bubble-link pretui-bubble-hover'
              {{on 'click' this.startEdit}}
              {{this.focusEditOnReturn}}
              data-test-pretui-user-bubble-edit
            >Edit</button>
          {{/unless}}{{/if}}
        {{#if (if @time (if this.authorName false true))}}
          {{#if @fullTime}}
            <Tooltip @content={{@fullTime}} @side='right'>
              <time
                class='pretui-bubble-time pretui-bubble-hover'
                datetime={{@datetime}}
                tabindex='0'
                data-test-pretui-user-bubble-time
              >{{@time}}</time>
            </Tooltip>
          {{else}}
            <span
              class='pretui-bubble-time pretui-bubble-hover'
            >{{@time}}</span>
          {{/if}}
        {{/if}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        /* the turn row is full width and a size container, so the bubble's
           share follows the panel, not the window */
        .pretui-bubble-turn {
          container-type: inline-size;
          display: grid;
          /* left-justified, as main draws it: its one small corner, top
             left, points at the edge it hangs from */
          justify-items: start;
          gap: var(--boxel-sp-4xs);
        }
        /* a continued run sits closer to the message above it */
        .pretui-bubble-turn[data-continued] {
          margin-block-start: calc(
            -1 * var(--pretui-block-gap, var(--boxel-sp-sm)) +
              var(--boxel-sp-4xs)
          );
        }
        /* the reader's bubble steps back: the theme's inset with ink-1
           text at reading size, holding at 70% of the panel */
        .pretui-bubble {
          box-sizing: border-box;
          max-width: 70%;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-lg);
          border-top-left-radius: var(--boxel-border-radius-xs);
          background-color: var(--pretui-bubble-bg, var(--inset));
          color: var(--pretui-bubble-ink, var(--foreground));
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
          font-weight: 400;
        }
        .pretui-bubble-text {
          margin: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        /* rich content keeps its own blocks; only text pre-wraps */
        .pretui-bubble-text[data-rich] {
          white-space: normal;
        }
        .pretui-bubble-text[data-rich] > :deep(:first-child) {
          margin-top: 0;
        }
        .pretui-bubble-text[data-rich] > :deep(:last-child) {
          margin-bottom: 0;
        }
        .pretui-bubble-text[data-clamped] {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: var(--pretui-bubble-lines);
          overflow: hidden;
        }
        .pretui-bubble-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
          margin-bottom: var(--boxel-sp-xs);
        }
        /* a host that always passes the block, with nothing to attach this
           time, gets no empty line */
        .pretui-bubble-attachments:empty {
          display: none;
        }
        /* a clamped message fades into its Show more, so the cut reads as a
           cut */
        .pretui-bubble-text[data-clamped] {
          mask-image: linear-gradient(
            to bottom,
            black calc(100% - var(--boxel-body-line-height)),
            color-mix(in srgb, black 35%, transparent)
          );
        }
        /* Show more: a quiet control in ink-2 with a chevron, so it never
           reads as the message's last word */
        .pretui-bubble-more {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-6xs);
          margin-top: var(--boxel-sp-4xs);
          margin-inline-start: calc(-1 * var(--boxel-sp-xs));
          height: 1.5rem;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-bubble-more:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
        .pretui-bubble-more[aria-expanded='true'] .pretui-bubble-more-icon {
          transform: rotate(180deg);
        }
        /* not yet delivered: the text steps down to ink-2; the line under
           the bubble says why */
        .pretui-bubble-turn[data-delivery='pending'] .pretui-bubble,
        .pretui-bubble-turn[data-delivery='queued'] .pretui-bubble {
          color: var(--muted-foreground);
        }
        .pretui-bubble-context {
          display: flex;
          justify-content: flex-start;
          max-width: 92%;
        }
        .pretui-bubble-foot {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--subtle-foreground);
        }
        /* a state colours the word, never the bubble */
        .pretui-bubble-turn[data-delivery='steer'] .pretui-bubble-delivery {
          color: var(--attention-ink);
        }
        .pretui-bubble-turn[data-delivery='rejected'] .pretui-bubble-delivery {
          color: var(--destructive-ink);
        }
        /* a text action, 1.5rem tall so it is a whole pointer target */
        .pretui-bubble-link {
          display: inline-flex;
          align-items: center;
          min-height: 1.5rem;
          padding: 0;
          border: 0;
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          font-weight: 600;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-bubble-link:hover {
          color: var(--foreground);
        }
        .pretui-bubble-link:focus-visible,
        .pretui-bubble-time:focus-visible,
        .pretui-bubble-more:focus-visible,
        .pretui-bubble-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* a sent message's foot holds only hover items: it takes no line,
           and they hang in the gap below the bubble */
        .pretui-bubble-turn[data-delivery='sent'] .pretui-bubble-foot {
          height: 0;
          margin-top: calc(-1 * var(--boxel-sp-4xs));
          overflow: visible;
        }
        /* edit and the time are for the reader who looks for them */
        .pretui-bubble-hover {
          opacity: 0;
        }
        .pretui-bubble-turn:hover .pretui-bubble-hover,
        .pretui-bubble-turn:focus-within .pretui-bubble-hover {
          opacity: 1;
        }
        @media (hover: none) {
          .pretui-bubble-hover {
            opacity: 1;
          }
        }
        .pretui-bubble-editor {
          display: grid;
          gap: var(--boxel-sp-xs);
          width: 100%;
          max-width: 100%;
        }
        .pretui-bubble-field {
          box-sizing: border-box;
          width: 100%;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--field);
          box-shadow: inset 0 0 0 1px var(--border);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          color: inherit;
          resize: vertical;
        }
        .pretui-bubble-field:focus {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-bubble-editnote {
          margin: 0;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
        }
        .pretui-bubble-editactions {
          display: flex;
          justify-content: flex-end;
          gap: var(--boxel-sp-xs);
        }
        .pretui-bubble-act {
          height: 1.75rem;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          box-shadow: inset 0 0 0 1px var(--border);
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          color: inherit;
          cursor: pointer;
        }
        /* Save and resend is the moment's one action */
        .pretui-bubble-act[data-kind='primary'] {
          box-shadow: none;
          background-color: var(--primary);
          color: var(--primary-foreground);
        }
        .pretui-bubble-act:disabled {
          opacity: 0.5;
          cursor: default;
        }
      }
    </style>
  </template>
}
