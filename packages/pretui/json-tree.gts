// Pretui — json-tree: a JSON viewer (`JsonTree`) and a structural JSON editor
// (`JsonEditor`), both built on the `json-model.ts` document model.
//
// PORTED, NOT VENDORED. The reference is JsonTree.js v4.7.1 (MIT, (c) 2025
// William Troup / Bunoon), read from the local checkout at tag `4.7.1`,
// commit ac7208d79d59dae85933330b93b691b8661d10d7, clean tree. Not one line
// of its code ships here and nothing of it is bundled into the realm. Three
// reasons, in order of severity:
//
//   1. Its parser falls back to `eval()` when `JSON.parse` throws
//      (src/ts/data/convert.ts, `jsonStringToObject`). Running that over text
//      a user typed is arbitrary code execution. Disqualifying on its own.
//   2. Its editing surface is `contenteditable` spans dressed by its own
//      stylesheet — and a side-effect CSS import fails realm indexing, so the
//      stylesheet could never come along. An editor whose controls are not
//      OUR controls has the wrong typography, the wrong focus ring, the wrong
//      dark behaviour, and no label wiring.
//   3. Its edit semantics lose data. See json-model.ts's header for the four
//      specific failures. We wanted the interaction model, not the rules.
//
// So the library is a SPECIFICATION here: its feature list, its expand and
// collapse behaviour, its type vocabulary and its edge cases were the design
// input. Everything is re-implemented in Glimmer over Pretui controls.
//
// BETTER THAN THE INSPIRATION:
//   · Upstream has no ARIA at all — no roles, no `aria-expanded`, no keyboard
//     path whatsoever; the tree is divs and mouse handlers. `JsonTree`
//     implements the APG treeview in full and `JsonEditor` the APG treegrid.
//   · Upstream deletes a property when you clear its value, so `""` is
//     unreachable. Here removal is always an explicit, announced action.
//   · Upstream cannot change a value's type — every edit is coerced back to
//     the original type, and dropped silently when it will not fit. Here type
//     is a first-class operation and nothing is ever coerced behind the user.
//   · Upstream has no undo. Here undo and redo are structural.
//   · Upstream truncates nothing — a 50k-element array renders 50k rows. Here
//     containers page with an explicit, focusable "Showing N of M".
//
// REUSE: `Tree` (structure-data.gts) is the closest neighbour and this is a
// SIBLING rather than an extension — deliberately. `Tree`'s contract is
// `TreeNode { label, icon, badge, meta, children }`, a DISPLAY node. Routing
// JSON through it would force every value into `label: string`, erasing
// exactly the distinctions this component exists to show: `42` vs `"42"`,
// `""` vs `null`, `[]` vs `{}`. And `JsonEditor` needs `role='treegrid'`,
// which `Tree` cannot be talked into. What IS reused is the foundation
// Appendix L names — `focus.gts` (`focusWhen`, `rovingTabindex`, `listen`) —
// plus `Tree`'s flat-rows + roving-tabindex architecture, copied faithfully
// including the load-bearing `onFocusIn` early return.
//
// REALM LAWS OBSERVED: no timers, no rAF, no `Date.now()`, no `Math.random()`;
// no side-effect CSS import; no named container queries; no `.dark` branch and
// no `prefers-color-scheme` (every value is `var(--token, lightFallback)`);
// no `!important` / `:deep()` / `:global()`; no backtick-with-interpolation
// inside `<template>`; boolean attributes bound as `true | undefined`. User
// data is NEVER interpolated into an inline style — the only style value here
// is an indent level this module computed and clamped, routed through
// `cssStyle` regardless.

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
// `ember-modifier` resolves at realm runtime; Glint cannot see its types here
// (accepted parse baseline, same as overlay.gts / reading-extras.gts).
import { modifier } from 'ember-modifier';

import { Button, Checkbox, Input, Select, Textarea } from './controls';
import type { SelectOption } from './controls';
import { EmptyState } from './structure';
import { focusWhen, listen, rovingTabindex } from './focus';
import { cssStyle } from './pretui-css';
import {
  JsonHistory,
  addEntry,
  addItem,
  allContainerPaths,
  ancestorPaths,
  changeKind,
  childCount,
  emptyNodeOfKind,
  flattenJson,
  formatPath,
  fromPlainValue,
  moveChild,
  parseJson,
  pathKey,
  previewOf,
  readScalar,
  removeAt,
  renameKey,
  searchJson,
  setNode,
  stringifyJson,
  toPlainValue,
} from './json-model';
import type {
  EditResult,
  FlatRow,
  JsonDiagnostic,
  JsonKind,
  JsonNode,
  JsonPath,
} from './json-model';

export type {
  JsonDiagnostic,
  JsonKind,
  JsonNode,
  JsonPath,
} from './json-model';

/* ------------------------------------------------------------------ *
 * Shared vocabulary
 * ------------------------------------------------------------------ */

/** Short type badge text. Machine values, so they render in mono (Law 3). */
const KIND_LABEL: Record<JsonKind, string> = {
  null: 'null',
  boolean: 'bool',
  number: 'num',
  string: 'str',
  array: 'arr',
  object: 'obj',
};

const KIND_OPTIONS: SelectOption[] = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'null', label: 'null' },
  { value: 'array', label: 'array' },
  { value: 'object', label: 'object' },
];

/** One rendered row: the model's `FlatRow` plus everything the template needs. */
interface ViewRow extends FlatRow {
  /** The `--_level` indent channel. */
  style: ReturnType<typeof cssStyle>;
  kind: JsonKind;
  kindLabel: string;
  /** Property name, array index, or the root's `$`. */
  keyLabel: string;
  /** Single-line value rendering. Strings carry their quotes so `"42"` and
   * `42` are never confusable. */
  preview: string;
  /** `'2'` on a container row, `''` otherwise. */
  countLabel: string;
  /** `$.users[0].name` — the copy-path payload and the accessible-name stem. */
  pathLabel: string;
  matched: boolean;
  /** TRUE for the "Showing N of M" notice row. */
  isOverflow: boolean;
  overflowLabel: string;
  /** TRUE when this row sits inside an object, so its key is renameable. */
  inObject: boolean;
  /** TRUE for arrays and objects — the rows that can gain children. */
  isContainerRow: boolean;
}

const EMPTY_REVEALED: ReadonlyMap<string, number> = new Map();

/**
 * Write text to the clipboard when the platform offers one. Deliberately
 * fire-and-forget and deliberately guarded: `navigator.clipboard` is absent
 * in the test environment and over plain HTTP, and a JSON viewer must not
 * throw because a copy button was pressed.
 */
function copyToClipboard(text: string): void {
  const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    void clip.writeText(text).catch(() => undefined);
  }
}

/**
 * Hand a render-time finding to a caller callback AFTER the render
 * transaction. A getter cannot do this: `@onParseError` typically writes
 * tracked state, and writing it mid-render is a backtracking rerender. A
 * modifier body runs after the DOM is settled, which is the legal seam.
 */
const reportDiagnostics = modifier(
  (
    _el: HTMLElement,
    [diagnostics, report]: [
      ReadonlyArray<JsonDiagnostic>,
      ((d: ReadonlyArray<JsonDiagnostic>) => void) | undefined,
    ],
  ) => {
    report?.(diagnostics);
  },
);

function quotedPreview(node: JsonNode): string {
  const text = previewOf(node);
  return node.kind === 'string' ? '"' + text + '"' : text;
}

/* ------------------------------------------------------------------ *
 * The shared row engine
 * ------------------------------------------------------------------ */

/**
 * Everything `JsonTree` and `JsonEditor` share: document resolution, the
 * expand/collapse model, search, truncation, roving focus and the navigation
 * half of the keyboard map. Not a component in its own right.
 */
