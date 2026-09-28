// Pretui — CommandPalette: the menu tree flattened, filtered by typing, as a
// combobox in a modal dialog.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import {
  detectShortcutPlatform,
  parseShortcut,
  formatShortcut,
  ariaKeyShortcuts,
  ELLIPSIS,
  checkStateOf,
  checkedAttr,
  isSeparator,
  isSection,
} from '../internal/menu';
import type {
  SubmenuNode,
  MenuEntry,
  LeafNode,
  ShortcutPlatform,
  CheckState,
} from '../internal/menu';
import { Kbd } from './kbd';

// ── Fuzzy matching (the palette's engine) ────────────────────────────────

export interface FuzzyMatch {
  score: number;
  /** [start, end) index pairs into the searched text */
  ranges: [number, number][];
}

const BOUNDARY = /[\s\-_/.:·>]/;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  let previous = text[index - 1];
  if (BOUNDARY.test(previous)) {
    return true;
  }
  // camelCase transition
  return (
    previous === previous.toLowerCase() &&
    previous !== previous.toUpperCase() &&
    text[index] !== text[index].toLowerCase()
  );
}

/**
 * A dependency-free fuzzy matcher with match ranges — the part of uFuzzy the
 * palette actually needs, without vendoring an engine into a tier Law 9 says
 * takes none.
 *
 * Greedy left-to-right subsequence, but each character prefers the next
 * WORD-BOUNDARY occurrence over the next raw one, so "cs" finds "Copy
 * Selection" rather than the "c" of Copy and an "s" inside it. Scoring
 * rewards contiguity, boundaries and a prefix hit, and charges for gaps.
 * Deterministic: same inputs, same score, every time.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  let needle = query.trim().toLowerCase();
  if (!needle) {
    return { score: 0, ranges: [] };
  }
  let haystack = text.toLowerCase();
  let ranges: [number, number][] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -2;
  for (let i = 0; i < needle.length; i++) {
    let character = needle[i];
    if (character === ' ') {
      continue;
    }
    let plain = haystack.indexOf(character, cursor);
    if (plain < 0) {
      return null;
    }
    let chosen = plain;
    if (plain !== previousIndex + 1) {
      // not contiguous anyway — prefer a boundary hit further along
      for (let j = plain; j < haystack.length; j++) {
        if (haystack[j] === character && isBoundary(text, j)) {
          chosen = j;
          break;
        }
      }
    }
    if (chosen === previousIndex + 1) {
      score += 10;
      ranges[ranges.length - 1][1] = chosen + 1;
    } else {
      score += isBoundary(text, chosen) ? 8 : 2;
      score -= Math.min(6, chosen - cursor);
      ranges.push([chosen, chosen + 1]);
    }
    if (chosen === 0) {
      score += 12;
    }
    previousIndex = chosen;
    cursor = chosen + 1;
  }
  // shorter haystacks are better matches for the same query
  score += Math.max(0, 16 - Math.floor(text.length / 4));
  return { score, ranges };
}

export interface MatchSegment {
  text: string;
  hit: boolean;
}

/** Splits text into plain and matched segments for highlighting. */
export function matchSegments(
  text: string,
  ranges: [number, number][],
): MatchSegment[] {
  if (!ranges.length) {
    return [{ text, hit: false }];
  }
  let out: MatchSegment[] = [];
  let cursor = 0;
  for (let [start, end] of ranges) {
    if (start > cursor) {
      out.push({ text: text.slice(cursor, start), hit: false });
    }
    out.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), hit: false });
  }
  return out;
}

// ── The command palette ──────────────────────────────────────────────────

interface PaletteEntry {
  key: string;
  node: LeafNode;
  /** ancestor labels, outermost first — the breadcrumb a flattened tree needs */
  path: string[];
  label: string;
  shortcut?: string;
  keyshortcuts?: string;
  disabled: boolean;
  destructive: boolean;
  hasSubmenu: boolean;
  check: CheckState;
  checked?: string;
  description?: string;
  haystack: string;
}

interface PaletteRow extends PaletteEntry {
  id: string;
  segments: MatchSegment[];
  pathLabel?: string;
}

