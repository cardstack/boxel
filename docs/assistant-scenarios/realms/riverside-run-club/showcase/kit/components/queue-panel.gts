// Pretui — QueuePanel: the messages waiting to send behind a run, reorderable and editable.
import Component from '@glimmer/component';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';
import XIcon from '@cardstack/boxel-icons/x';
import { StateGlyph } from './state-glyph';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';

export interface QueuedMessage {
  id: string;
  text: string;
}

export interface QueuePanelSignature {
  Args: {
    items: QueuedMessage[];
    /** the new order, by id */
    onReorder?: (ids: string[]) => void;
    /** a message's new text */
    onEdit?: (id: string, text: string) => void;
    /** take a message out of the queue */
    onRemove?: (id: string) => void;
    /** send the first one now, steering the run at its next step */
    onSendNow?: (id: string) => void;
    /** fold the panel to its one-line summary */
    defaultOpen?: boolean;
  };
  Element: HTMLDivElement;
}

/**
 * "2 messages queued" above the composer, opening to the queue itself:
 * each message in sending order, moved up or down, edited in place, taken
 * out, or the first one sent now to steer the run. The queue is otherwise
 * invisible, and a message the reader cannot see is one they think sent.
 */
export class QueuePanel extends Component<QueuePanelSignature> {
  @tracked open = this.args.defaultOpen ?? true;
  @tracked editing: string | undefined;
  @tracked draft = '';

