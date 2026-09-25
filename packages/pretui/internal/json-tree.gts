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
//
// (the json-tree group)

// Pretui — the shared base and vocabulary for JsonTree and JsonEditor: flat rows, roving focus, type badges.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
// `ember-modifier` resolves at realm runtime; Glint cannot see its types here
// (accepted parse baseline, same as components/popup.gts).
import { modifier } from 'ember-modifier';
import type { SelectOption } from '../components/select';
import { cssStyle } from '../pretui-css';
import {
  allContainerPaths,
  ancestorPaths,
  childCount,
  flattenJson,
  formatPath,
  pathKey,
  previewOf,
  searchJson,
  stringifyJson,
} from '../json-model';
import type {
  FlatRow,
  JsonDiagnostic,
  JsonKind,
  JsonNode,
} from '../json-model';

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

export const KIND_OPTIONS: SelectOption[] = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'null', label: 'null' },
  { value: 'array', label: 'array' },
  { value: 'object', label: 'object' },
];

/** One rendered row: the model's `FlatRow` plus everything the template needs. */
export interface ViewRow extends FlatRow {
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
  const clip =
    typeof navigator === 'undefined' ? undefined : navigator.clipboard;
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
export const reportDiagnostics = modifier(
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
export abstract class JsonRowsBase<S> extends Component<S> {
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
      const parent =
        row.parentId === undefined ? undefined : byId.get(row.parentId);
      return {
        ...row,
        style: cssStyle(
          '--_level',
          String(Math.max(1, Math.min(60, row.level))),
        ),
        kind: row.node.kind,
        kindLabel: KIND_LABEL[row.node.kind],
        keyLabel: row.label === undefined ? '$' : row.label,
        preview: quotedPreview(row.node),
        countLabel:
          row.node.kind === 'array' || row.node.kind === 'object'
            ? String(count)
            : '',
        pathLabel: formatPath(row.path),
        matched: matched.has(row.id),
        isOverflow: overflow !== undefined,
        overflowLabel:
          overflow === undefined
            ? ''
            : 'Showing ' +
              String(overflow.shown) +
              ' of ' +
              String(overflow.total),
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
  selectedAttr = (row: ViewRow): string =>
    row.id === this.selectedId ? 'true' : 'false';
  isRoving = (row: ViewRow): boolean => row.id === this.rovingId;
  isFocusTarget = (row: ViewRow): boolean =>
    this.navigating && row.id === this.rovingId;
  expandedAttr = (row: ViewRow): string | undefined =>
    row.expandable ? (row.expanded ? 'true' : 'false') : undefined;
  matchedAttr = (row: ViewRow): string | undefined =>
    row.matched ? 'true' : undefined;
  copyPathLabel = (row: ViewRow): string => 'Copy path ' + row.pathLabel;
  copyValueLabel = (row: ViewRow): string =>
    'Copy the value at ' + row.pathLabel;

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
    return id === undefined
      ? undefined
      : this.rows.find((row) => row.id === id);
  }

  expandAll = (): void => {
    const doc = this.root;
    this.userExpanded =
      doc === undefined ? [] : Array.from(allContainerPaths(doc));
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
  protected handleNavigationKey(
    ev: KeyboardEvent,
    rows: ViewRow[],
    index: number,
  ): boolean {
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
  protected handleTypeahead(
    ev: KeyboardEvent,
    rows: ViewRow[],
    index: number,
  ): boolean {
    const key = ev.key;
    if (key.length !== 1 || !/\S/.test(key)) {
      return false;
    }
    const ch = key.toLowerCase();
    for (let step = 1; step <= rows.length; step++) {
      const candidate = rows[(index + step) % rows.length];
      if (
        candidate !== undefined &&
        candidate.keyLabel.toLowerCase().startsWith(ch)
      ) {
        ev.preventDefault();
        this.moveTo(candidate);
        return true;
      }
    }
    return false;
  }
}