abstract class JsonRowsBase<S> extends Component<S> {
  /** Expanded container paths as `pathKey` strings; `undefined` until the
   * reader touches expansion, so `@defaultExpanded` stays authoritative
   * without needing a constructor. */
  @tracked protected userExpanded: string[] | undefined = undefined;
  @tracked protected focusId: string | undefined = undefined;
  /** True only while the keyboard is driving, so `focusWhen` never fires on a
   * pointer path or a plain re-render (the `Tree` contract). */
  @tracked protected navigating = false;
  /** Per-container reveal windows raised by "show more". */
  @tracked protected revealed: ReadonlyMap<string, number> = EMPTY_REVEALED;
  /** The polite live-region text. */
  @tracked protected announcement = '';

  protected abstract get root(): JsonNode | undefined;
  protected abstract get treeLabel(): string;
  protected abstract get pageSize(): number;
  protected abstract get query(): string;
  /** Expansion before the reader has touched anything. */
  protected abstract get seedExpanded(): string[];

  protected announce(message: string): void {
    this.announcement = message;
  }

  protected get baseExpanded(): string[] {
    return this.userExpanded ?? this.seedExpanded;
  }

  protected get expandedSet(): Set<string> {
    const base = new Set(this.baseExpanded);
    // A search hit is useless inside a collapsed branch, so matches pull
    // their ancestors open WITHOUT disturbing the reader's own expansion
    // state — clearing the query restores exactly what they had.
    const needle = this.query;
    const doc = this.root;
    if (needle !== '' && doc !== undefined) {
      for (const hit of searchJson(doc, needle)) {
        for (const ancestor of ancestorPaths(hit.path)) {
          base.add(pathKey(ancestor));
        }
        base.add(pathKey(hit.path));
      }
    }
    return base;
  }

  protected get matchedIds(): Set<string> {
    const needle = this.query;
    const doc = this.root;
    if (needle === '' || doc === undefined) {
      return new Set();
    }
    const out = new Set<string>();
    for (const hit of searchJson(doc, needle)) {
      const key = pathKey(hit.path);
      out.add(key === '' ? '$' : key);
    }
    return out;
  }

  get matchCount(): number {
    return this.matchedIds.size;
  }

  get hasQuery(): boolean {
    return this.query !== '';
  }

  /** The search summary — `'3 matches'`, or the no-results message. */
  get matchLabel(): string {
    const total = this.matchCount;
    if (total === 0) {
      return 'No matches';
    }
    return total === 1 ? '1 match' : String(total) + ' matches';
  }

  get rows(): ViewRow[] {
    const doc = this.root;
    if (doc === undefined) {
      return [];
    }
    const matched = this.matchedIds;
    const flat = flattenJson(doc, {
      expanded: this.expandedSet,
      pageSize: this.pageSize,
      revealed: this.revealed,
    });
    const byId = new Map<string, FlatRow>();
    for (const row of flat) {
      byId.set(row.id, row);
    }

    return flat.map((row) => {
      const overflow = row.overflow;
      const count = childCount(row.node);
      const parent = row.parentId === undefined ? undefined : byId.get(row.parentId);
      return {
        ...row,
        style: cssStyle('--_level', String(Math.max(1, Math.min(60, row.level)))),
        kind: row.node.kind,
        kindLabel: KIND_LABEL[row.node.kind],
        keyLabel: row.label === undefined ? '$' : row.label,
        preview: quotedPreview(row.node),
        countLabel:
          row.node.kind === 'array' || row.node.kind === 'object' ? String(count) : '',
        pathLabel: formatPath(row.path),
        matched: matched.has(row.id),
        isOverflow: overflow !== undefined,
        overflowLabel:
          overflow === undefined
            ? ''
            : 'Showing ' + String(overflow.shown) + ' of ' + String(overflow.total),
        inObject: parent !== undefined && parent.node.kind === 'object',
        isContainerRow: row.node.kind === 'array' || row.node.kind === 'object',
      };
    });
  }

  get hasRows(): boolean {
    return this.rows.length > 0;
  }

  /** The single tab stop — the focused row, falling back to the first. */
  get rovingId(): string | undefined {
    const rows = this.rows;
    const current = this.focusId;
    if (current !== undefined && rows.some((row) => row.id === current)) {
      return current;
    }
    return rows[0]?.id;
  }

  @tracked protected selectedId: string | undefined = undefined;

  isSelected = (row: ViewRow): boolean => row.id === this.selectedId;
  selectedAttr = (row: ViewRow): string => (row.id === this.selectedId ? 'true' : 'false');
  isRoving = (row: ViewRow): boolean => row.id === this.rovingId;
  isFocusTarget = (row: ViewRow): boolean => this.navigating && row.id === this.rovingId;
  expandedAttr = (row: ViewRow): string | undefined =>
    row.expandable ? (row.expanded ? 'true' : 'false') : undefined;
  matchedAttr = (row: ViewRow): string | undefined => (row.matched ? 'true' : undefined);
  copyPathLabel = (row: ViewRow): string => 'Copy path ' + row.pathLabel;
  copyValueLabel = (row: ViewRow): string => 'Copy the value at ' + row.pathLabel;

  protected setExpanded(id: string, open: boolean): void {
    const next = new Set(this.baseExpanded);
    const key = id === '$' ? '' : id;
    if (open) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.userExpanded = Array.from(next);
  }

  protected moveTo(row: ViewRow | undefined): void {
    if (row === undefined) {
      return;
    }
    this.navigating = true;
    this.focusId = row.id;
  }

  protected rowFromEvent(event: Event): ViewRow | undefined {
    const target = event.target as HTMLElement | null;
    const el = target?.closest('[data-json-id]') as HTMLElement | null;
    const id = el === null ? undefined : el.dataset['jsonId'];
    return id === undefined ? undefined : this.rows.find((row) => row.id === id);
  }

  expandAll = (): void => {
    const doc = this.root;
    this.userExpanded = doc === undefined ? [] : Array.from(allContainerPaths(doc));
    this.announce('Expanded every container.');
  };

  collapseAll = (): void => {
    this.userExpanded = [];
    this.announce('Collapsed every container.');
  };

  reveal = (row: ViewRow): void => {
    const parentKey = pathKey(row.parentPath);
    const next = new Map(this.revealed);
    const current = Math.max(this.pageSize, next.get(parentKey) ?? 0);
    next.set(parentKey, current + this.pageSize);
    this.revealed = next;
    this.announce('Showing more items.');
  };

  copyPath = (row: ViewRow): void => {
    copyToClipboard(row.pathLabel);
    this.announce('Copied path ' + row.pathLabel + '.');
  };

  copyValue = (row: ViewRow): void => {
    copyToClipboard(stringifyJson(row.node, 2));
    this.announce('Copied the value at ' + row.pathLabel + '.');
  };

  // The early return is load-bearing, not an optimisation — `focusWhen`'s
  // `el.focus()` dispatches `focusin` SYNCHRONOUSLY during the render
  // transaction, and writing tracked state there is a backtracking rerender.
  // When the incoming row is already the roving one, the focus was ours.
  onFocusIn = (event: Event): void => {
    const row = this.rowFromEvent(event);
    if (row === undefined || row.id === this.rovingId) {
      return;
    }
    this.navigating = false;
    this.focusId = row.id;
  };

