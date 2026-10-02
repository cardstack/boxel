// Pretui — Mentions: a textarea that offers suggestions after a trigger character and inserts the chosen one.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { listen } from '../focus';

export interface MentionItem {
  id: string;
  label: string;
}

export interface MentionsSignature {
  Args: {
    /** Controlled text. Omit for uncontrolled. */
    value?: string;
    defaultValue?: string;
    /** Fires with the whole text on every change. */
    onChange?: (value: string) => void;
    /** The candidates. Filtered by the typed query unless `@onQuery` is set. */
    items: MentionItem[];
    /** Called with the query as it is typed — for a remote search that replaces `@items`. */
    onQuery?: (query: string) => void;
    /** Called with the item when one is inserted. */
    onMention?: (item: MentionItem) => void;
    /** The character that opens the suggestions (default '@'). */
    trigger?: string;
    /** The textarea's accessible name. */
    label?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    /** At most this many suggestions (default 8). */
    limit?: number;
  };
  Blocks: {
    /** One suggestion's face. Defaults to its label. */
    item: [item: MentionItem, active: boolean];
  };
  Element: HTMLDivElement;
}

interface Query {
  /** Index of the trigger character in the text. */
  start: number;
  /** Caret position, the end of the query. */
  end: number;
  text: string;
}

/**
 * Comments, composers and captions that refer to people or records by name.
 * The text stays a plain string — "@Ana Ruiz, can you check lot 7?" — so it
 * needs no contenteditable and survives copy, paste and undo like any other
 * textarea. `@onMention` reports each insertion for whoever stores the
 * references.
 *
 * A trigger character at the start of the text or after whitespace, followed
 * by a query with no spaces, opens the list. ArrowDown / ArrowUp move through
 * it, Enter or Tab inserts, Escape closes it for this query. The textarea
 * keeps focus throughout and points at the active suggestion with
 * `aria-activedescendant`, the combobox pattern's listbox half. The list
 * sits under the textarea rather than at the caret.
 */
export class Mentions extends Component<MentionsSignature> {
  private guid = guidFor(this);
  @tracked private internal = this.args.defaultValue ?? '';
  @tracked query: Query | undefined;
  @tracked activeIndex = 0;
  @tracked private dismissedAt: number | undefined;
  private textarea: HTMLTextAreaElement | null = null;

