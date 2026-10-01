// Pretui — TokenInput: an editable row of short values, added and removed as chips.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { addToken, removeTokenAt, splitTokens, tokenBreaks } from '../internal/design-tools';

// ═══════════════════════════════════════════════════════════════════════
// TokenInput — the array-of-values row
// ═══════════════════════════════════════════════════════════════════════
//
// figui3 has no equivalent, and neither did the kit: `MultiSelect` picks
// from a fixed option list, `Reorder` reorders one that already exists, and
// `Chip`/`Token` are display atoms with no remove affordance. But a
// property panel is full of open-ended short lists — mood keywords,
// materials, props, practical lights — and every one of them was being
// hand-rolled as "an input, a button, and some pills".

interface TokenChipSignature {
  Args: {
    label: string;
    index: number;
    disabled?: boolean;
    onRemove?: (index: number) => void;
  };
  Element: HTMLLIElement;
}

/** One removable member. A child component rather than `(fn this.remove
 * index)` in the loop, so each chip's click handler is a stable reference
 * instead of a fresh closure per render. */
class TokenChip extends Component<TokenChipSignature> {
  get removeLabel(): string {
    return 'Remove ' + this.args.label;
  }
  handleRemove = () => {
    if (!this.args.disabled) {
      this.args.onRemove?.(this.args.index);
    }
  };
  <template>
    <li class='pretui-token-item' data-test-pretui-token-item ...attributes>
      <span class='pretui-token-text'>{{@label}}</span>
      <button
        type='button'
        class='pretui-token-remove'
        aria-label={{this.removeLabel}}
        aria-disabled={{if @disabled 'true'}}
        {{on 'click' this.handleRemove}}
        data-test-pretui-token-remove={{@label}}
      ><span class='pretui-token-cross' aria-hidden='true'></span></button>
    </li>
    <style scoped>
      .pretui-token-item {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        max-width: 100%;
        height: 20px;
        padding-inline-start: 7px;
        border-radius: var(--radius-chip, 6px);
        background: color-mix(
          in oklch,
          var(--primary) 12%,
          var(--card)
        );
        box-shadow: 0 0 0 1px
          color-mix(in oklch, var(--primary) 32%, var(--border));
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
      }
      .pretui-token-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-token-remove {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        margin-inline-end: 1px;
        padding: 0;
        border: 0;
        border-radius: var(--radius-sm, 5px);
        background: transparent;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-token-remove:hover {
        background: var(--hover, rgb(0 0 0 / 0.05));
        color: var(--foreground);
      }
      .pretui-token-remove:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -1px;
      }
      .pretui-token-remove[aria-disabled='true'] {
        cursor: default;
        opacity: 0.45;
      }
      /* The cross is drawn from two borders rather than an <svg>, so the
         chip stays legal inside any role a caller wraps the list in. */
      .pretui-token-cross {
        position: relative;
        width: 7px;
        height: 7px;
      }
      .pretui-token-cross::before,
      .pretui-token-cross::after {
        content: '';
        position: absolute;
        inset-block-start: 3px;
        inset-inline-start: 0;
        width: 7px;
        height: 1.2px;
        border-radius: 1px;
        background: currentColor;
      }
      .pretui-token-cross::before {
        transform: rotate(45deg);
      }
      .pretui-token-cross::after {
        transform: rotate(-45deg);
      }
      @media (pointer: coarse) {
        .pretui-token-item {
          height: 28px;
        }
        .pretui-token-remove {
          width: 26px;
          height: 26px;
        }
      }
    </style>
  </template>
}

export interface TokenInputSignature {
  Args: {
    /** CONTROLLED list. Omit to let the component own it. */
    value?: readonly string[];
    /** initial list when uncontrolled */
    defaultValue?: readonly string[];
    /** accessible name for the entry field — required in practice */
    label?: string;
    placeholder?: string;
    /** id for the entry field, so a PropertyRow label points at it */
    controlId?: string;
    describedBy?: string;
    /** cap on the number of members; the field goes inert at the cap */
    max?: number;
    /** default false — every one of these lists is a set in disguise */
    allowDuplicates?: boolean;
    /** characters that commit the entry, typed or pasted (default [',']);
     * a newline or tab always does */
    separators?: readonly string[];
    disabled?: boolean;
    /** multi-selection whose lists differ */
    mixed?: boolean;
    /** fires on every accepted add and every remove */
    onChange?: (values: string[]) => void;
  };
  Element: HTMLDivElement;
}