interface PaletteGroup {
  key: string;
  /** the scope/section these rows sit under, when browsing */
  label?: string;
  rows: PaletteRow[];
}

export interface CommandPaletteSignature {
  Args: {
    /** the same tree `Menu` renders — one definition, two surfaces */
    items: MenuEntry[];
    open?: boolean;
    onClose: () => void;
    /** opens the palette; supply it to enable @hotkey */
    onOpen?: () => void;
    /** global shortcut that opens the palette (default 'Mod+K'); needs @onOpen */
    hotkey?: string;
    /** input placeholder */
    placeholder?: string;
    /** accessible name */
    label?: string;
    /** shown when nothing matches */
    emptyMessage?: string;
    /** fires after any command runs */
    onSelect?: (node: LeafNode) => void;
    /** force the shortcut platform */
    platform?: ShortcutPlatform;
  };
  Element: HTMLDialogElement;
}

/** Keeps the palette's native <dialog> in sync with @open and owns its
 * cancel/click listeners — `{{on}}` on a <dialog> is rejected by lint. */
const paletteModal = modifier(
  (
    el: HTMLDialogElement,
    [open, onCancel, onClick]: [
      boolean | undefined,
      (event: Event) => void,
      (event: Event) => void,
    ],
  ) => {
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  },
);

/** A non-passive document keydown for the palette's global hotkey — it has to
 * preventDefault, which a passive listener may not. Removed on teardown. */
const hotkeyListener = modifier(
  (_el: HTMLElement, [handler]: [(event: Event) => void]) => {
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  },
);

/** Scrolls the active row into view — no timer, and no smooth scroll that
 * would lag behind held arrow keys. */
const scrollIntoViewWhen = modifier((el: HTMLElement, [should]: [boolean]) => {
  if (should) {
    el.scrollIntoView({ block: 'nearest' });
  }
});

export class CommandPalette extends Component<CommandPaletteSignature> {
  private guid = guidFor(this);
  @tracked private query = '';
  /** keys of the submenu scopes the reader has descended into (kbar's model,
   * which is how nesting survives being flattened) */
  @tracked private scope: string[] = [];
  @tracked private activeKey: string | undefined;

  get platform(): ShortcutPlatform {
    return this.args.platform ?? detectShortcutPlatform();
  }
  get label(): string {
    return this.args.label ?? 'Command palette';
  }
  get placeholder(): string {
    return this.args.placeholder ?? 'Type a command or search…';
  }
  get emptyMessage(): string {
    return this.args.emptyMessage ?? 'No matching commands';
  }
  get listId(): string {
    return `${this.guid}-list`;
  }
  get inputId(): string {
    return `${this.guid}-input`;
  }
  get searching(): boolean {
    return this.query.trim().length > 0;
  }

  private entryFor(node: LeafNode, key: string, path: string[]): PaletteEntry {
    let check = checkStateOf(node);
    let label = node.needsInput ? `${node.label}${ELLIPSIS}` : node.label;
    return {
      key,
      node,
      path,
      label,
      shortcut: formatShortcut(node.kbd, this.platform),
      keyshortcuts: ariaKeyShortcuts(node.kbd, this.platform),
      disabled: !!node.disabled,
      destructive: !!node.destructive,
      hasSubmenu: (node.kind ?? 'command') === 'submenu',
      check,
      checked: checkedAttr(check),
      description: node.description,
      haystack: [label, node.description, node.keywords, ...path]
        .filter(Boolean)
        .join(' '),
    };
  }

  /** Walks a level, flattening sections (presentation, not scope) and
   * recursing into submenus when `deep`. */
  private collect(
    entries: MenuEntry[],
    prefix: string,
    path: string[],
    deep: boolean,
    out: PaletteEntry[],
  ) {
    let ordinal = 0;
    for (let entry of entries) {
      if (isSeparator(entry)) {
        continue;
      }
      if (isSection(entry)) {
        this.collect(entry.items, prefix, [...path, entry.label], deep, out);
        continue;
      }
      let key = `${prefix}.${ordinal++}`;
      let node = entry as LeafNode;
      out.push(this.entryFor(node, key, path));
      if (deep && (node.kind ?? 'command') === 'submenu') {
        this.collect(
          (node as SubmenuNode).items ?? [],
          key,
          [...path, node.label],
          true,
          out,
        );
      }
    }
  }