  get listId(): string {
    return this.guid + '-list';
  }
  get trigger(): string {
    return this.args.trigger ?? '@';
  }
  get value(): string {
    return this.args.value ?? this.internal;
  }
  get suggestions(): MentionItem[] {
    let query = this.query;
    if (!query) {
      return [];
    }
    let items = this.args.items ?? [];
    let limit = this.args.limit ?? 8;
    if (this.args.onQuery) {
      return items.slice(0, limit);
    }
    let needle = query.text.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(needle)).slice(0, limit);
  }
  get open(): boolean {
    return this.query !== undefined && this.suggestions.length > 0;
  }
  /** The active option, clamped: a remote `@items` can shrink under it. */
  get active(): number {
    return Math.min(this.activeIndex, Math.max(0, this.suggestions.length - 1));
  }
  get options(): { item: MentionItem; id: string; active: boolean; index: number }[] {
    return this.suggestions.map((item, index) => ({
      item,
      index,
      id: `${this.guid}-opt-${index}`,
      active: index === this.active,
    }));
  }
  get activeId(): string | undefined {
    return this.open ? `${this.guid}-opt-${this.active}` : undefined;
  }

  private setValue(next: string) {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onChange?.(next);
  }

  /** The query the caret is in, if any. */
  private readQuery(text: string, caret: number): Query | undefined {
    let trigger = this.trigger;
    // at caret 0 there is nothing before the caret to be a query
    let start = caret > 0 ? text.lastIndexOf(trigger, caret - 1) : -1;
    if (start < 0) {
      return undefined;
    }
    let before = start === 0 ? '' : text.charAt(start - 1);
    if (before && before.trim() !== '') {
      return undefined;
    }
    let body = text.slice(start + trigger.length, caret);
    if (body.includes(' ') || body.includes('\n')) {
      return undefined;
    }
    return { start, end: caret, text: body };
  }

  private refresh(el: HTMLTextAreaElement) {
    let query = this.readQuery(el.value, el.selectionStart ?? el.value.length);
    if (query && this.dismissedAt === query.start) {
      query = undefined;
    }
    let changed = query?.text !== this.query?.text || query?.start !== this.query?.start;
    this.query = query;
    if (changed) {
      this.activeIndex = 0;
      if (query) {
        this.args.onQuery?.(query.text);
      }
    }
  }

  private commitFrom(el: HTMLTextAreaElement) {
    this.setValue(el.value);
    // controlled: the owner decides what shows, so put back what it didn't take
    if (this.args.value !== undefined && el.value !== this.args.value) {
      el.value = this.args.value;
    }
  }

  onInput = (event: Event) => {
    let el = event.target as HTMLTextAreaElement;
    this.textarea = el;
    this.commitFrom(el);
    if (this.dismissedAt !== undefined && this.readQuery(el.value, el.selectionStart ?? 0)?.start !== this.dismissedAt) {
      this.dismissedAt = undefined;
    }
    this.refresh(el);
  };

  onCaret = (event: Event) => {
    let el = event.target as HTMLTextAreaElement;
    this.textarea = el;
    this.refresh(el);
  };

  onKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    // the Enter that confirms an IME composition belongs to the IME
    if (!this.open || event.isComposing || event.keyCode === 229) {
      return;
    }
    let count = this.suggestions.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = (this.active + 1) % count;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = (this.active - 1 + count) % count;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      let item = this.suggestions[this.active];
      if (item) {
        event.preventDefault();
        this.insert(item);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissedAt = this.query?.start;
      this.query = undefined;
    }
  };

  onBlur = () => {
    this.query = undefined;
  };

  // a press on the list must not blur the textarea, or the list closes
  // before the click lands; the choice itself happens on click
  holdFocus = (event: Event) => {
    event.preventDefault();
  };

  choose = (item: MentionItem) => {
    this.insert(item);
  };

  private insert(item: MentionItem) {
    let query = this.query;
    if (!query) {
      return;
    }
    let el = this.textarea;
    let text = el?.value ?? this.value;
    let after = text.slice(query.end);
    // one space after the mention, unless the text already continues with one
    let inserted = this.trigger + item.label + (/^\s/.test(after) ? '' : ' ');
    this.query = undefined;
    // the inserted mention must not reopen the list it just closed
    this.dismissedAt = query.start;
    if (el) {
      el.focus();
      el.setSelectionRange(query.start, query.end);
      // insertText goes through the editing stack, so Ctrl+Z undoes the
      // mention and what was typed before it; it fires `input`, which
      // commits the value through onInput
      let done = document.execCommand?.('insertText', false, inserted) ?? false;
      if (!done) {
        el.setRangeText(inserted, query.start, query.end, 'end');
        this.commitFrom(el);
      }
    } else {
      this.setValue(text.slice(0, query.start) + inserted + after);
    }
    this.query = undefined;
    this.args.onMention?.(item);
  }

  <template>
    <div class='pretui-mentions' data-test-pretui-mentions ...attributes>
      <textarea
        class='pretui-mentions-input'
        value={{this.value}}
        rows={{if @rows @rows 3}}
        placeholder={{@placeholder}}
        aria-label={{@label}}
        aria-autocomplete='list'
        aria-controls={{if this.open this.listId}}
        aria-activedescendant={{this.activeId}}
        disabled={{@disabled}}
        data-test-pretui-mentions-input
        {{on 'input' this.onInput}}
        {{on 'keydown' this.onKeydown}}
        {{on 'click' this.onCaret}}
        {{on 'keyup' this.onCaret}}
        {{on 'blur' this.onBlur}}
      ></textarea>
      {{#if this.open}}
        <ul class='pretui-mentions-list' id={{this.listId}} role='listbox' aria-label='Suggestions' data-test-pretui-mentions-list {{listen 'pointerdown' this.holdFocus}}>
          {{#each this.options as |opt|}}
            <li
              id={{opt.id}}
              class='pretui-mentions-option'
              role='option'
              aria-selected={{if opt.active 'true' 'false'}}
              data-test-pretui-mention-option={{opt.item.id}}
              {{on 'click' (fn this.choose opt.item)}}
            >
              {{#if (has-block 'item')}}{{yield opt.item opt.active to='item'}}{{else}}{{opt.item.label}}{{/if}}
            </li>
          {{/each}}
        </ul>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-mentions {
          position: relative;
          min-inline-size: 0;
        }
        .pretui-mentions-input {
          display: block;
          box-sizing: border-box;
          inline-size: 100%;
          padding: var(--space-3, 0.5rem);
          border: 0;
          border-radius: var(--radius-control, 6px);
          background: var(--input-background, var(--card));
          box-shadow: 0 0 0 1px var(--input, var(--border));
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 0.78rem);
          line-height: var(--leading-body, 1.5);
          resize: vertical;
        }
        .pretui-mentions-input:focus {
          outline: 0;
          box-shadow: 0 0 0 1px var(--ring), 0 0 0 3px color-mix(in oklch, var(--ring) 25%, transparent);
        }
        .pretui-mentions-list {
          position: absolute;
          inset-inline: 0;
          inset-block-start: calc(100% + 0.25rem);
          z-index: var(--pretui-z-dropdown, 60);
          max-block-size: 14rem;
          overflow-y: auto;
          margin: 0;
          padding: 0.25rem;
          list-style: none;
          border-radius: var(--radius-surface, 10px);
          background: var(--popover);
          color: var(--popover-foreground);
          box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.12));
          font-size: var(--text-ui-md, 0.78rem);
        }
        .pretui-mentions-option {
          padding: 0.375rem var(--space-3, 0.5rem);
          border-radius: var(--radius-control, 6px);
          cursor: pointer;
        }
        .pretui-mentions-option[aria-selected='true'] {
          background: var(--hover, color-mix(in oklch, var(--foreground) 8%, transparent));
        }
      }
    </style>
  </template>
}