/**
 * A free-entry list of short values, rendered as removable chips.
 *
 * Type and press Enter (or type a comma, or paste a comma-separated run) to
 * add; Backspace in an empty field removes the last member; every chip
 * carries its own named remove button.
 *
 * **What this fixes relative to the panel it was checked against.** That
 * one added on Enter only, so a typed word left behind by a Tab or a click
 * elsewhere was silently discarded — here **blur commits**, which is what
 * a user who typed a word and looked away actually meant. It rejected
 * duplicates by doing nothing at all; here a rejected add SAYS why, in a
 * live region. Its remove button was an unlabelled glyph, leaving a screen
 * reader with a row of identical "button"s; here each is "Remove Velvet".
 * And removing a chip dropped focus to the document body — here focus
 * returns to the entry field, so a run of removals stays on the keyboard.
 */
export class TokenInput extends Component<TokenInputSignature> {
  private guid = guidFor(this);
  get inputId(): string {
    return this.args.controlId ?? this.guid + '-tokens';
  }
  get statusId(): string {
    return this.guid + '-status';
  }
  /** As in ScrubInput: a wrapper that supplies `@controlId` owns the
   * visible label, so this renders none. Two names is a defect. */
  get ownsLabel(): boolean {
    return this.args.controlId === undefined;
  }
  get fallbackLabel(): string {
    return this.args.label ?? 'Values';
  }

  @tracked private internal: readonly string[] =
    this.args.defaultValue ?? [];
  @tracked private draft = '';
  @tracked private status = '';

  get tokens(): readonly string[] {
    return this.args.value ?? this.internal;
  }
  get shownTokens(): readonly string[] {
    return this.args.mixed ? [] : this.tokens;
  }
  get inert(): boolean {
    return this.args.disabled === true;
  }
  get full(): boolean {
    let max = this.args.max;
    return (
      max !== undefined &&
      Number.isFinite(max) &&
      max > 0 &&
      this.tokens.length >= max
    );
  }
  get entryInert(): boolean {
    return this.inert || this.full;
  }
  get placeholder(): string {
    if (this.args.mixed) {
      return 'Mixed';
    }
    if (this.full) {
      return 'List is full';
    }
    return this.args.placeholder ?? 'Add…';
  }
  get countText(): string {
    let total = this.tokens.length;
    let max = this.args.max;
    let suffix = max !== undefined && max > 0 ? ' / ' + max : '';
    return String(total) + suffix;
  }

  private write(next: string[], status: string) {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.status = status;
    this.args.onChange?.(next);
  }
  private focusEntry() {
    let field = document.getElementById(this.inputId);
    if (field instanceof HTMLElement) {
      field.focus();
    }
  }
  /** Commits whatever is in the field. Every entry path funnels through
   * here — Enter, comma, paste, blur — so they cannot drift apart. */
  private commitDraft() {
    let parts = splitTokens(this.draft, this.args.separators);
    if (parts.length === 0) {
      this.draft = '';
      return;
    }
    let list = [...this.tokens];
    let status = '';
    let changed = false;
    for (let part of parts) {
      let edit = addToken(list, part, {
        allowDuplicates: this.args.allowDuplicates,
        max: this.args.max,
      });
      if (edit.list.length !== list.length) {
        changed = true;
      }
      list = edit.list;
      status = edit.status || status;
    }
    this.draft = '';
    if (changed) {
      this.write(list, status);
    } else {
      this.status = status;
    }
  }

  remove = (index: number) => {
    if (this.inert) {
      return;
    }
    let edit = removeTokenAt(this.tokens, index);
    this.write(edit.list, edit.status);
    // A removed chip takes focus with it; put it somewhere useful rather
    // than letting it fall to <body>.
    this.focusEntry();
  };