  /** Walks down the scope stack, returning the entries the current scope
   * exposes: its immediate children when browsing, everything beneath it
   * when searching. */
  private get scopedEntries(): PaletteEntry[] {
    let entries = this.args.items ?? [];
    let prefix = 'p';
    let path: string[] = [];
    for (let key of this.scope) {
      let level: PaletteEntry[] = [];
      this.collect(entries, prefix, path, false, level);
      let parent = level.find((entry) => entry.key === key);
      if (!parent || !parent.hasSubmenu) {
        break;
      }
      entries = (parent.node as SubmenuNode).items ?? [];
      prefix = key;
      path = [...path, parent.node.label];
    }
    let out: PaletteEntry[] = [];
    this.collect(entries, prefix, path, this.searching, out);
    return out;
  }

  /** Breadcrumb labels for the scopes the reader descended into. */
  get crumbs(): string[] {
    let entries = this.args.items ?? [];
    let prefix = 'p';
    let out: string[] = [];
    for (let key of this.scope) {
      let level: PaletteEntry[] = [];
      this.collect(entries, prefix, [], false, level);
      let parent = level.find((entry) => entry.key === key);
      if (!parent) {
        break;
      }
      out.push(parent.node.label);
      entries = (parent.node as SubmenuNode).items ?? [];
      prefix = key;
    }
    return out;
  }

  get rows(): PaletteRow[] {
    let query = this.query.trim();
    let scoped = this.scopedEntries;
    if (!query) {
      return scoped.map((entry) => ({
        ...entry,
        id: `${this.guid}-${entry.key}`,
        segments: [{ text: entry.label, hit: false }],
        pathLabel: entry.path.length ? entry.path.join(' › ') : undefined,
      }));
    }
    let scored: { entry: PaletteEntry; match: FuzzyMatch }[] = [];
    for (let entry of scoped) {
      let onLabel = fuzzyMatch(query, entry.label);
      if (onLabel) {
        scored.push({ entry, match: onLabel });
        continue;
      }
      // a keyword/description/path hit still counts, but ranks below every
      // label hit and highlights nothing (the match is not in the label)
      let wider = fuzzyMatch(query, entry.haystack);
      if (wider) {
        scored.push({ entry, match: { score: wider.score - 40, ranges: [] } });
      }
    }
    scored.sort((a, b) => b.match.score - a.match.score);
    return scored.map(({ entry, match }) => ({
      ...entry,
      id: `${this.guid}-${entry.key}`,
      segments: matchSegments(entry.label, match.ranges),
      pathLabel: entry.path.length ? entry.path.join(' › ') : undefined,
    }));
  }

  /** One unlabelled run while searching — rank order is the only order that
   * means anything — and section groups while browsing. */
  get groups(): PaletteGroup[] {
    let rows = this.rows;
    if (this.searching) {
      return [{ key: 'results', rows }];
    }
    let out: PaletteGroup[] = [];
    for (let row of rows) {
      let label = row.path[row.path.length - 1];
      let last = out[out.length - 1];
      if (last && last.label === label) {
        last.rows.push(row);
      } else {
        out.push({ key: `${row.key}-g`, label, rows: [row] });
      }
    }
    return out;
  }

  get hasRows(): boolean {
    return this.rows.length > 0;
  }
  get activeRow(): PaletteRow | undefined {
    let rows = this.rows;
    return rows.find((row) => row.key === this.activeKey) ?? rows[0];
  }
  get activeId(): string | undefined {
    return this.activeRow?.id;
  }
  get resultSummary(): string {
    if (!this.searching) {
      return '';
    }
    let count = this.rows.length;
    return count === 1 ? '1 command' : `${count} commands`;
  }
  isActive = (row: PaletteRow): boolean => row.key === this.activeRow?.key;

  // ── Interaction ───────────────────────────────────────────────────────

  private reset() {
    this.query = '';
    this.activeKey = undefined;
  }

  onInput = (event: Event) => {
    this.query = (event.target as HTMLInputElement).value;
    this.activeKey = undefined;
  };

