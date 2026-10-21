// Pretui — Composer: the message composer: text, attachments and a send mode.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import PlusIcon from '@cardstack/boxel-icons/plus';
import XIcon from '@cardstack/boxel-icons/x';
import { Button } from './button';
import { SegmentedControl } from './segmented-control';
import { cssStyleFrom } from '../pretui-css';

// ── Composer ─────────────────────────────────────────────────────────────
// The prompt bar. A single surface carrying four things a bare textarea
// cannot: the attachments the agent will actually see, the mode that decides
// whether it may write, a note stating that mode's consequence, and a
// placeholder that tells the truth while a run is in flight.
//
// Dropped from the extraction spec, deliberately, and named rather than
// hidden (Law 7): the settings popover (autonomy levels + three toggles) is
// a `<:tools>` slot here instead of a baked-in panel — autonomy is a host
// policy, and a kit component that hard-codes three specific toggles is
// wrong for every host but one. Collapse/expand is likewise not built: the
// field auto-grows from one row instead, which is the behaviour collapse was
// approximating.

export interface ComposerAttachment {
  /** stable id — the {{#each}} key */
  id: string;
  /** what the reader sees, e.g. 'Slow Bloom Coffee · Menu' */
  label: string;
  /**
   * `true` for context the host attached on the reader's behalf (the
   * "Viewing" tag). Pinning promotes it to a deliberate attachment, which is
   * why `@onPin` only ever fires for these.
   */
  auto?: boolean;
  /** what it is, which picks the pill's mark: a card (default), a file, an
   * image, or a skill the message brings along */
  kind?: 'card' | 'file' | 'image' | 'skill';
  /** the card's type or the file's extension, said quietly after the
   * label: 'Relaunch plan', 'PNG' */
  type?: string;
  /** a thumbnail for the mark: a card's image, an image file */
  image?: string;
  /** the attachment is still arriving ('uploading', with `progress`
   * 0–1) or did not ('failed', with `error`); omit once it is ready */
  state?: 'uploading' | 'failed';
  progress?: number;
  error?: string;
}

// the `@word`, or a `/word`, that ends at the caret. A RegExp built from a
// string: a slash inside a regex literal's character class trips the .gts
// preprocessor
const TOKEN_RE = new RegExp('(^|\\s)([@/])([^\\s@/]*)$');

/** a candidate for `@` (a card, a person, a file) or a `/` command */
export interface ComposerSuggestion {
  id: string;
  label: string;
  /** a quieter line: the card's type, what the command does */
  hint?: string;
}

const MARKS: Record<string, string> = {
  card: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4',
  skill: 'M12 3l2.6 5.6L20 9.3l-4 4.1.9 5.6L12 16.3 7.1 19l.9-5.6-4-4.1 5.4-.7z',
};
const markPath = (attachment: ComposerAttachment) =>
  MARKS[attachment.kind ?? 'card'] ?? MARKS['card'];
const thumbStyle = (attachment: ComposerAttachment) =>
  htmlSafe(
    attachment.image ? `background-image: url("${attachment.image}")` : '',
  );

export interface ComposerMode {
  /** the value handed to `@onModeChange` and `@onSend` */
  value: string;
  /** the segment face */
  label: string;
  /**
   * one line stating what this mode is allowed to do. It is rendered in a
   * `role='status'`, so switching mode announces the consequence rather than
   * leaving it as decoration.
   */
  note?: string;
  /** placeholder used while this mode is active and nothing is queued */
  placeholder?: string;
}

/** Ask reads, Act writes — the default two-mode split from the spec. */
export const COMPOSER_MODES: ComposerMode[] = [
  {
    value: 'ask',
    label: 'Ask',
    note: 'Ask reads only — it never edits.',
    placeholder: 'Ask about this card…',
  },
  {
    value: 'act',
    label: 'Act',
    note: 'Act may propose changes for your approval.',
    placeholder: 'Tell the agent what to change…',
  },
];

