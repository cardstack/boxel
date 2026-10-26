// Pretui — UserBubble: the reader's message, as a white bubble that knows its width, length and delivery.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { SpeakerLabel } from './speaker-label';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';

export type UserBubbleDelivery =
  | 'sent'
  | 'pending'
  | 'steer'
  | 'queued'
  | 'rejected';

export interface UserBubbleSignature {
  Args: {
    /** the message, as text. Or pass the message as the default block
     * (rendered HTML, attachments), as the host does */
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
     * into an editor and hands the new text back */
    onEdit?: (text: string) => void;
    /** when, as the caller formats it; on hover */
    time?: string;
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
    let n = this.args.maxLines;
    return htmlSafe(n && !this.expanded ? `--pretui-bubble-lines: ${n}` : '');
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
  startEdit = () => {
    this.draft = this.args.text ?? '';
    this.editing = true;
  };
  cancelEdit = () => (this.editing = false);
  typeDraft = (event: Event) =>
    (this.draft = (event.target as HTMLTextAreaElement).value);
  saveEdit = () => {
    let text = this.draft.trim();
    if (text) {
      this.args.onEdit?.(text);
    }
    this.editing = false;
  };
  editKey = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key === 'Escape') {
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
            data-test-pretui-user-bubble-author={{this.authorName}}
          >
            <:mark>{{yield to='avatar'}}</:mark>
          </SpeakerLabel>
        {{else}}
          <SpeakerLabel
            class='pretui-bubble-author'
            @name={{this.authorName}}
            @time={{@time}}
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
            >Cancel</button>
            <button
              type='button'
              class='pretui-bubble-act'
              data-kind='primary'
              data-test-pretui-user-bubble-save
              {{on 'click' this.saveEdit}}
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
              data-test-pretui-user-bubble-text
              {{this.measure @text this.clamped}}
            >{{yield}}</div>
          {{else}}
            <p
              class='pretui-bubble-text'
              id={{this.textId}}
              data-clamped={{if this.clamped 'true'}}
              style={{this.clampStyle}}
              data-test-pretui-user-bubble-text
              {{this.measure @text this.clamped}}
            >{{@text}}</p>
          {{/if}}
          {{#if (if @maxLines (if this.expanded true this.overflows))}}
            <button
              type='button'
              class='pretui-bubble-more'
              aria-expanded={{if this.expanded 'true' 'false'}}
              aria-controls={{this.textId}}
              data-test-pretui-user-bubble-more
              {{on 'click' this.toggle}}
            ><span>{{if
                  this.expanded
                  'Show less'
                  'Show more'
                }}</span><ChevronDownIcon
                class='pretui-bubble-more-icon'
                width='12'
                height='12'
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
            data-test-pretui-user-bubble-retry
            {{on 'click' this.retry}}
          >Retry</button>
        {{/if}}
        {{#if @onEdit}}{{#unless this.editing}}
            <button
              type='button'
              class='pretui-bubble-link pretui-bubble-hover'
              data-test-pretui-user-bubble-edit
              {{on 'click' this.startEdit}}
            >Edit</button>
          {{/unless}}{{/if}}
        {{#if (if @time (if this.authorName false true))}}<span
            class='pretui-bubble-time pretui-bubble-hover'
          >{{@time}}</span>{{/if}}
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
          background: var(--pretui-bubble-bg, var(--inset, var(--muted)));
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
            #000 calc(100% - var(--boxel-body-line-height)),
            rgb(0 0 0 / 35%)
          );
        }
        /* Show more: a quiet control in ink-2 with a chevron, so it never
           reads as the message's last word */
        .pretui-bubble-more {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          margin-top: var(--boxel-sp-4xs);
          margin-inline-start: calc(-1 * var(--boxel-sp-xs));
          height: 22px;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background: none;
          font: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-bubble-more:hover {
          background: var(--hover);
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
        .pretui-bubble-link {
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-bubble-link:hover {
          color: var(--foreground);
        }
        .pretui-bubble-link:focus-visible,
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
          background: var(--field, var(--background));
          box-shadow: inset 0 0 0 1px var(--border);
          font: inherit;
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
          height: 28px;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border);
          font: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          color: inherit;
          cursor: pointer;
        }
        /* Save and resend is the moment's one action */
        .pretui-bubble-act[data-kind='primary'] {
          box-shadow: none;
          background: var(--primary);
          color: var(--primary-foreground);
        }
      }
    </style>
  </template>
}