  /**
   * The shared half of the keyboard map: navigation, expansion and copy.
   * Returns TRUE when the key was consumed, so subclasses layer their own
   * bindings on top without re-deriving the row index.
   */
  protected handleNavigationKey(ev: KeyboardEvent, rows: ViewRow[], index: number): boolean {
    const row = rows[index];
    if (row === undefined) {
      return false;
    }
    const key = ev.key;

    if ((ev.metaKey || ev.ctrlKey) && (key === 'c' || key === 'C')) {
      ev.preventDefault();
      if (ev.shiftKey) {
        this.copyPath(row);
      } else {
        this.copyValue(row);
      }
      return true;
    }
    if (ev.altKey || ev.metaKey || ev.ctrlKey) {
      return false;
    }

    if (key === 'ArrowDown') {
      ev.preventDefault();
      this.moveTo(rows[Math.min(rows.length - 1, index + 1)]);
      return true;
    }
    if (key === 'ArrowUp') {
      ev.preventDefault();
      this.moveTo(rows[Math.max(0, index - 1)]);
      return true;
    }
    if (key === 'ArrowRight') {
      ev.preventDefault();
      if (row.expandable && !row.expanded) {
        this.focusId = row.id;
        this.setExpanded(row.id, true);
      } else if (row.expanded) {
        this.moveTo(rows[index + 1]);
      }
      return true;
    }
    if (key === 'ArrowLeft') {
      ev.preventDefault();
      if (row.expanded) {
        this.focusId = row.id;
        this.setExpanded(row.id, false);
      } else if (row.parentId !== undefined) {
        this.moveTo(rows.find((candidate) => candidate.id === row.parentId));
      }
      return true;
    }
    if (key === 'Home') {
      ev.preventDefault();
      this.moveTo(rows[0]);
      return true;
    }
    if (key === 'End') {
      ev.preventDefault();
      this.moveTo(rows[rows.length - 1]);
      return true;
    }
    if (key === '*') {
      // APG: expand every sibling at the focused row's level.
      ev.preventDefault();
      const next = new Set(this.baseExpanded);
      for (const sibling of rows) {
        if (sibling.parentId === row.parentId && sibling.expandable) {
          next.add(sibling.id === '$' ? '' : sibling.id);
        }
      }
      this.userExpanded = Array.from(next);
      return true;
    }
    return false;
  }