  get summary(): string {
    let n = this.args.items.length;
    return `${n} ${n === 1 ? 'message' : 'messages'} queued`;
  }
  toggle = () => (this.open = !this.open);
  isFirst = (index: number) => index === 0;
  isLast = (index: number) => index === this.args.items.length - 1;
  isEditing = (id: string) => this.editing === id;
  position = (index: number) => index + 1;
  move = (index: number, by: number) => {
    let ids = this.args.items.map((i) => i.id);
    let to = index + by;
    if (to < 0 || to >= ids.length) {
      return;
    }
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    this.args.onReorder?.(ids);
  };
  up = (index: number) => this.move(index, -1);
  down = (index: number) => this.move(index, 1);
  remove = (id: string) => this.args.onRemove?.(id);
  sendNow = (id: string) => this.args.onSendNow?.(id);
  edit = (item: QueuedMessage) => {
    this.editing = item.id;
    this.draft = item.text;
  };
  typeDraft = (event: Event) =>
    (this.draft = (event.target as HTMLTextAreaElement).value);
  save = () => {
    if (this.editing && this.draft.trim()) {
      this.args.onEdit?.(this.editing, this.draft.trim());
    }
    this.editing = undefined;
  };
  cancel = () => (this.editing = undefined);
  editKey = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.save();
    }
  };
  focusField = modifier((element: HTMLTextAreaElement) => element.focus());
  <template>
    {{#if @items.length}}
      <div class='pretui-queue' data-open={{if this.open 'true'}} data-test-pretui-queue-panel ...attributes>
        <button
          type='button'
          class='pretui-queue-head'
          aria-expanded={{if this.open 'true' 'false'}}
          data-test-pretui-queue-toggle
          {{on 'click' this.toggle}}
        >
          <StateGlyph class='pretui-queue-glyph' @glyph='steer' />
          <span class='pretui-queue-summary'>{{this.summary}}</span>
          <span class='pretui-queue-note'>send when the run ends</span>
          <span class='pretui-queue-chevron' aria-hidden='true'></span>
        </button>
        {{#if this.open}}
          <ol class='pretui-queue-list' aria-label='Queued messages'>
            {{#each @items key='id' as |item index|}}
              <li class='pretui-queue-item' data-test-pretui-queue-item={{item.id}}>
                <span class='pretui-queue-n' aria-hidden='true'>{{this.position index}}</span>
                {{#if (this.isEditing item.id)}}
                  <textarea
                    class='pretui-queue-field'
                    aria-label='Edit queued message'
                    rows='2'
                    value={{this.draft}}
                    {{on 'input' this.typeDraft}}
                    {{on 'keydown' this.editKey}}
                    {{on 'blur' this.save}}
                    {{this.focusField}}
                  ></textarea>
                {{else}}
                  <span class='pretui-queue-text'>{{item.text}}</span>
                {{/if}}
                <span class='pretui-queue-actions'>
                  {{#if @onSendNow}}{{#if (this.isFirst index)}}
                    <button type='button' class='pretui-queue-act' data-test-pretui-queue-send-now {{on 'click' (fn this.sendNow item.id)}}>Send now</button>
                  {{/if}}{{/if}}
                  {{#if @onReorder}}
                    <button type='button' class='pretui-queue-act' aria-label='Move up' disabled={{this.isFirst index}} {{on 'click' (fn this.up index)}}><ArrowUpIcon width='13' height='13' /></button>
                    <button type='button' class='pretui-queue-act' aria-label='Move down' disabled={{this.isLast index}} data-test-pretui-queue-down {{on 'click' (fn this.down index)}}><ArrowDownIcon width='13' height='13' /></button>
                  {{/if}}
                  {{#if @onEdit}}
                    <button type='button' class='pretui-queue-act' aria-label='Edit' data-test-pretui-queue-edit {{on 'click' (fn this.edit item)}}>Edit</button>
                  {{/if}}
                  {{#if @onRemove}}
                    <button type='button' class='pretui-queue-act' aria-label='Remove from the queue' data-test-pretui-queue-remove {{on 'click' (fn this.remove item.id)}}><XIcon width='13' height='13' /></button>
                  {{/if}}
                </span>
              </li>
            {{/each}}
          </ol>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-queue {
          display: grid;
          border-radius: 10px;
          background: var(--card);
          box-shadow: 0 0 0 1px var(--border);
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-queue-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-height: 32px;
          padding: 0 10px;
          border: 0;
          border-radius: 10px;
          background: none;
          font: inherit;
          text-align: start;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-queue-head:hover {
          background: var(--hover, var(--inset));
        }
        .pretui-queue-glyph {
          font-family: var(--font-mono);
          color: var(--pretui-attention-ink, var(--pretui-attention, var(--boxel-fuschia)));
        }
        .pretui-queue-summary {
          font-weight: 500;
        }
        .pretui-queue-note {
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
        }
        .pretui-queue-chevron {
          width: 5px;
          height: 5px;
          margin-inline-start: auto;
          border-inline-end: 1.5px solid currentColor;
          border-block-end: 1.5px solid currentColor;
          transform: rotate(-45deg);
          color: var(--muted-foreground);
          transition: transform 160ms var(--pretui-ease-enter, ease-out);
        }
        .pretui-queue[data-open] .pretui-queue-chevron {
          transform: rotate(45deg);
        }
        .pretui-queue-list {
          display: grid;
          margin: 0;
          padding: 0 6px 6px;
          list-style: none;
        }
        .pretui-queue-item {
          display: grid;
          grid-template-columns: 16px minmax(0, 1fr) auto;
          align-items: baseline;
          gap: 8px;
          padding: 5px 4px;
          box-shadow: 0 -1px 0 var(--border);
        }
        .pretui-queue-n {
          text-align: center;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--subtle-foreground, var(--muted-foreground));
        }
        .pretui-queue-text {
          overflow-wrap: anywhere;
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
        }
        .pretui-queue-field {
          width: 100%;
          box-sizing: border-box;
          padding: 4px 6px;
          border: 0;
          border-radius: 6px;
          background: var(--field, var(--inset));
          box-shadow: inset 0 0 0 1px var(--input, var(--border));
          font: inherit;
          color: var(--foreground);
          resize: vertical;
        }
        .pretui-queue-field:focus {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-queue-actions {
          display: flex;
          gap: 2px;
        }
        .pretui-queue-act {
          min-width: 22px;
          height: 22px;
          padding: 0 5px;
          border: 0;
          border-radius: 5px;
          background: none;
          font: inherit;
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-queue-act:hover:not(:disabled) {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-queue-act:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .pretui-queue-act:focus-visible,
        .pretui-queue-head:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-queue-chevron {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