export interface ComposerSignature {
  Args: {
    /** controlled draft text; omit to let the composer hold its own */
    value?: string;
    /** starting draft when uncontrolled */
    defaultValue?: string;
    /** fires on every keystroke with the new draft */
    onInput?: (value: string) => void;
    /** fires on submit with the draft and the active mode */
    onSend?: (text: string, mode: string) => void;
    /** the modes offered; defaults to COMPOSER_MODES (Ask / Act) */
    modes?: ComposerMode[];
    /** controlled mode value */
    mode?: string;
    /** starting mode when uncontrolled; defaults to the first mode */
    defaultMode?: string;
    /** fires with the newly selected mode value */
    onModeChange?: (mode: string) => void;
    /** context chips shown above the field */
    attachments?: ComposerAttachment[];
    /** promote an auto-attached chip to a pinned one */
    onPin?: (attachment: ComposerAttachment) => void;
    /** drop an attachment */
    onRemove?: (attachment: ComposerAttachment) => void;
    /** overrides every derived placeholder */
    placeholder?: string;
    /**
     * how many messages are already queued. Non-zero rewrites the
     * placeholder to say so, which is the whole point of the arg — a queue
     * the reader cannot see is a message they think was sent.
     */
    queueCount?: number;
    /** a run is in flight: the send button becomes Stop */
    busy?: boolean;
    /** the run in flight reads new messages at its next step, so the
     * placeholder says a message steers it rather than queues behind it */
    steering?: boolean;
    /** what `@` offers, filtered by what follows it */
    mentionItems?: ComposerSuggestion[];
    /** a mention was inserted ("@Lena Ruiz ") */
    onMention?: (item: ComposerSuggestion) => void;
    /** what `/` offers at the start of the message */
    commands?: ComposerSuggestion[];
    /** a command was picked; the draft keeps "/name " for its argument */
    onCommand?: (command: ComposerSuggestion) => void;
    /** the "+" before the modes: attach a card or a file */
    onAttach?: () => void;
    /** try a failed upload again */
    onRetryAttachment?: (attachment: ComposerAttachment) => void;
    /** fires when the reader presses Stop */
    onStop?: () => void;
    /** send button face (default 'Send') */
    sendLabel?: string;
    /** stop button face (default 'Stop') */
    stopLabel?: string;
    /** accessible name for the field (default 'Message the agent') */
    label?: string;
    /** minimum visible rows before the field grows (default 2) */
    rows?: number;
    /** Enter submits, Shift+Enter inserts a newline (default true) */
    submitOnEnter?: boolean;
    /** the whole surface is unavailable: the field, every action, and the
     * mode switch; `<:tools>` receives it to follow */
    disabled?: boolean;
  };
  Blocks: {
    /** extra controls in the action bar, left of the send button; yields
     * whether the surface is disabled */
    tools: [disabled: boolean];
  };
  Element: HTMLDivElement;
}

export class Composer extends Component<ComposerSignature> {
  @tracked private draft = this.args.defaultValue ?? '';
  @tracked private innerMode?: string;

  private noteId = guidFor(this) + '-note';
  readonly listId = guidFor(this) + '-suggest';
  /** the open suggestion menu: which trigger, its query, and where the
   * token sits in the draft */
  @tracked private suggest:
    | { kind: 'mention' | 'command'; query: string; start: number; end: number }
    | undefined;
  @tracked private active = 0;
  private field: HTMLTextAreaElement | undefined;