  /**
   * Single-character cycling type-ahead over property names. `focus.gts` now
   * offers a real multi-character `TypeaheadBuffer` on owned timers, but a
   * buffer is the wrong trade here: JSON keys are short and share long
   * prefixes (`id`, `items`, `image`), so cycling on one character reaches
   * them in fewer keystrokes than typing a discriminating prefix — and it
   * costs no timer at all.
   */
  protected handleTypeahead(ev: KeyboardEvent, rows: ViewRow[], index: number): boolean {
    const key = ev.key;
    if (key.length !== 1 || !/\S/.test(key)) {
      return false;
    }
    const ch = key.toLowerCase();
    for (let step = 1; step <= rows.length; step++) {
      const candidate = rows[(index + step) % rows.length];
      if (candidate !== undefined && candidate.keyLabel.toLowerCase().startsWith(ch)) {
        ev.preventDefault();
        this.moveTo(candidate);
        return true;
      }
    }
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * JsonTree — the read-only view
 * ------------------------------------------------------------------ */

export interface JsonTreeSignature {
  Args: {
    /** The document as text. Takes precedence over `@value` when both are set. */
    json?: string;
    /** The document as a plain JavaScript value — object, array or scalar. */
    value?: unknown;
    /** Accessible name for the tree. Defaulted, so nothing is required (Law 7). */
    label?: string;
    /** Container paths open on first render, as `pathKey` strings; `'$'` is
     * the root. Ignored once the reader expands anything themselves. */
    defaultExpanded?: string[];
    /** Open every container on first render. */
    expandAll?: boolean;
    /** Case-insensitive filter over property names and scalar values. */
    query?: string;
    /** Children rendered per container before truncating. Default 100. */
    pageSize?: number;
    /** Hide the toolbar (name, match count, expand/collapse all). */
    hideToolbar?: boolean;
    /** Fires with the node and its path on Enter, Space or click. */
    onSelect?: (node: JsonNode, path: JsonPath) => void;
    /** Fires when `@json` could not be parsed. Half-typed input reports too —
     * check `isIncomplete` before treating it as a mistake. */
    onParseError?: (diagnostics: ReadonlyArray<JsonDiagnostic>) => void;
  };
  Blocks: {
    /** Replaces the default EmptyState when there is nothing to show. */
    empty?: [];
  };
  Element: HTMLDivElement;
}

export class JsonTree extends JsonRowsBase<JsonTreeSignature> {
  /** The parse of `@json`. */
  private get parsed() {
    const text = this.args.json;
    return text === undefined ? undefined : parseJson(text);
  }

  protected get root(): JsonNode | undefined {
    const result = this.parsed;
    if (result !== undefined) {
      return result.ok ? result.root : undefined;
    }
    return this.args.value === undefined ? undefined : fromPlainValue(this.args.value);
  }

  protected get seedExpanded(): string[] {
    if (this.args.expandAll) {
      const doc = this.root;
      return doc === undefined ? [] : Array.from(allContainerPaths(doc));
    }
    const seed = this.args.defaultExpanded;
    if (seed !== undefined) {
      return seed.map((entry) => (entry === '$' ? '' : entry));
    }
    // Open the root so a document is never a single collapsed line.
    return [''];
  }

  /** Warnings the document carries — duplicate keys, imprecise numbers. */
  get warnings(): ReadonlyArray<JsonDiagnostic> {
    const result = this.parsed;
    return result !== undefined && result.ok ? result.diagnostics : [];
  }
  get hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  get parseError(): JsonDiagnostic | undefined {
    const result = this.parsed;
    if (result === undefined || result.ok) {
      return undefined;
    }
    return result.diagnostics.find((entry) => entry.severity === 'error');
  }

  /** Every diagnostic from the failed parse, for `@onParseError`. */
  get parseDiagnostics(): ReadonlyArray<JsonDiagnostic> {
    const result = this.parsed;
    return result !== undefined && !result.ok ? result.diagnostics : [];
  }

  /** TRUE when the text merely ran out — a pending state, not a wrong one. */
  get isIncomplete(): boolean {
    const result = this.parsed;
    return result !== undefined && !result.ok && result.incomplete;
  }

  protected get treeLabel(): string {
    return this.args.label ?? 'JSON document';
  }
  protected get pageSize(): number {
    return Math.max(1, this.args.pageSize ?? 100);
  }
  protected get query(): string {
    return (this.args.query ?? '').trim();
  }
  get showToolbar(): boolean {
    return !this.args.hideToolbar;
  }
  get noteSeverity(): string {
    return this.isIncomplete ? 'pending' : 'error';
  }
  get noteMark(): string {
    return this.isIncomplete ? '…' : '!';
  }

  get emptyMessage(): string {
    if (this.hasQuery) {
      return 'No property name or value matches this search.';
    }
    if (this.isIncomplete) {
      return 'Keep typing — this document is not finished yet.';
    }
    return 'There is no JSON to display.';
  }

  onClick = (event: Event): void => {
    const row = this.rowFromEvent(event);
    if (row === undefined) {
      return;
    }
    // The pointer already moved focus (tabindex=-1 elements are mouse
    // focusable) — do not let focusWhen fire a second time.
    this.navigating = false;
    this.focusId = row.id;

    const target = event.target as HTMLElement | null;
    const action = target === null ? null : target.closest('[data-json-action]');
    if (action !== null) {
      const which = (action as HTMLElement).dataset['jsonAction'];
      if (which === 'path') {
        this.copyPath(row);
      } else if (which === 'value') {
        this.copyValue(row);
      }
      return;
    }
    if (row.isOverflow) {
      this.reveal(row);
      return;
    }
    if (target !== null && target.closest('[data-json-twisty]') !== null && row.expandable) {
      this.setExpanded(row.id, !row.expanded);
      return;
    }
    this.selectedId = row.id;
    this.args.onSelect?.(row.node, row.path);
  };

  onKeydown = (event: Event): void => {
    const ev = event as KeyboardEvent;
    const rows = this.rows;
    const index = rows.findIndex((row) => row.id === this.rovingId);
    if (index < 0) {
      return;
    }
    const row = rows[index]!;

    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (row.isOverflow) {
        this.reveal(row);
        return;
      }
      if (row.expandable) {
        this.setExpanded(row.id, !row.expanded);
      }
      this.selectedId = row.id;
      this.args.onSelect?.(row.node, row.path);
      return;
    }
    if (this.handleNavigationKey(ev, rows, index)) {
      return;
    }
    this.handleTypeahead(ev, rows, index);
  };

  <template>
    <div class='pretui-json' data-test-pretui-json-tree ...attributes>
      {{#if this.showToolbar}}
        <div class='pretui-json-bar'>
          <span class='pretui-json-bar-name'>{{this.treeLabel}}</span>
          {{#if this.hasQuery}}
            <span class='pretui-json-count' data-test-pretui-json-matches>
              {{this.matchLabel}}
            </span>
          {{/if}}
          <span class='pretui-json-gap'></span>
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='xs'
            data-test-pretui-json-expand-all
            {{on 'click' this.expandAll}}
          >Expand all</Button>
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='xs'
            data-test-pretui-json-collapse-all
            {{on 'click' this.collapseAll}}
          >Collapse all</Button>
        </div>
      {{/if}}

      {{#if this.parseError}}
        <p
          class='pretui-json-note'
          data-severity={{this.noteSeverity}}
          data-test-pretui-json-parse-error
          {{reportDiagnostics this.parseDiagnostics @onParseError}}
        >
          <span class='pretui-json-note-mark' aria-hidden='true'>{{this.noteMark}}</span>
          <span>
            {{#unless this.isIncomplete}}
              <span class='pretui-json-note-at'>
                Line
                {{this.parseError.line}}, column
                {{this.parseError.column}}:
              </span>
            {{/unless}}
            {{this.parseError.message}}
          </span>
        </p>
      {{/if}}

      {{#if this.hasWarnings}}
        <ul class='pretui-json-notes' data-test-pretui-json-warnings>
          {{#each this.warnings key='message' as |warning|}}
            <li class='pretui-json-note' data-severity='warning'>
              <span class='pretui-json-note-mark' aria-hidden='true'>!</span>
              <span>{{warning.message}}</span>
            </li>
          {{/each}}
        </ul>
      {{/if}}

      {{#if this.hasRows}}
        <ul
          class='pretui-json-list'
          role='tree'
          aria-label={{this.treeLabel}}
          {{listen 'click' this.onClick}}
          {{listen 'keydown' this.onKeydown}}
          {{listen 'focusin' this.onFocusIn}}
        >
          {{#each this.rows key='id' as |row|}}
            <li
              class='pretui-json-row'
              role='treeitem'
              data-json-id={{row.id}}
              data-kind={{row.kind}}
              data-matched={{this.matchedAttr row}}
              aria-level={{row.level}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{this.expandedAttr row}}
              aria-selected={{this.selectedAttr row}}
              style={{row.style}}
              {{rovingTabindex (this.isRoving row)}}
              {{focusWhen (this.isFocusTarget row)}}
            >
              {{#if row.isOverflow}}
                <span class='pretui-json-more' data-test-pretui-json-overflow>
                  {{row.overflowLabel}}
                  <span class='pretui-json-more-cue'>· Enter shows more</span>
                </span>
              {{else}}
                <span
                  class='pretui-json-twisty'
                  data-json-twisty
                  data-open={{if row.expanded 'true'}}
                  data-leaf={{unless row.expandable 'true'}}
                  aria-hidden='true'
                ></span>
                <span class='pretui-json-key'>{{row.keyLabel}}</span>
                <span class='pretui-json-kind' aria-hidden='true'>{{row.kindLabel}}</span>
                <span class='pretui-json-value'>{{row.preview}}</span>
                {{#if row.countLabel}}
                  <span class='pretui-json-n' aria-hidden='true'>{{row.countLabel}}</span>
                {{/if}}
                {{! Pointer affordances only. They CANNOT be buttons: a
                    <button> inside role='treeitem' is nested-interactive, and
                    its label would be folded into the treeitem's accessible
                    name. The keyboard path is on the row itself — Ctrl/Cmd+C
                    copies the value, Ctrl/Cmd+Shift+C copies the path — so
                    nothing here is pointer-only. }}
                <span class='pretui-json-acts' aria-hidden='true'>
                  <span class='pretui-json-act' data-json-action='path'>path</span>
                  <span class='pretui-json-act' data-json-action='value'>copy</span>
                </span>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState
          @title='Nothing to show'
          @message={{this.emptyMessage}}
          @texture={{false}}
        />
      {{/if}}

      <p class='pretui-json-live' aria-live='polite' data-test-pretui-json-live>
        {{this.announcement}}
      </p>
    </div>

    <style scoped>
      /* Every value is var(--token, lightFallback); zero dark branches — the
         season re-resolves the tokens and the whole component re-tints. */
      .pretui-json {
        --_indent: var(--pretui-json-indent, 14px);
        --_row-h: var(--pretui-json-row-height, 24px);
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 6px);
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
        container-type: inline-size;
      }

      .pretui-json-bar {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        min-height: var(--control-h, 28px);
      }
      .pretui-json-bar-name {
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-json-count {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pretui-json-gap {
        flex: 1 1 auto;
      }

      /* Notes never signal by colour alone — each carries a glyph and a word. */
      .pretui-json-notes {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .pretui-json-note {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2, 6px);
        margin: 0;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.45;
        background: color-mix(in oklch, var(--muted-foreground) 8%, transparent);
        color: var(--foreground);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-json-note[data-severity='error'] {
        background: color-mix(in oklch, var(--destructive) 10%, transparent);
      }
      .pretui-json-note[data-severity='warning'] {
        background: color-mix(in oklch, var(--warning, var(--boxel-warning)) 12%, transparent);
      }
      .pretui-json-note-mark {
        flex: 0 0 auto;
        width: 14px;
        text-align: center;
        font-weight: 700;
      }
      .pretui-json-note-at {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }

      .pretui-json-list {
        list-style: none;
        margin: 0;
        padding: var(--space-2, 6px) 0;
        border-radius: var(--radius-surface, 10px);
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        overflow: auto;
        max-height: var(--pretui-json-max-height, 26rem);
      }

      .pretui-json-row {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-height: var(--_row-h);
        padding-inline-start: calc(var(--space-3, 8px) + (var(--_level, 1) - 1) * var(--_indent));
        padding-inline-end: var(--space-3, 8px);
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        cursor: default;
        outline: none;
      }
      .pretui-json-row:hover {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-json-row:focus-visible {
        box-shadow: inset 0 0 0 2px var(--ring);
        border-radius: var(--radius-chip, 6px);
      }
      /* A search hit is marked by a rule AND a background, never colour alone. */
      .pretui-json-row[data-matched='true'] {
        background: color-mix(in oklch, var(--primary) 12%, transparent);
        box-shadow: inset 3px 0 0 0 var(--primary);
      }

      .pretui-json-twisty {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        position: relative;
      }
      .pretui-json-twisty[data-leaf='true'] {
        visibility: hidden;
      }
      .pretui-json-twisty::before {
        content: '';
        position: absolute;
        inset-block-start: 1px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border-inline-end: 1.5px solid var(--muted-foreground);
        border-block-end: 1.5px solid var(--muted-foreground);
        transform: rotate(-45deg);
        transition: transform var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-twisty[data-open='true']::before {
        transform: rotate(45deg);
      }

      .pretui-json-key {
        flex: 0 0 auto;
        color: var(--foreground);
        font-weight: 600;
        max-width: 16rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-json-kind {
        flex: 0 0 auto;
        padding: 0 4px;
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-xs, 11px);
        line-height: 1.5;
        color: var(--muted-foreground);
        background: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
      }
      /* Type identity is a WORD in the badge; the tint is redundant emphasis. */
      .pretui-json-row[data-kind='string'] .pretui-json-value {
        color: var(--chart-1);
      }
      .pretui-json-row[data-kind='number'] .pretui-json-value {
        color: var(--chart-2);
      }
      .pretui-json-row[data-kind='boolean'] .pretui-json-value {
        color: var(--chart-4);
      }
      .pretui-json-row[data-kind='null'] .pretui-json-value {
        color: var(--muted-foreground);
        font-style: italic;
      }
      .pretui-json-row[data-kind='array'] .pretui-json-value,
      .pretui-json-row[data-kind='object'] .pretui-json-value {
        color: var(--muted-foreground);
      }

      .pretui-json-value {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-json-n {
        flex: 0 0 auto;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }

      .pretui-json-acts {
        flex: 0 0 auto;
        display: flex;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-row:hover .pretui-json-acts,
      .pretui-json-row:focus-visible .pretui-json-acts,
      .pretui-json-acts:focus-within {
        opacity: 1;
      }
      /* Coarse pointers have no hover, so the actions are always present. */
      @media (any-pointer: coarse) {
        .pretui-json-acts {
          opacity: 1;
        }
      }
      .pretui-json-act {
        appearance: none;
        border: 0;
        min-height: 18px;
        padding: 1px 5px;
        border-radius: var(--radius-chip, 6px);
        font: inherit;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        background: var(--card);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        cursor: pointer;
      }
      .pretui-json-act:hover {
        color: var(--foreground);
      }
      /* Selection reads as a rule plus a tint, never colour alone. */
      .pretui-json-row[aria-selected='true'] {
        background: color-mix(in oklch, var(--primary) 8%, transparent);
        box-shadow: inset 2px 0 0 0 var(--foreground);
      }

      .pretui-json-more {
        flex: 1 1 auto;
        color: var(--muted-foreground);
        font-style: italic;
      }
      .pretui-json-more-cue {
        font-size: var(--text-ui-xs, 11px);
        opacity: 0.8;
      }

      /* The live region is announced, never seen. */
      .pretui-json-live {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }

      @container (max-width: 30rem) {
        .pretui-json-key {
          max-width: 8rem;
        }
        .pretui-json-kind {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .pretui-json-twisty::before,
        .pretui-json-acts {
          transition: none;
        }
      }
    </style>
  </template>
}

/* ------------------------------------------------------------------ *
 * JsonEditor — structural editing on top of the same row engine
 * ------------------------------------------------------------------ */

export interface JsonEditorSignature {
  Args: {
    /** Starting document as text. Parsed once; the editor owns it afterwards. */
    json?: string;
    /** Starting document as a plain JavaScript value. */
    value?: unknown;
    /** Accessible name for the grid. */
    label?: string;
    /** Open every container on first render. */
    expandAll?: boolean;
    /** Case-insensitive filter over property names and scalar values. */
    query?: string;
    /** Children rendered per container before truncating. Default 100. */
    pageSize?: number;
    /** Spaces per indent level in the emitted text. Default 2; 0 is compact. */
    indent?: number;
    /** Undo depth. Default 200. */
    historyLimit?: number;
    /** Nothing can be edited; the grid still navigates and copies. */
    readonly?: boolean;
    /**
     * Fires after every committed edit, ALWAYS with a valid document — the
     * serialised text and the plain value. Never fires for a pending or
     * rejected edit, so a caller can persist the payload unconditionally.
     */
    onChange?: (json: string, value: unknown) => void;
    /**
     * Fires when an edit is rejected or degraded — an unreadable number, a
     * duplicate property name, a lossy type change. Invalid state is surfaced
     * for the caller to render; it is never resolved by coercing the data.
     */
    onIssue?: (diagnostics: ReadonlyArray<JsonDiagnostic>) => void;
  };
  Blocks: {
    empty?: [];
  };
  Element: HTMLDivElement;
}

/** `{}` and `[]` parse cleanly but render no rows. */
function isEmptyContainer(node: JsonNode): boolean {
  if (node.kind === 'object') {
    return node.entries.length === 0;
  }
  if (node.kind === 'array') {
    return node.items.length === 0;
  }
  return false;
}

export class JsonEditor extends JsonRowsBase<JsonEditorSignature> {
  /** The live document once the reader has edited; `undefined` means the
   * args are still authoritative. */
  @tracked private edited: JsonNode | undefined = undefined;
  /** The row currently in edit mode — the APG treegrid contract: one row's
   * cells are reachable at a time, Escape returns to row navigation. */
  @tracked private editingId: string | undefined = undefined;
  /** Uncommitted text for a scalar whose current draft cannot be read as its
   * type. The DOCUMENT keeps its last good value; the draft is held here so
   * the keystrokes are never thrown away. */
  @tracked private pendingText: string | undefined = undefined;
  @tracked private pendingId: string | undefined = undefined;
  @tracked private pendingMessage: string | undefined = undefined;
  /** Draft property name, same contract as `pendingText`. */
  @tracked private keyDraft: string | undefined = undefined;
  @tracked private keyDraftId: string | undefined = undefined;
  @tracked private keyMessage: string | undefined = undefined;
  @tracked private historyTick = 0;

  private history = new JsonHistory(this.args.historyLimit ?? 200);

  kindOptions = KIND_OPTIONS;

  private get seeded(): JsonNode {
    const text = this.args.json;
    if (text !== undefined) {
      const result = parseJson(text);
      if (result.ok) {
        return result.root;
      }
      return { kind: 'object', entries: [] };
    }
    if (this.args.value !== undefined) {
      return fromPlainValue(this.args.value);
    }
    return { kind: 'object', entries: [] };
  }

  protected get root(): JsonNode | undefined {
    return this.edited ?? this.seeded;
  }
  private get doc(): JsonNode {
    return this.root!;
  }

  protected get seedExpanded(): string[] {
    if (this.args.expandAll) {
      return Array.from(allContainerPaths(this.doc));
    }
    return [''];
  }
  protected get treeLabel(): string {
    return this.args.label ?? 'JSON editor';
  }
  protected get pageSize(): number {
    return Math.max(1, this.args.pageSize ?? 100);
  }
  protected get query(): string {
    return (this.args.query ?? '').trim();
  }
  private get indent(): number {
    return this.args.indent ?? 2;
  }
  get isReadonly(): boolean {
    return this.args.readonly === true;
  }
  get canUndo(): boolean {
    // `historyTick` is read so the getter re-runs after every mutation —
    // JsonHistory is a plain object, deliberately, so it stays unit-testable
    // without a tracking frame.
    return this.historyTick >= 0 && this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.historyTick >= 0 && this.history.canRedo;
  }
  get emptyMessage(): string {
    return this.hasQuery
      ? 'No property name or value matches this search.'
      : 'This document is empty. Add a property to begin.';
  }

  /* ---- the blank document ------------------------------------------ *
   * An empty JSON field is a blank page, not an announcement. A titled
   * EmptyState with an illustration reads as "something is missing"; what
   * is actually true is "nothing has been written yet". So the empty state
   * IS the input: a bare textarea whose only chrome is a one-word hint that
   * JSON is what goes here. Paste or type, and on the keystroke the text
   * becomes valid it parses straight into the tree and this input is gone.
   * ------------------------------------------------------------------- */

  /** Raw text held while the document is still empty. */
  @tracked private seedText = '';
  /** Set on blur only — a half-typed `{` is not an error while you type. */
  @tracked private seedIssue: string | undefined = undefined;

  /** Editable and unfiltered: show the input. A no-match search or a
   * read-only document still wants a notice, because in those cases the
   * emptiness is a *result*, not an invitation. */
  get showSeedInput(): boolean {
    return !this.isReadonly && !this.hasQuery;
  }
  get seedLabel(): string {
    return this.args.label ?? 'JSON editor';
  }
  get seedInvalid(): boolean | undefined {
    return this.seedIssue ? true : undefined;
  }
  /** The whole of the empty-state copy. One word when all is well. */
  get seedHint(): string {
    return this.seedIssue ?? 'JSON';
  }

  seedInput = (text: string): void => {
    this.seedText = text;
    this.seedIssue = undefined;
    if (text.trim() === '') {
      return;
    }
    const result = parseJson(text);
    // An empty `{}` parses fine but yields no rows, which would silently
    // swallow what was typed and leave the field looking untouched. Hold it
    // until there is something to show.
    if (result.ok && !isEmptyContainer(result.root)) {
      this.history.push(this.doc);
      this.edited = result.root;
      this.historyTick = this.historyTick + 1;
      this.seedText = '';
      this.announce('JSON parsed into the editor.');
      this.emit(result.root);
    }
  };

  seedBlur = (): void => {
    const text = this.seedText.trim();
    if (text === '') {
      this.seedIssue = undefined;
      return;
    }
    const result = parseJson(text);
    this.seedIssue = result.ok
      ? undefined
      : (result.diagnostics[0]?.message ?? 'That is not valid JSON.');
  };

  get cannotUndo(): boolean {
    return !this.canUndo;
  }
  get cannotRedo(): boolean {
    return !this.canRedo;
  }

  isEditing = (row: ViewRow): boolean => this.editingId === row.id && !this.isReadonly;
  editingKey = (row: ViewRow): boolean => this.isEditing(row) && row.inObject;
  editingScalar = (row: ViewRow): boolean => this.isEditing(row) && this.isTextual(row);
  editingBool = (row: ViewRow): boolean => this.isEditing(row) && row.kind === 'boolean';
  /** The pending draft for this row, or the committed text. */
  valueText = (row: ViewRow): string => {
    if (this.pendingId === row.id && this.pendingText !== undefined) {
      return this.pendingText;
    }
    const node = row.node;
    if (node.kind === 'string') {
      return node.value;
    }
    if (node.kind === 'number') {
      return node.literal;
    }
    return '';
  };
  keyText = (row: ViewRow): string =>
    this.keyDraftId === row.id && this.keyDraft !== undefined ? this.keyDraft : row.keyLabel;
  rowInvalid = (row: ViewRow): boolean => this.pendingId === row.id && this.pendingMessage !== undefined;
  rowMessage = (row: ViewRow): string | undefined =>
    this.pendingId === row.id ? this.pendingMessage : undefined;
  keyInvalid = (row: ViewRow): boolean => this.keyDraftId === row.id && this.keyMessage !== undefined;
  keyMessageFor = (row: ViewRow): string | undefined =>
    this.keyDraftId === row.id ? this.keyMessage : undefined;
  isBoolTrue = (row: ViewRow): boolean => row.node.kind === 'boolean' && row.node.value;
  boolLabel = (row: ViewRow): string =>
    row.node.kind === 'boolean' && row.node.value ? 'true' : 'false';
  isTextual = (row: ViewRow): boolean => row.kind === 'string' || row.kind === 'number';
  valueLabelFor = (row: ViewRow): string => 'Value at ' + row.pathLabel;
  keyLabelFor = (row: ViewRow): string => 'Property name at ' + row.pathLabel;
  kindLabelFor = (row: ViewRow): string => 'Type of ' + row.pathLabel;
  addLabelFor = (row: ViewRow): string =>
    (row.kind === 'array' ? 'Add an item to ' : 'Add a property to ') + row.pathLabel;
  removeLabelFor = (row: ViewRow): string => 'Remove ' + row.pathLabel;
  upLabelFor = (row: ViewRow): string => 'Move ' + row.pathLabel + ' up';
  downLabelFor = (row: ViewRow): string => 'Move ' + row.pathLabel + ' down';
  canMove = (row: ViewRow): boolean => !row.isOverflow && row.parentId !== undefined;
  canRemove = (row: ViewRow): boolean => !row.isOverflow && row.parentId !== undefined;

  /* --- committing ------------------------------------------------- */

  /** Apply an `EditResult`, recording undo and emitting `@onChange`. */
  private apply(result: EditResult): boolean {
    if (result.diagnostics.length > 0) {
      this.args.onIssue?.(result.diagnostics);
    }
    if (!result.changed) {
      if (result.diagnostics.length > 0) {
        this.announce(result.announcement);
      }
      return false;
    }
    this.history.push(this.doc);
    this.edited = result.root;
    this.historyTick = this.historyTick + 1;
    this.announce(result.announcement);
    this.emit(result.root);
    return true;
  }

  private emit(root: JsonNode): void {
    this.args.onChange?.(stringifyJson(root, this.indent), toPlainValue(root));
  }

  private clearPending(): void {
    this.pendingId = undefined;
    this.pendingText = undefined;
    this.pendingMessage = undefined;
  }
  private clearKeyDraft(): void {
    this.keyDraftId = undefined;
    this.keyDraft = undefined;
    this.keyMessage = undefined;
  }

  /* --- edit operations -------------------------------------------- */

  setValueText = (row: ViewRow, text: string): void => {
    const read = readScalar(row.kind, text);
    if (read === undefined) {
      // The draft is held, the document keeps its last good value, and the
      // row is marked invalid with a reason. Nothing is coerced or dropped.
      this.pendingId = row.id;
      this.pendingText = text;
      this.pendingMessage =
        row.kind === 'number'
          ? 'Not a JSON number yet. JSON has no leading +, no leading zeros, no bare .5, and no Infinity or NaN.'
          : 'This is not a valid ' + row.kind + ' value.';
      this.args.onIssue?.([
        {
          severity: 'error',
          code: 'pending-value',
          message: this.pendingMessage,
          offset: 0,
          line: 1,
          column: 1,
          path: row.path,
        },
      ]);
      return;
    }
    this.clearPending();
    this.apply(setNode(this.doc, row.path, read));
  };

  setBool = (row: ViewRow, checked: boolean): void => {
    this.apply(setNode(this.doc, row.path, { kind: 'boolean', value: checked }));
  };

  setKeyText = (row: ViewRow, text: string): void => {
    this.keyDraftId = row.id;
    this.keyDraft = text;
    this.keyMessage = undefined;
  };

  commitKey = (row: ViewRow): void => {
    if (this.keyDraftId !== row.id || this.keyDraft === undefined) {
      return;
    }
    const next = this.keyDraft;
    const result = renameKey(this.doc, row.parentPath, row.index, next);
    if (!result.changed && result.diagnostics.length > 0) {
      // The clash is reported and the draft is KEPT — the reader can fix it.
      this.keyMessage = result.diagnostics[0]!.message;
      this.args.onIssue?.(result.diagnostics);
      return;
    }
    this.clearKeyDraft();
    this.apply(result);
  };

  setKind = (row: ViewRow, kind: string): void => {
    this.clearPending();
    this.apply(changeKind(this.doc, row.path, kind as JsonKind));
  };

  addChild = (row: ViewRow): void => {
    if (row.node.kind === 'array') {
      this.apply(addItem(this.doc, row.path, emptyNodeOfKind('null')));
    } else if (row.node.kind === 'object') {
      // Name the new property deterministically — no Math.random, no Date.now.
      const taken = new Set(row.node.entries.map((entry) => entry.key));
      let name = 'newProperty';
      let suffix = 2;
      while (taken.has(name)) {
        name = 'newProperty' + String(suffix);
        suffix = suffix + 1;
      }
      this.apply(addEntry(this.doc, row.path, name, emptyNodeOfKind('null')));
    }
    this.setExpanded(row.id, true);
  };

  removeRow = (row: ViewRow): void => {
    if (!this.canRemove(row)) {
      return;
    }
    this.clearPending();
    this.clearKeyDraft();
    this.editingId = undefined;
    this.apply(removeAt(this.doc, row.parentPath, row.index));
  };

  moveUp = (row: ViewRow): void => {
    this.apply(moveChild(this.doc, row.parentPath, row.index, row.index - 1));
  };
  moveDown = (row: ViewRow): void => {
    this.apply(moveChild(this.doc, row.parentPath, row.index, row.index + 1));
  };

  undo = (): void => {
    const previous = this.history.undo(this.doc);
    if (previous === undefined) {
      this.announce('Nothing to undo.');
      return;
    }
    this.clearPending();
    this.clearKeyDraft();
    this.edited = previous;
    this.historyTick = this.historyTick + 1;
    this.announce('Undone.');
    this.emit(previous);
  };

  redo = (): void => {
    const next = this.history.redo(this.doc);
    if (next === undefined) {
      this.announce('Nothing to redo.');
      return;
    }
    this.clearPending();
    this.clearKeyDraft();
    this.edited = next;
    this.historyTick = this.historyTick + 1;
    this.announce('Redone.');
    this.emit(next);
  };

  private beginEdit(row: ViewRow): void {
    if (this.isReadonly || row.isOverflow) {
      return;
    }
    this.editingId = row.id;
    this.announce('Editing ' + row.pathLabel + '. Escape returns to the list.');
  }

  private endEdit(): void {
    this.editingId = undefined;
    this.navigating = true;
  }

  /* --- events ------------------------------------------------------ */

  onClick = (event: Event): void => {
    const row = this.rowFromEvent(event);
    if (row === undefined) {
      return;
    }
    this.navigating = false;
    this.focusId = row.id;

    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest('[data-json-action]') !== null) {
      return;
    }
    if (row.isOverflow) {
      this.reveal(row);
      return;
    }
    if (target !== null && target.closest('[data-json-twisty]') !== null && row.expandable) {
      this.setExpanded(row.id, !row.expanded);
      return;
    }
    if (target !== null && target.closest('[data-json-cell]') !== null) {
      this.beginEdit(row);
    }
  };

  onKeydown = (event: Event): void => {
    const ev = event as KeyboardEvent;
    const rows = this.rows;
    const index = rows.findIndex((row) => row.id === this.rovingId);
    if (index < 0) {
      return;
    }
    const row = rows[index]!;

    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      if (ev.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }

    // Edit mode: the row's controls own the keyboard. Only Escape (and Enter
    // on a single-line control) belongs to the grid. This is the APG treegrid
    // contract — without it, arrows in a text box would move the selection.
    if (this.editingId !== undefined) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.endEdit();
      } else if (ev.key === 'Enter') {
        const target = ev.target as HTMLElement | null;
        if (target !== null && target.tagName === 'INPUT') {
          ev.preventDefault();
          this.commitKey(row);
          this.endEdit();
        }
      }
      return;
    }

    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      if (!this.isReadonly && this.canMove(row)) {
        if (ev.key === 'ArrowUp') {
          this.moveUp(row);
        } else {
          this.moveDown(row);
        }
      }
      return;
    }

    if (ev.key === 'Enter' || ev.key === 'F2') {
      ev.preventDefault();
      if (row.isOverflow) {
        this.reveal(row);
        return;
      }
      this.beginEdit(row);
      return;
    }
    if (ev.key === ' ') {
      ev.preventDefault();
      if (row.expandable) {
        this.setExpanded(row.id, !row.expanded);
      }
      return;
    }
    if (ev.key === 'Delete') {
      ev.preventDefault();
      if (!this.isReadonly) {
        this.removeRow(row);
      }
      return;
    }
    if (this.handleNavigationKey(ev, rows, index)) {
      return;
    }
    this.handleTypeahead(ev, rows, index);
  };

  <template>
    <div class='pretui-json pretui-json-edit' data-test-pretui-json-editor ...attributes>
      <div class='pretui-json-bar'>
        <span class='pretui-json-bar-name'>{{this.treeLabel}}</span>
        {{#if this.hasQuery}}
          <span class='pretui-json-count' data-test-pretui-json-matches>
            {{this.matchLabel}}
          </span>
        {{/if}}
        <span class='pretui-json-gap'></span>
        <Button
          @tone='neutral'
          @appearance='plain'
          @size='xs'
          @disabled={{this.cannotUndo}}
          data-test-pretui-json-undo
          {{on 'click' this.undo}}
        >Undo</Button>
        <Button
          @tone='neutral'
          @appearance='plain'
          @size='xs'
          @disabled={{this.cannotRedo}}
          data-test-pretui-json-redo
          {{on 'click' this.redo}}
        >Redo</Button>
        <Button
          @tone='neutral'
          @appearance='plain'
          @size='xs'
          data-test-pretui-json-expand-all
          {{on 'click' this.expandAll}}
        >Expand all</Button>
        <Button
          @tone='neutral'
          @appearance='plain'
          @size='xs'
          data-test-pretui-json-collapse-all
          {{on 'click' this.collapseAll}}
        >Collapse all</Button>
      </div>

      {{#if this.hasRows}}
        <div
          class='pretui-json-list'
          role='treegrid'
          aria-label={{this.treeLabel}}
          aria-readonly={{if this.isReadonly 'true'}}
          {{listen 'click' this.onClick}}
          {{listen 'keydown' this.onKeydown}}
          {{listen 'focusin' this.onFocusIn}}
        >
          {{#each this.rows key='id' as |row|}}
            <div
              class='pretui-json-row'
              role='row'
              data-json-id={{row.id}}
              data-kind={{row.kind}}
              data-matched={{this.matchedAttr row}}
              data-editing={{if (this.isEditing row) 'true'}}
              aria-level={{row.level}}
              aria-posinset={{row.posinset}}
              aria-setsize={{row.setsize}}
              aria-expanded={{this.expandedAttr row}}
              style={{row.style}}
              {{rovingTabindex (this.isRoving row)}}
              {{focusWhen (this.isFocusTarget row)}}
            >
              {{#if row.isOverflow}}
                <span class='pretui-json-cell pretui-json-more' role='gridcell'>
                  {{row.overflowLabel}}
                  <span class='pretui-json-more-cue'>· Enter shows more</span>
                </span>
              {{else}}
                <span class='pretui-json-cell pretui-json-cell-key' role='gridcell'>
                  <span
                    class='pretui-json-twisty'
                    data-json-twisty
                    data-open={{if row.expanded 'true'}}
                    data-leaf={{unless row.expandable 'true'}}
                    aria-hidden='true'
                  ></span>
                  {{#if (this.editingKey row)}}
                    <Input
                      @value={{this.keyText row}}
                      @invalid={{this.keyInvalid row}}
                      @errorMessage={{this.keyMessageFor row}}
                      @onInput={{fn this.setKeyText row}}
                      aria-label={{this.keyLabelFor row}}
                      data-json-cell='key'
                      {{on 'blur' (fn this.commitKey row)}}
                    />
                  {{else}}
                    <span class='pretui-json-key' data-json-cell='key'>{{row.keyLabel}}</span>
                  {{/if}}
                </span>

                <span class='pretui-json-cell pretui-json-cell-kind' role='gridcell'>
                  {{#if (this.isEditing row)}}
                    <Select
                      @options={{this.kindOptions}}
                      @value={{row.kind}}
                      @onValueChange={{fn this.setKind row}}
                      aria-label={{this.kindLabelFor row}}
                      data-json-cell='kind'
                    />
                  {{else}}
                    <span class='pretui-json-kind' aria-hidden='true'>{{row.kindLabel}}</span>
                  {{/if}}
                </span>

                <span class='pretui-json-cell pretui-json-cell-value' role='gridcell'>
                  {{#if (this.editingScalar row)}}
                    <Input
                      @value={{this.valueText row}}
                      @invalid={{this.rowInvalid row}}
                      @errorMessage={{this.rowMessage row}}
                      @onInput={{fn this.setValueText row}}
                      aria-label={{this.valueLabelFor row}}
                      data-json-cell='value'
                    />
                  {{else if (this.editingBool row)}}
                    <Checkbox
                      @label={{this.boolLabel row}}
                      @checked={{this.isBoolTrue row}}
                      @onCheckedChange={{fn this.setBool row}}
                      data-json-cell='value'
                    />
                  {{else}}
                    <span class='pretui-json-value' data-json-cell='value'>{{row.preview}}</span>
                    {{#if row.countLabel}}
                      <span class='pretui-json-n' aria-hidden='true'>{{row.countLabel}}</span>
                    {{/if}}
                  {{/if}}
                </span>

                <span class='pretui-json-cell pretui-json-acts' role='gridcell'>
                  {{#if row.isContainerRow}}
                    <button
                      type='button'
                      class='pretui-json-act'
                      data-json-action='add'
                      tabindex='-1'
                      aria-label={{this.addLabelFor row}}
                      {{on 'click' (fn this.addChild row)}}
                    >+</button>
                  {{/if}}
                  {{#if (this.canMove row)}}
                    <button
                      type='button'
                      class='pretui-json-act'
                      data-json-action='up'
                      tabindex='-1'
                      aria-label={{this.upLabelFor row}}
                      {{on 'click' (fn this.moveUp row)}}
                    >↑</button>
                    <button
                      type='button'
                      class='pretui-json-act'
                      data-json-action='down'
                      tabindex='-1'
                      aria-label={{this.downLabelFor row}}
                      {{on 'click' (fn this.moveDown row)}}
                    >↓</button>
                  {{/if}}
                  <button
                    type='button'
                    class='pretui-json-act'
                    data-json-action='path'
                    tabindex='-1'
                    aria-label={{this.copyPathLabel row}}
                    {{on 'click' (fn this.copyPath row)}}
                  >path</button>
                  {{#if (this.canRemove row)}}
                    <button
                      type='button'
                      class='pretui-json-act pretui-json-act-danger'
                      data-json-action='remove'
                      tabindex='-1'
                      aria-label={{this.removeLabelFor row}}
                      {{on 'click' (fn this.removeRow row)}}
                    >×</button>
                  {{/if}}
                </span>
              {{/if}}
            </div>
          {{/each}}
        </div>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else if this.showSeedInput}}
        <div class='pretui-json-seed'>
          <Textarea
            @value={{this.seedText}}
            @placeholder='{ "name": "value" }'
            @invalid={{this.seedInvalid}}
            @helperText={{this.seedHint}}
            @onInput={{this.seedInput}}
            aria-label={{this.seedLabel}}
            {{on 'blur' this.seedBlur}}
            data-test-pretui-json-seed
          />
        </div>
      {{else}}
        <EmptyState @title='Empty document' @message={{this.emptyMessage}} @texture={{false}} />
      {{/if}}

      <p class='pretui-json-live' aria-live='polite' data-test-pretui-json-live>
        {{this.announcement}}
      </p>
    </div>

    <style scoped>
      .pretui-json {
        --_indent: var(--pretui-json-indent, 14px);
        --_row-h: var(--pretui-json-row-height, 26px);
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 6px);
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
        container-type: inline-size;
      }
      /* The blank document. Deliberately almost no dress: the textarea
         inherits the field tokens and the hint is the smallest legible
         label the scale has. Reserves the rows' own minimum height so the
         field does not jump when the first paste lands (Law 8's corollary
         — a value that arrives late reserves its space). */
      .pretui-json-seed {
        display: flex;
        flex-direction: column;
      }
      .pretui-json-seed :is(textarea) {
        min-height: calc(var(--_row-h) * 4);
        font-family: var(--font-mono);
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-json-bar {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-height: var(--control-h, 28px);
      }
      .pretui-json-bar-name {
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-json-count {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pretui-json-gap {
        flex: 1 1 auto;
      }

      .pretui-json-list {
        padding: var(--space-2, 6px) 0;
        border-radius: var(--radius-surface, 10px);
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        overflow: auto;
        max-height: var(--pretui-json-max-height, 26rem);
      }

      .pretui-json-row {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-height: var(--_row-h);
        padding-inline-start: calc(var(--space-3, 8px) + (var(--_level, 1) - 1) * var(--_indent));
        padding-inline-end: var(--space-3, 8px);
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        outline: none;
      }
      .pretui-json-row:hover {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-json-row:focus-visible {
        box-shadow: inset 0 0 0 2px var(--ring);
        border-radius: var(--radius-chip, 6px);
      }
      .pretui-json-row[data-matched='true'] {
        background: color-mix(in oklch, var(--primary) 12%, transparent);
        box-shadow: inset 3px 0 0 0 var(--primary);
      }
      .pretui-json-row[data-editing='true'] {
        background: var(--card);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        min-height: calc(var(--control-h, 28px) + 8px);
      }

      .pretui-json-cell {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-width: 0;
      }
      .pretui-json-cell-key {
        flex: 0 0 auto;
        max-width: 14rem;
      }
      .pretui-json-cell-kind {
        flex: 0 0 auto;
      }
      .pretui-json-cell-value {
        flex: 1 1 auto;
      }
      .pretui-json-row[data-editing='true'] .pretui-json-cell-key,
      .pretui-json-row[data-editing='true'] .pretui-json-cell-kind {
        flex: 0 0 9rem;
      }

      .pretui-json-twisty {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        position: relative;
      }
      .pretui-json-twisty[data-leaf='true'] {
        visibility: hidden;
      }
      .pretui-json-twisty::before {
        content: '';
        position: absolute;
        inset-block-start: 1px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border-inline-end: 1.5px solid var(--muted-foreground);
        border-block-end: 1.5px solid var(--muted-foreground);
        transform: rotate(-45deg);
        transition: transform var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-twisty[data-open='true']::before {
        transform: rotate(45deg);
      }

      .pretui-json-key {
        color: var(--foreground);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: text;
      }
      .pretui-json-kind {
        padding: 0 4px;
        border-radius: var(--radius-chip, 6px);
        font-size: var(--text-ui-xs, 11px);
        line-height: 1.5;
        color: var(--muted-foreground);
        background: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
      }
      .pretui-json-row[data-kind='string'] .pretui-json-value {
        color: var(--chart-1);
      }
      .pretui-json-row[data-kind='number'] .pretui-json-value {
        color: var(--chart-2);
      }
      .pretui-json-row[data-kind='boolean'] .pretui-json-value {
        color: var(--chart-4);
      }
      .pretui-json-row[data-kind='null'] .pretui-json-value {
        color: var(--muted-foreground);
        font-style: italic;
      }
      .pretui-json-value {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: text;
      }
      .pretui-json-n {
        flex: 0 0 auto;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }

      .pretui-json-acts {
        flex: 0 0 auto;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--pretui-dur-snap, 120ms) var(--pretui-ease-snap, ease);
      }
      .pretui-json-row:hover .pretui-json-acts,
      .pretui-json-row:focus-visible .pretui-json-acts,
      .pretui-json-row[data-editing='true'] .pretui-json-acts,
      .pretui-json-acts:focus-within {
        opacity: 1;
      }
      @media (any-pointer: coarse) {
        .pretui-json-acts {
          opacity: 1;
        }
        .pretui-json-act {
          min-width: 30px;
          min-height: 30px;
        }
      }
      .pretui-json-act {
        appearance: none;
        border: 0;
        min-height: 18px;
        padding: 1px 5px;
        border-radius: var(--radius-chip, 6px);
        font: inherit;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        background: var(--card);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        cursor: pointer;
      }
      .pretui-json-act:hover {
        color: var(--foreground);
      }
      .pretui-json-act-danger:hover {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-json-act:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }

      .pretui-json-more {
        flex: 1 1 auto;
        color: var(--muted-foreground);
        font-style: italic;
      }
      .pretui-json-more-cue {
        font-size: var(--text-ui-xs, 11px);
        opacity: 0.8;
      }

      .pretui-json-live {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }

      @container (max-width: 34rem) {
        .pretui-json-row[data-editing='true'] {
          flex-wrap: wrap;
        }
        .pretui-json-cell-key,
        .pretui-json-row[data-editing='true'] .pretui-json-cell-key,
        .pretui-json-row[data-editing='true'] .pretui-json-cell-kind {
          flex: 1 1 100%;
          max-width: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .pretui-json-twisty::before,
        .pretui-json-acts {
          transition: none;
        }
      }
    </style>
  </template>

}