  private enterScope(row: PaletteRow) {
    this.scope = [...this.scope, row.key];
    this.reset();
  }

  private popScope() {
    if (this.scope.length === 0) {
      this.close();
      return;
    }
    this.scope = this.scope.slice(0, -1);
    this.reset();
  }

  close = () => {
    this.scope = [];
    this.reset();
    this.args.onClose();
  };

  run = (row: PaletteRow | undefined) => {
    if (!row || row.disabled) {
      return;
    }
    if (row.hasSubmenu) {
      this.enterScope(row);
      return;
    }
    let node = row.node;
    if (node.kind === 'toggle') {
      node.onChange?.(node.checked !== true);
    }
    node.onSelect?.();
    this.args.onSelect?.(node);
    this.close();
  };

  onRowClick = (row: PaletteRow) => this.run(row);

  private move(delta: number) {
    let rows = this.rows;
    if (!rows.length) {
      return;
    }
    let index = rows.findIndex((row) => row.key === this.activeRow?.key);
    this.activeKey = rows[(index + delta + rows.length) % rows.length].key;
  }

  onKeydown = (raw: Event) => {
    let event = raw as KeyboardEvent;
    let key = event.key;
    let empty = !this.query;
    if (key === 'ArrowDown') {
      event.preventDefault();
      this.move(1);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1);
    } else if (key === 'Home' && empty) {
      event.preventDefault();
      this.activeKey = this.rows[0]?.key;
    } else if (key === 'End' && empty) {
      event.preventDefault();
      this.activeKey = this.rows[this.rows.length - 1]?.key;
    } else if (key === 'Enter') {
      event.preventDefault();
      this.run(this.activeRow);
    } else if (key === 'ArrowRight' && empty && this.activeRow?.hasSubmenu) {
      event.preventDefault();
      this.enterScope(this.activeRow);
    } else if (
      empty &&
      this.scope.length > 0 &&
      (key === 'Backspace' || key === 'ArrowLeft')
    ) {
      event.preventDefault();
      this.popScope();
    } else if (key === 'Escape') {
      // Escape leaves one scope at a time, exactly like Menu closes one
      // level. preventDefault keeps the <dialog>'s own cancel from firing
      // and popping a second time.
      event.preventDefault();
      event.stopPropagation();
      this.popScope();
    }
  };

  /** Backstop for an Escape that did not reach the input. */
  onCancel = (event: Event) => {
    event.preventDefault();
    this.close();
  };
  onDialogClick = (event: Event) => {
    if (event.target === event.currentTarget) {
      this.close();
    }
  };

  onHotkey = (event: Event) => {
    let ev = event as KeyboardEvent;
    let parsed = parseShortcut(this.args.hotkey ?? 'Mod+K', this.platform);
    if (!parsed || !this.args.onOpen || this.args.open) {
      return;
    }
    let wanted = new Set(parsed.mods);
    if (
      ev.metaKey !== wanted.has('Meta') ||
      ev.ctrlKey !== wanted.has('Control') ||
      ev.altKey !== wanted.has('Alt') ||
      ev.shiftKey !== wanted.has('Shift')
    ) {
      return;
    }
    if (ev.key.toLowerCase() !== parsed.key.toLowerCase()) {
      return;
    }
    ev.preventDefault();
    this.args.onOpen();
  };

  /** Focuses the input whenever the palette opens. */
  focusOnOpen = modifier(
    (el: HTMLInputElement, [open]: [boolean | undefined]) => {
      if (open) {
        el.focus();
        el.select();
      }
    },
  );

  <template>
    <dialog
      class='pretui-palette'
      aria-label={{this.label}}
      data-test-pretui-command-palette
      {{paletteModal @open this.onCancel this.onDialogClick}}
      {{hotkeyListener this.onHotkey}}
      ...attributes
    >
      <div class='pal-shell'>
        <div class='pal-field'>
          {{#if this.crumbs.length}}
            <span class='pal-crumbs' data-test-pretui-palette-crumbs>
              {{#each this.crumbs key='@index' as |crumb|}}
                <span class='pal-crumb'>{{crumb}}</span>
              {{/each}}
            </span>
          {{/if}}
          {{! A real <label>, visually hidden, rather than aria-label: realm
              lint counts aria-label alongside anything else that names the
              field as two labels, and the element the spec actually wants
              here is a label. }}
          <label for={{this.inputId}} class='pal-sr'>{{this.label}}</label>
          <span class='pal-inputwrap'>
            {{#unless this.query}}
              {{! a painted hint rather than a `placeholder` attribute: the
                  attribute counts as a second label beside aria-label (realm
                  lint), and a placeholder was never a label to begin with }}
              <span class='pal-ghost' aria-hidden='true'>{{this.placeholder}}</span>
            {{/unless}}
            <input
            id={{this.inputId}}
            class='pal-input'
            type='text'
            role='combobox'
            autocomplete='off'
            spellcheck='false'
            aria-expanded='true'
            aria-controls={{this.listId}}
            aria-autocomplete='list'
            aria-activedescendant={{this.activeId}}
            value={{this.query}}
            data-test-pretui-palette-input
            {{this.focusOnOpen @open}}
            {{on 'input' this.onInput}}
            {{on 'keydown' this.onKeydown}}
            />
          </span>
        </div>

        {{#if this.hasRows}}
          {{! Flat by necessity AND by choice: realm lint's require-context-role
              wants role='option' to be an immediate child of the listbox, so a
              role='group' wrapper is out. Nothing is lost to assistive tech —
              a row's own scope is written into it as pathLabel, which reads
              better than a group boundary a screen reader must remember. }}
          <menu
            id={{this.listId}}
            class='pal-list'
            role='listbox'
            aria-label={{this.label}}
          >
            {{#each this.groups key='key' as |group|}}
              {{#if group.label}}
                <li class='pal-group-label' role='presentation'>{{group.label}}</li>
              {{/if}}
              {{#each group.rows key='key' as |row|}}
                <li
                  class='pal-row'
                  role='option'
                  id={{row.id}}
                  aria-selected={{if (this.isActive row) 'true' 'false'}}
                  aria-disabled={{if row.disabled 'true'}}
                  aria-checked={{row.checked}}
                  aria-keyshortcuts={{row.keyshortcuts}}
                  data-active={{if (this.isActive row) 'true'}}
                  data-destructive={{if row.destructive 'true'}}
                  data-check={{row.check}}
                  {{scrollIntoViewWhen (this.isActive row)}}
                  {{on 'click' (fn this.onRowClick row)}}
                >
                  <span class='pal-check' aria-hidden='true'></span>
                  <span class='pal-text'>
                    <span class='pal-label'>
                      {{#each row.segments key='@index' as |segment|}}
                        {{#if segment.hit}}
                          <span class='pal-hit'>{{segment.text}}</span>
                        {{else}}
                          <span>{{segment.text}}</span>
                        {{/if}}
                      {{/each}}
                    </span>
                    {{#if row.description}}
                      <span class='pal-desc'>{{row.description}}</span>
                    {{else if row.pathLabel}}
                      <span class='pal-path'>{{row.pathLabel}}</span>
                    {{/if}}
                  </span>
                  {{#if row.shortcut}}
                    <span
                      class='pal-kbd'
                      aria-hidden='true'
                    >{{row.shortcut}}</span>
                  {{/if}}
                  {{#if row.hasSubmenu}}
                    <span class='pal-chevron' aria-hidden='true'></span>
                  {{/if}}
                </li>
              {{/each}}
            {{/each}}
          </menu>
        {{else}}
          <div class='pal-empty'>{{this.emptyMessage}}</div>
        {{/if}}

        {{! one polite announcement of the result count — never per keystroke
            in an assertive channel }}
        <span class='pal-sr' role='status'>{{this.resultSummary}}</span>

        <div class='pal-footer'>
          <span class='pal-hint'><Kbd @value='ArrowUp' /><Kbd
              @value='ArrowDown'
            />
            navigate</span>
          <span class='pal-hint'><Kbd @value='Enter' />
            run</span>
          <span class='pal-hint'><Kbd @value='Escape' />
            {{if this.crumbs.length 'back' 'close'}}</span>
        </div>
      </div>
    </dialog>

    <style scoped>
      .pretui-palette {
        border: 0;
        padding: 0;
        width: min(620px, calc(100vw - 32px));
        max-height: min(70dvh, 560px);
        margin-block-start: 12vh;
        background: var(--popover);
        color: var(--foreground);
        border-radius: var(--radius-surface, 12px);
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 16px 48px rgb(16 24 40 / 0.22)
        );
        font-family: var(--font-sans);
        overflow: hidden;
        opacity: 1;
        transform: none;
        transition:
          opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-palette::backdrop {
        background: var(--pretui-overlay-scrim, rgb(16 24 40 / 0.4));
      }
      @starting-style {
        .pretui-palette[open] {
          opacity: 0;
          transform: translateY(-8px) scale(0.985);
        }
      }
      .pal-shell {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        max-height: inherit;
      }
      .pal-field {
        display: flex;
        align-items: center;
        gap: 6px;
        padding-block: 10px;
        padding-inline: 14px;
        box-shadow: 0 1px 0 var(--border);
      }
      .pal-crumbs {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
      }
      .pal-crumb {
        padding-block: 2px;
        padding-inline: 7px;
        border-radius: var(--radius-chip, 5px);
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pal-inputwrap {
        position: relative;
        display: flex;
        flex: 1;
        min-width: 0;
      }
      .pal-ghost {
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        display: flex;
        align-items: center;
        font-size: var(--text-body, 15px);
        color: var(--muted-foreground);
        pointer-events: none;
      }
      .pal-input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-size: var(--text-body, 15px);
        padding-block: 4px;
        padding-inline: 0;
      }
      .pal-input:focus {
        outline: none;
      }
      .pal-input::placeholder {
        color: var(--muted-foreground);
      }
      .pal-list {
        margin: 0;
        padding: 6px;
        list-style: none;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .pal-list menu {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pal-group-label {
        display: block;
        padding-block: 6px 3px;
        padding-inline: 9px;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pal-row {
        display: grid;
        grid-template-columns: 15px 1fr auto;
        align-items: center;
        gap: 9px;
        min-height: 36px;
        padding-block: 5px;
        padding-inline: 7px 10px;
        border-radius: var(--radius-control, 7px);
        cursor: default;
        scroll-margin: 8px;
      }
      .pal-row[data-active='true'] {
        background: var(--hover, var(--boxel-100));
      }
      .pal-row[data-destructive='true'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pal-row[aria-disabled='true'] {
        opacity: 0.42;
      }
      .pal-text {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .pal-label {
        font-size: var(--text-ui-md, 12.5px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pal-hit {
        color: var(--pretui-palette-hit, var(--primary));
        font-weight: 600;
      }
      .pal-desc,
      .pal-path {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pal-kbd {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pal-check {
        position: relative;
        width: 15px;
        height: 15px;
      }
      .pal-row[data-check='on'] .pal-check::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 4px;
        width: 5px;
        height: 9px;
        border: solid currentColor;
        border-width: 0 1.75px 1.75px 0;
        transform: rotate(43deg);
      }
      .pal-row[data-check='mixed'] .pal-check::after {
        content: '';
        position: absolute;
        inset-block-start: 6px;
        inset-inline-start: 2px;
        width: 9px;
        height: 1.75px;
        background: currentColor;
        border-radius: 1px;
      }
      .pal-chevron {
        position: relative;
        width: 10px;
        height: 10px;
      }
      .pal-chevron::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border: solid currentColor;
        border-width: 1.5px 1.5px 0 0;
        transform: rotate(45deg);
        opacity: 0.75;
      }
      .pal-empty {
        padding-block: 34px;
        text-align: center;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .pal-footer {
        display: flex;
        align-items: center;
        gap: 14px;
        padding-block: 8px;
        padding-inline: 14px;
        box-shadow: 0 -1px 0 var(--border);
        background: var(--inset, var(--boxel-100));
      }
      .pal-hint {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pal-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      @media (any-pointer: coarse) {
        .pal-row {
          min-height: 44px;
        }
        .pal-footer {
          display: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-palette {
          transition: none;
        }
      }
    </style>
  </template>
}

