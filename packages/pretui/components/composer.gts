// Pretui — Composer: the message composer: text, attachments and a send mode.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
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
}

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
    /** the whole surface is unavailable */
    disabled?: boolean;
  };
  Blocks: {
    /** extra controls in the action bar, left of the send button */
    tools: [];
  };
  Element: HTMLDivElement;
}

export class Composer extends Component<ComposerSignature> {
  @tracked private draft = this.args.defaultValue ?? '';
  @tracked private innerMode?: string;

  private noteId = guidFor(this) + '-note';

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
    this.setValue((event.target as HTMLTextAreaElement).value);
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

  stop = () => this.args.onStop?.();

  keydown = (event: Event) => {
    let ev = event as KeyboardEvent;
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

  pin = (attachment: ComposerAttachment) => this.args.onPin?.(attachment);
  remove = (attachment: ComposerAttachment) => this.args.onRemove?.(attachment);

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
            <li class='pretui-attach' data-auto={{if attachment.auto 'true'}}>
              <span class='pretui-attach-tag'>{{if
                  attachment.auto
                  'Viewing'
                  'Attached'
                }}</span>
              <span class='pretui-attach-label'>{{attachment.label}}</span>
              {{#if attachment.auto}}
                {{#if @onPin}}
                  <button
                    type='button'
                    class='pretui-attach-act'
                    aria-label={{concat 'Pin ' attachment.label}}
                    {{on 'click' (fn this.pin attachment)}}
                  >
                    <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                      <path
                        d='M12 5v14M5 12h14'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2.4'
                        stroke-linecap='round'
                      />
                    </svg>
                  </button>
                {{/if}}
              {{else if @onRemove}}
                <button
                  type='button'
                  class='pretui-attach-act'
                  aria-label={{concat 'Remove ' attachment.label}}
                  {{on 'click' (fn this.remove attachment)}}
                >
                  <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                    <path
                      d='M6 6l12 12M18 6L6 18'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2.4'
                      stroke-linecap='round'
                    />
                  </svg>
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
      </div>

      <div class='pretui-composer-bar'>
        {{#if this.segments.length}}
          <SegmentedControl
            @options={{this.segments}}
            @value={{this.mode}}
            @onValueChange={{this.setMode}}
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
        {{yield to='tools'}}
        {{#if @busy}}
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
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
      .pretui-composer {
        display: flex;
        flex-direction: column;
        gap: var(--space-3, 7px);
        padding: var(--space-3, 9px) var(--space-4, 11px);
        background: var(--card);
        border-radius: var(--radius-surface, 14px);
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
        gap: 5px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-attach {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 22px;
        padding: 0 4px 0 8px;
        border-radius: 6px;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        max-width: 100%;
      }
      .pretui-attach-tag {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--ink-3, var(--boxel-400));
        flex: none;
      }
      .pretui-attach[data-auto] .pretui-attach-tag {
        color: color-mix(
          in oklch,
          var(--foreground) 20%,
          var(--primary)
        );
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
        border-radius: 5px;
        background: none;
        color: var(--ink-3, var(--boxel-400));
        cursor: pointer;
      }
      .pretui-attach-act svg {
        width: 11px;
        height: 11px;
      }
      .pretui-attach-act:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-attach-act:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }

      /* The auto-grow field: an invisible ::after replica sizes the grid cell
         the textarea shares with it, so the field grows with its content and
         nothing is ever measured in JavaScript. */
      .pretui-composer-grow {
        display: grid;
      }
      .pretui-composer-grow::after,
      .pretui-composer-hint,
      .pretui-composer-field {
        grid-area: 1 / 1 / 2 / 2;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.55;
        letter-spacing: var(--track-ui, 0.01em);
        padding: 2px 0;
        min-height: calc(var(--pretui-composer-rows, 2) * 1.55em + 4px);
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
        color: var(--ink-3, var(--boxel-400));
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
        gap: var(--space-3, 7px);
        flex-wrap: wrap;
      }
      .pretui-composer-spacer {
        margin-left: auto;
      }
      .pretui-composer-note {
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
        min-width: 0;
      }
      /* unnamed container query — resolves against .pretui-composer */
      @container (max-width: 26rem) {
        .pretui-composer-note {
          order: 3;
          flex-basis: 100%;
        }
      }
    </style>
  </template>
}