  handleInput = (event: Event) => {
    if (this.entryInert) {
      return;
    }
    let text = (event.target as HTMLInputElement).value;
    this.draft = text;
    // A comma (typed or pasted) is a commit, so a list pasted from a
    // spreadsheet arrives as members instead of one long member.
    if (tokenBreaks(this.args.separators).test(text)) {
      this.commitDraft();
    }
  };
  handleKeyDown = (event: Event) => {
    let key = event as KeyboardEvent;
    // the Enter that confirms an IME composition is not a commit
    if (key.isComposing || key.keyCode === 229) {
      return;
    }
    if (key.key === 'Enter') {
      event.preventDefault();
      if (!this.entryInert) {
        this.commitDraft();
      }
      return;
    }
    if (key.key === 'Escape') {
      this.draft = '';
      return;
    }
    if (key.key === 'Backspace' && this.draft === '' && !this.inert) {
      if (this.tokens.length > 0) {
        event.preventDefault();
        this.remove(this.tokens.length - 1);
      }
    }
  };
  handleBlur = () => {
    if (!this.entryInert) {
      this.commitDraft();
    }
  };
  <template>
    <div
      class='pretui-tokens'
      data-mixed={{if @mixed 'true'}}
      data-full={{if this.full 'true'}}
      data-disabled={{if this.inert 'true'}}
      data-test-pretui-token-input
      ...attributes
    >
      {{#if this.shownTokens.length}}
        <ul class='pretui-token-list' role='list'>
          {{#each this.shownTokens key='@index' as |token index|}}
            <TokenChip
              @label={{token}}
              @index={{index}}
              @disabled={{this.inert}}
              @onRemove={{this.remove}}
            />
          {{/each}}
        </ul>
      {{/if}}

      {{#if this.ownsLabel}}
        <label class='pretui-sr' for={{this.inputId}}>{{this.fallbackLabel}}</label>
      {{/if}}

      <input
        type='text'
        class='pretui-token-entry'
        id={{this.inputId}}
        autocomplete='off'
        spellcheck='false'
        aria-describedby={{@describedBy}}
        aria-disabled={{if this.entryInert 'true'}}
        readonly={{this.entryInert}}
        placeholder={{this.placeholder}}
        value={{this.draft}}
        {{on 'input' this.handleInput}}
        {{on 'keydown' this.handleKeyDown}}
        {{on 'blur' this.handleBlur}}
        data-test-pretui-token-entry
      />

      {{#if @max}}
        <span class='pretui-token-count' aria-hidden='true'>{{this.countText}}</span>
      {{/if}}

      <span
        class='pretui-sr'
        role='status'
        id={{this.statusId}}
        data-test-pretui-token-status
      >{{this.status}}</span>
    </div>
    <style scoped>
      .pretui-tokens {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        min-width: 0;
        width: 100%;
        min-height: var(--control-h, 28px);
        padding: 3px 5px;
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        color: var(--foreground);
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-tokens:hover {
        box-shadow: 0 0 0 1px var(--line-strong, var(--boxel-400));
      }
      /* Transparent outline doubles the box-shadow ring for forced-colors —
         see the identical note on .pretui-scrub above. */
      .pretui-tokens:has(.pretui-token-entry:focus-visible) {
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow: 0 0 0 2px var(--ring);
      }
      .pretui-tokens[data-disabled='true'] {
        opacity: 0.5;
      }
      /* A real <ul> with an explicit role='list': `list-style: none` alone
         strips list semantics in Safari, and `display: contents` — the
         other way to get chips and entry on one line — drops the list out
         of the accessibility tree entirely. Flex keeps both. */
      .pretui-token-list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        flex: 0 1 auto;
        min-width: 0;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-token-entry {
        flex: 1 1 60px;
        min-width: 60px;
        height: 20px;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        letter-spacing: var(--track-ui, 0.01em);
        padding-inline: 3px;
        outline: none;
      }
      .pretui-token-entry::placeholder {
        color: var(--ink-3, var(--boxel-400));
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
      }
      .pretui-token-count {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      @media (pointer: coarse) {
        .pretui-token-entry {
          height: 28px;
        }
      }
    </style>
  </template>
}