  get suggestions(): ComposerSuggestion[] {
    let s = this.suggest;
    if (!s) {
      return [];
    }
    let pool =
      (s.kind === 'mention' ? this.args.mentionItems : this.args.commands) ?? [];
    let q = s.query.toLowerCase();
    return pool.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 8);
  }
  get suggesting(): boolean {
    return this.suggestions.length > 0;
  }
  get suggestKind(): string | undefined {
    return this.suggest?.kind;
  }
  get mentioning(): boolean {
    return this.suggest?.kind === 'mention';
  }
  get activeId(): string | undefined {
    return this.suggesting ? `${this.listId}-${this.active}` : undefined;
  }
  optionId = (index: number) => `${this.listId}-${index}`;
  isActive = (index: number) => index === this.active;

  /** the `@word` or leading `/word` the caret is in, if any */
  private readToken(field: HTMLTextAreaElement) {
    let caret = field.selectionStart ?? field.value.length;
    let before = field.value.slice(0, caret);
    let match = TOKEN_RE.exec(before);
    if (!match) {
      this.suggest = undefined;
      return;
    }
    let trigger = match[2]!;
    let start = caret - match[3]!.length - 1;
    let kind: 'mention' | 'command' = trigger === '@' ? 'mention' : 'command';
    if (kind === 'command' && (start !== 0 || !this.args.commands?.length)) {
      this.suggest = undefined;
      return;
    }
    if (kind === 'mention' && !this.args.mentionItems?.length) {
      this.suggest = undefined;
      return;
    }
    this.suggest = { kind, query: match[3]!, start, end: caret };
    this.active = 0;
  }

  choose = (item: ComposerSuggestion) => {
    let s = this.suggest;
    if (!s) {
      return;
    }
    let mark = s.kind === 'mention' ? '@' : '/';
    let insert = `${mark}${item.label} `;
    let value = this.value;
    let next = value.slice(0, s.start) + insert + value.slice(s.end);
    this.setValue(next);
    let caret = s.start + insert.length;
    this.suggest = undefined;
    if (s.kind === 'mention') {
      this.args.onMention?.(item);
    } else {
      this.args.onCommand?.(item);
    }
    let field = this.field;
    if (field) {
      field.value = next;
      field.focus();
      field.setSelectionRange(caret, caret);
    }
  };
  closeSuggest = () => (this.suggest = undefined);
  pick = (item: ComposerSuggestion, event: Event) => {
    event.preventDefault();
    this.choose(item);
  };

  get modes(): ComposerMode[] {
    return this.args.modes ?? COMPOSER_MODES;
  }
  get segments(): { value: string; label: string }[] {
    return this.modes.map((m) => ({ value: m.value, label: m.label }));
  }
  get mode(): string {
    return (
      this.args.mode ??
      this.innerMode ??
      this.args.defaultMode ??
      this.modes[0]?.value ??
      ''
    );
  }
  get activeMode(): ComposerMode | undefined {
    return this.modes.find((m) => m.value === this.mode);
  }
  get value(): string {
    return this.args.value ?? this.draft;
  }
  get queueCount(): number {
    return this.args.queueCount ?? 0;
  }
  get note(): string | undefined {
    return this.activeMode?.note;
  }
  get placeholder(): string {
    if (this.args.placeholder) {
      return this.args.placeholder;
    }
    if (this.args.steering) {
      return 'Type to steer at the next step…';
    }
    if (this.queueCount > 0) {
      return 'Type now to queue behind ' + this.queueLabel + '…';
    }
    return this.activeMode?.placeholder ?? 'Message the agent…';
  }
  get queueLabel(): string {
    let n = this.queueCount;
    return n === 1 ? '1 message' : n + ' messages';
  }
  get label(): string {
    return this.args.label ?? 'Message the agent';
  }
  get isEmpty(): boolean {
    return this.value.length === 0;
  }
  get attachments(): ComposerAttachment[] {
    return this.args.attachments ?? [];
  }
  get hasAttachments(): boolean {
    return this.attachments.length > 0;
  }
  get canSend(): boolean {
    return !this.args.disabled && this.value.trim().length > 0;
  }
  get rows(): number {
    let n = Number(this.args.rows ?? 2);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 12) : 2;
  }
  /** min-height for the growing field, in line-heights — a number we
   * formatted ourselves, so it needs no `cssValue` round trip */
  get fieldStyle() {
    return cssStyleFrom(['--pretui-composer-rows: ' + this.rows]);
  }
  get submitOnEnter(): boolean {
    return this.args.submitOnEnter ?? true;
  }
  /** mirrors the draft into the grow-sizer; a trailing space keeps the
   * sizer one line ahead when the caret sits on a fresh empty line */
  get sizerText(): string {
    return this.value + ' ';
  }

  private setValue = (next: string) => {
    if (this.args.value === undefined) {
      this.draft = next;
    }
    this.args.onInput?.(next);
  };

  input = (event: Event) => {
    let field = event.target as HTMLTextAreaElement;
    this.field = field;
    this.setValue(field.value);
    this.readToken(field);
    // controlled: the owner decides what shows, so put back what it didn't take
    if (this.args.value !== undefined && field.value !== this.args.value) {
      field.value = this.args.value;
    }
  };

  setMode = (next: string) => {
    if (this.args.mode === undefined) {
      this.innerMode = next;
    }
    this.args.onModeChange?.(next);
  };

  send = () => {
    if (!this.canSend) {
      return;
    }
    this.args.onSend?.(this.value.trim(), this.mode);
    this.setValue('');
  };

  get disabled(): boolean {
    return this.args.disabled === true;
  }

  stop = () => {
    if (!this.disabled) {
      this.args.onStop?.();
    }
  };

  keydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    this.field = ev.target as HTMLTextAreaElement;
    if (this.suggesting) {
      let n = this.suggestions.length;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.active = (this.active + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        ev.preventDefault();
        this.choose(this.suggestions[this.active]!);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeSuggest();
        return;
      }
    }
    if (ev.key !== 'Enter') {
      return;
    }
    let modified = ev.metaKey || ev.ctrlKey;
    // Mod+Enter always sends, even when the caller wants a plain Enter to
    // insert a newline — it is the escape hatch every chat surface has.
    if (modified || (this.submitOnEnter && !ev.shiftKey && !ev.altKey)) {
      ev.preventDefault();
      this.send();
    }
  };

  pin = (attachment: ComposerAttachment) => {
    if (!this.disabled) {
      this.args.onPin?.(attachment);
    }
  };
  retryAttachment = (attachment: ComposerAttachment) => {
    if (!this.disabled) {
      this.args.onRetryAttachment?.(attachment);
    }
  };
  attach = () => {
    if (!this.disabled) {
      this.args.onAttach?.();
    }
  };
  progressStyle = (attachment: ComposerAttachment) =>
    htmlSafe(
      `--pretui-attach-progress: ${Math.round(Math.min(Math.max(attachment.progress ?? 0, 0), 1) * 100)}%`,
    );
  isUploading = (attachment: ComposerAttachment) =>
    attachment.state === 'uploading';
  isFailed = (attachment: ComposerAttachment) => attachment.state === 'failed';
  remove = (attachment: ComposerAttachment) => {
    if (!this.disabled) {
      this.args.onRemove?.(attachment);
    }
  };

  <template>
    <div
      class='pretui-composer'
      data-busy={{if @busy 'true'}}
      data-test-pretui-composer
      ...attributes
    >
      {{#if this.hasAttachments}}
        <ul class='pretui-composer-attachments' aria-label='Attached context'>
          {{#each this.attachments key='id' as |attachment|}}
            <li
              class='pretui-attach'
              data-auto={{if attachment.auto 'true'}}
              data-kind={{if attachment.kind attachment.kind 'card'}}
              data-state={{attachment.state}}
              aria-busy={{if (this.isUploading attachment) 'true'}}
              title={{if (this.isFailed attachment) attachment.error}}
              data-test-pretui-composer-attachment={{attachment.label}}
            >
              {{#if attachment.auto}}<span class='pretui-attach-tag'>Viewing</span>{{/if}}
              {{#if attachment.image}}
                <span
                  class='pretui-attach-mark'
                  data-thumb='true'
                  style={{thumbStyle attachment}}
                  aria-hidden='true'
                ></span>
              {{else}}
                <svg class='pretui-attach-mark' viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                  <path
                    d={{markPath attachment}}
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.8'
                    stroke-linejoin='round'
                    stroke-linecap='round'
                  />
                </svg>
              {{/if}}
              <span class='pretui-attach-label'>{{attachment.label}}</span>
              {{#if attachment.type}}<span class='pretui-attach-type'>{{attachment.type}}</span>{{/if}}
              {{#if (this.isUploading attachment)}}
                <span
                  class='pretui-attach-progress'
                  role='progressbar'
                  aria-label={{concat 'Uploading ' attachment.label}}
                  aria-valuemin='0'
                  aria-valuemax='100'
                  style={{this.progressStyle attachment}}
                  data-test-pretui-composer-attachment-progress
                ></span>
              {{/if}}
              {{#if (this.isFailed attachment)}}
                <span class='pretui-attach-failed'>failed</span>
                {{#if @onRetryAttachment}}
                  <button
                    type='button'
                    class='pretui-attach-retry'
                    disabled={{@disabled}}
                    data-test-pretui-composer-attachment-retry
                    {{on 'click' (fn this.retryAttachment attachment)}}
                  >Retry</button>
                {{/if}}
              {{/if}}
              {{#if attachment.auto}}
                {{#if @onPin}}
                  <button
                    type='button'
                    class='pretui-attach-act'
                    aria-label={{concat 'Pin ' attachment.label}}
                    disabled={{@disabled}}
                    {{on 'click' (fn this.pin attachment)}}
                  >
                    <PlusIcon width='14' height='14' aria-hidden='true' />
                  </button>
                {{/if}}
              {{else if @onRemove}}
                <button
                  type='button'
                  class='pretui-attach-act'
                  aria-label={{concat 'Remove ' attachment.label}}
                  disabled={{@disabled}}
                  {{on 'click' (fn this.remove attachment)}}
                >
                  <XIcon width='14' height='14' aria-hidden='true' />
                </button>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{/if}}

      {{! the sizer replicates the value so the field grows with no measurement }}
      <div
        class='pretui-composer-grow'
        data-value={{this.sizerText}}
        data-empty={{if this.isEmpty 'true'}}
        style={{this.fieldStyle}}
      >
        <textarea
          class='pretui-composer-field'
          rows={{this.rows}}
          value={{this.value}}
          aria-label={{this.label}}
          aria-describedby={{if this.note this.noteId}}
          role={{if (if @mentionItems true @commands) 'combobox'}}
          aria-autocomplete={{if (if @mentionItems true @commands) 'list'}}
          aria-controls={{if this.suggesting this.listId}}
          aria-expanded={{if (if @mentionItems true @commands) (if this.suggesting 'true' 'false')}}
          aria-activedescendant={{this.activeId}}
          disabled={{if @disabled true}}
          data-test-pretui-composer-field
          {{on 'input' this.input}}
          {{on 'keydown' this.keydown}}
        ></textarea>
        {{! The hint is NOT a `placeholder` attribute, deliberately. A
            placeholder doubles as the accessible name, so the field would
            lose its name the moment you typed into it — and the composer's
            hint changes with the mode and the queue, which makes it the
            worst possible candidate for a name. `aria-label` names the
            field permanently; this aria-hidden span carries the hint. }}
        <span class='pretui-composer-hint' aria-hidden='true'
        >{{this.placeholder}}</span>
        {{#if this.suggesting}}
          <ul
            class='pretui-composer-suggest'
            id={{this.listId}}
            role='listbox'
            aria-label={{if this.mentioning 'Mention' 'Commands'}}
            data-kind={{this.suggestKind}}
            data-test-pretui-composer-suggest={{this.suggestKind}}
          >
            {{#each this.suggestions as |item index|}}
              {{! picking puts focus and the caret back in the field }}
              <li
                class='pretui-composer-option'
                id={{this.optionId index}}
                role='option'
                aria-selected={{if (this.isActive index) 'true' 'false'}}
                data-test-pretui-composer-option={{item.label}}
                {{on 'click' (fn this.pick item)}}
              >
                <span class='pretui-composer-option-mark' aria-hidden='true'>{{if this.mentioning '@' '/'}}</span>
                <span class='pretui-composer-option-label'>{{item.label}}</span>
                {{#if item.hint}}<span class='pretui-composer-option-hint'>{{item.hint}}</span>{{/if}}
              </li>
            {{/each}}
          </ul>
        {{/if}}
      </div>

      <div class='pretui-composer-bar'>
        {{#if @onAttach}}
          <button
            type='button'
            class='pretui-composer-attach'
            aria-label='Attach a card or file'
            disabled={{@disabled}}
            data-test-pretui-composer-attach
            {{on 'click' this.attach}}
          >
            <PlusIcon width='16' height='16' aria-hidden='true' />
          </button>
        {{/if}}
        {{#if this.segments.length}}
          <SegmentedControl
            @options={{this.segments}}
            @value={{this.mode}}
            @onValueChange={{this.setMode}}
            @disabled={{@disabled}}
            data-test-pretui-composer-modes
          />
        {{/if}}
        {{#if this.note}}
          <span
            id={{this.noteId}}
            class='pretui-composer-note'
            role='status'
          >{{this.note}}</span>
        {{/if}}
        <span class='pretui-composer-spacer'></span>
        {{yield this.disabled to='tools'}}
        {{#if @busy}}
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            @disabled={{@disabled}}
            {{on 'click' this.stop}}
            data-test-pretui-composer-stop
          >{{if @stopLabel @stopLabel 'Stop'}}</Button>
        {{else}}
          <Button
            @size='s'
            @disabled={{unless this.canSend true}}
            {{on 'click' this.send}}
            data-test-pretui-composer-send
          >{{if @sendLabel @sendLabel 'Send'}}</Button>
        {{/if}}
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        /* the message box: entry at reading size, controls at UI, captions
           at caption; sans throughout, mono only for a pasted path or id */
        .pretui-composer {
          display: flex;
          flex-direction: column;
          gap: var(--step-8, 8px);
          padding: var(--step-8, 8px) var(--step-12, 12px);
          background: var(--card);
          border-radius: var(--round-surface, 12px);
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border),
            0 2px 10px rgb(0 0 0 / 0.1)
          );
          container-type: inline-size;
        }
        .pretui-composer:focus-within {
          box-shadow:
            0 0 0 1px
              color-mix(in oklch, var(--ring) 55%, var(--border)),
            0 2px 10px rgb(0 0 0 / 0.1);
        }
        .pretui-composer-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: var(--step-4, 4px);
          margin: 0;
          padding: 0;
          list-style: none;
        }
        /* an attachment: an outlined token on the inset, as a card pill is;
           its label ink-1 at UI size, its type and provenance captions */
        .pretui-attach {
          display: inline-flex;
          align-items: center;
          gap: var(--step-4, 4px);
          min-height: 24px;
          padding: 0 2px 0 var(--step-8, 8px);
          border-radius: var(--round-row, 8px);
          background: var(--inset, var(--muted));
          box-shadow: inset 0 0 0 1px var(--border);
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--foreground);
          max-width: 100%;
        }
        .pretui-attach-tag {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 600;
          color: var(--ink-2, var(--muted-foreground));
          flex: none;
        }
        /* the pill's mark: what it is at a glance, a thumbnail when it has
           one */
        .pretui-attach-mark {
          flex: none;
          width: 14px;
          height: 14px;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-attach-mark[data-thumb] {
          width: 16px;
          height: 16px;
          border-radius: var(--round-chip, 4px);
          background: var(--inset) center / cover no-repeat;
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-attach[data-state='uploading'] {
          position: relative;
          overflow: hidden;
        }
        /* uploading is live work */
        .pretui-attach-progress {
          position: absolute;
          inset-inline: 0;
          inset-block-end: 0;
          height: 2px;
          background: linear-gradient(
            to right,
            var(--state-live, var(--primary)) var(--pretui-attach-progress, 0%),
            transparent 0
          );
        }
        /* failed: the word takes the failed state, never the whole pill */
        .pretui-attach-failed {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--state-failed, var(--pretui-destructive-ink, var(--destructive)));
        }
        .pretui-attach-retry {
          padding: 0 2px;
          border: 0;
          background: none;
          font: inherit;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-attach-retry:hover {
          text-decoration: underline;
        }
        /* the suggestion menu opens above the field, as the composer sits at
           the bottom of the panel */
        .pretui-composer-suggest {
          position: absolute;
          inset-inline: 0;
          inset-block-end: calc(100% + 6px);
          z-index: var(--pretui-z-popover, 30);
          display: grid;
          max-height: 240px;
          margin: 0;
          padding: var(--step-4, 4px);
          overflow-y: auto;
          list-style: none;
          border-radius: var(--round-surface, 12px);
          background: var(--popover, var(--card));
          color: var(--popover-foreground, var(--foreground));
          box-shadow:
            0 0 0 1px var(--border),
            var(--shadow-md, 0 8px 24px rgb(0 0 0 / 0.18));
        }
        .pretui-composer-option {
          display: flex;
          align-items: baseline;
          gap: var(--step-8, 8px);
          min-height: 32px;
          padding: 7px var(--step-8, 8px);
          border-radius: var(--round-row, 8px);
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          cursor: pointer;
        }
        .pretui-composer-option[aria-selected='true'] {
          background: var(--hover, var(--inset));
        }
        .pretui-composer-option-mark {
          width: 12px;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-composer-option-label {
          font-weight: 600;
        }
        .pretui-composer-option-hint {
          margin-inline-start: auto;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-composer-attach {
          display: inline-grid;
          place-items: center;
          width: 28px;
          height: 28px;
          padding: 0;
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          color: var(--ink-2, var(--muted-foreground));
          cursor: pointer;
        }
        .pretui-composer-attach svg {
          width: 16px;
          height: 16px;
        }
        .pretui-composer-attach:hover:not(:disabled) {
          color: var(--foreground);
          background: var(--hover, var(--inset));
        }
        .pretui-composer-attach:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-attach-type {
          flex: none;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
          white-space: nowrap;
        }
        .pretui-attach-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-attach-act {
          display: inline-grid;
          place-items: center;
          width: 20px;
          height: 20px;
          flex: none;
          padding: 0;
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: none;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          cursor: pointer;
        }
        .pretui-attach-act svg {
          width: 11px;
          height: 11px;
        }
        .pretui-attach-act:hover {
          background: var(--hover, var(--inset));
          color: var(--foreground);
        }
        .pretui-attach-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }

        /* The auto-grow field: an invisible ::after replica sizes the grid cell
           the textarea shares with it, so the field grows with its content and
           nothing is ever measured in JavaScript. The entry is reading size,
           the hint the same sans in ink-3. */
        .pretui-composer-grow {
          position: relative;
          display: grid;
        }
        .pretui-composer-grow::after,
        .pretui-composer-hint,
        .pretui-composer-field {
          grid-area: 1 / 1 / 2 / 2;
          font: inherit;
          font-family: var(--font-sans, inherit);
          font-size: var(--type-read, 14px);
          line-height: var(--leading-read, 22px);
          font-weight: 400;
          padding: 2px 0;
          min-height: calc(
            var(--pretui-composer-rows, 2) * var(--leading-read, 22px) + 4px
          );
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .pretui-composer-grow::after {
          content: attr(data-value);
          visibility: hidden;
          max-height: var(--pretui-composer-max, 14em);
        }
        .pretui-composer-field {
          border: 0;
          background: none;
          color: var(--foreground);
          resize: none;
          outline: none;
          overflow-y: auto;
          max-height: var(--pretui-composer-max, 14em);
        }
        .pretui-composer-hint {
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          pointer-events: none;
          user-select: none;
          opacity: 0;
          overflow: hidden;
          max-height: var(--pretui-composer-max, 14em);
        }
        .pretui-composer-grow[data-empty] .pretui-composer-hint {
          opacity: 1;
        }
        .pretui-composer-field:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .pretui-composer-bar {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          flex-wrap: wrap;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
        }
        .pretui-composer-spacer {
          margin-left: auto;
        }
        .pretui-composer-note {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          min-width: 0;
        }
        /* unnamed container query — resolves against .pretui-composer */
        @container (max-width: 26rem) {
          .pretui-composer-note {
            order: 3;
            flex-basis: 100%;
          }
        }
      }
    </style>
  </template>
}
