// Pretui — List: a collection of rows with start, content and end slots.
import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { DataShell, DataSource, ExpansionState } from '../data-component';
import type { ExpansionView } from '../data-component';
import type {
  DataArgs,
  DataLoad,
  RowKey,
  RowKeyFn,
  SelectionMode,
} from '../data-component';
import type { PretuiSize } from '../pretui-primitives';
import { OWNS_PRESS, focusWhen, listen, rovingTabindex } from '../focus';
import { RowCursor } from '../internal/reading-listing';
import type { ListingSizeArg } from '../internal/reading-listing';
import { resolveSize } from '../pretui-primitives';

// ═════════════════════════════════════════════════════════════════════════
// List — the row collection
// ═════════════════════════════════════════════════════════════════════════
//
// What it adds over what the kit already has, precisely:
//   • `<Feed>` is `role='feed'`: a stream of
//     independently-authored ARTICLES, paged with PageUp/PageDown, with
//     `aria-posinset`/`aria-setsize` on each. It has no selection, no load
//     state and no data contract — it takes `@items` and renders them.
//   • `<Grid>` wraps boxel-ui's tile container: a
//     LAYOUT with no selection, no keyboard model and no state.
//   • `<DataGrid>` is a table.
//   • `<Masonry>` is a column-major wall.
//   • `<List>` is the SELECTABLE, keyboard-navigable, load-aware row
//     collection — `<ul>`/`<li>` semantics, one tab stop, arrows within,
//     the same `DataSource` selection model `<DataTable>` uses, and the same
//     loading/empty/error chrome through `<DataShell>`. It is what a
//     `<DataTable>` becomes when the pane is too narrow for columns.
//
// ARIA, and why it is NOT a listbox: `role='listbox'` + `role='option'` is
// the obvious shape and it is wrong twice over. An option's children are
// presentational, so a row containing a link, a button or an avatar with a
// name loses all of it; and the realm's `require-presentational-children`
// enforces exactly that, reporting the error in the CALLER's file when the
// offending markup arrives through a block. A list of rich rows is a list.
// Selection state is carried by a real checkbox or radio with its own
// accessible name — the one thing every kit in the corpus already does right
// — plus `data-selected` for CSS.

/** What the `<:item>` block gets alongside the row. */
export interface ListRowApi {
  /** 0-based position in the rendered collection */
  index: number;
  /** is this row selected? */
  selected: boolean;
  /** is this row the keyboard cursor? */
  active: boolean;
  /** toggle this row's selection, per the selection mode */
  toggle: () => void;
}

interface ListLine<T> {
  key: RowKey;
  row: T;
  index: number;
  selected: boolean;
  selectedFlag: string | undefined;
  active: boolean;
  api: ListRowApi;
  label: string;
  expansion: ExpansionView;
}

/**
 * A collapse removes the detail, and focus inside it would fall to <body>.
 * The row remembers (from focusin) that focus was in its detail; after a
 * collapse — by the expander, a controlled `@expandedKeys` change or a
 * reload — focus lands on the row's expander instead, unless it has already
 * moved somewhere real.
 */
const restoreFocusOnCollapse = modifier(
  (row: HTMLElement, [expanded]: [boolean]) => {
    if (expanded || row.dataset['detailFocus'] !== 'true') {
      return;
    }
    row.dataset['detailFocus'] = 'false';
    let doc = row.ownerDocument;
    let active = doc.activeElement;
    if (!active || active === doc.body) {
      (row.querySelector('.pretui-list-expbtn') as HTMLElement | null)?.focus();
    }
  },
);

export interface ListSignature<T> {
  Args: {
    /** the collection. `@items` is the flat-collection noun (the List-ish
     * contract); `@options` and `@dataSource` are accepted aliases so a
     * shadcn/Ant-shaped call still lands. */
    items?: readonly T[];
    /** alias for `@items` */
    options?: readonly T[];
    /** alias for `@items` (Ant) */
    dataSource?: readonly T[];
    /** async loader — see `DataArgs.load`. Supply EITHER this or `@items`. */
    load?: DataLoad<T>;
    /** re-run `@load` whenever this changes. No debounce — that is a timer. */
    loadKey?: unknown;
    /** stable identity for a row. Pass it whenever rows can be re-ordered. */
    key?: RowKeyFn<T>;
    /** accessible name for the list (default 'List') */
    label?: string;
    /** density — `xs|s|m|l|xl`, `sm`/`md`/`lg` accepted */
    size?: ListingSizeArg;
    /** `'none'` (default), `'single'` or `'multi'` */
    selectionMode?: SelectionMode;
    /** controlled selection */
    selected?: readonly RowKey[];
    /** uncontrolled seed */
    defaultSelected?: readonly RowKey[];
    /** fires with the next selection on every change */
    onSelectionChange?: (keys: RowKey[], rows: T[]) => void;
    /** Enter (or a click on the row) activates it. A row with one obvious
     * destination should carry a real `<a>` in `<:item>` instead. */
    onActivate?: (row: T, index: number) => void;
    /** the row's accessible name, used on its selection control and as the
     * row's own label. Defaults to `Row N`, which is honest but poor —
     * pass this. */
    rowLabel?: (row: T, index: number) => string;
    /** controlled expanded rows (by `@key`); needs `<:expanded>` */
    expandedKeys?: readonly RowKey[];
    /** uncontrolled seed for the expanded rows */
    defaultExpandedKeys?: readonly RowKey[];
    /** fires with the next expanded set, in both modes */
    onExpandedChange?: (keys: RowKey[]) => void;
    /** hairline between rows (default true) */
    divided?: boolean;
    /** frame the whole list (default false) */
    bordered?: boolean;
    /** a caller-driven pending state: `aria-busy` without replacing the
     * rows, so focus and scroll position survive (React Aria's `isPending`
     * semantics rather than a `disabled` swap) */
    busy?: boolean;
    /** alias for `@busy` */
    loading?: boolean;
    /** noun for the polite result count ('lot' → '6 lots') */
    itemNoun?: string;
    emptyTitle?: string;
    emptyMessage?: string;
    loadingLabel?: string;
    skeletonRows?: number;
  };
  Blocks: {
    /** one row — receives the row, its index, and the row API */
    item: [row: T, index: number, api: ListRowApi];
    /** a row's detail, rendered only while that row is expanded. Supplying
     * it turns on the per-row expander. */
    expanded: [row: T, index: number];
    /** above the rows, inside the frame */
    header: [];
    /** below the rows, inside the frame */
    footer: [];
    /** replaces the default EmptyState */
    empty: [];
    /** replaces the default spinner + skeleton */
    loading: [];
    /** replaces the default Alert */
    error: [];
  };
  Element: HTMLDivElement;
}

export class List<T> extends Component<ListSignature<T>> {
  private guid = guidFor(this);
  /** The shared state machine: load status, `aria-busy`, the polite result
   * count, the row-key contract, and THE selection model `<DataTable>` uses.
   * One implementation, two components. */
  source = new DataSource<T>(() => this.dataArgs);
  cursor = new RowCursor(() => this.rows.length);
  /** The same expanded-rows state DataTable uses. */
  expansion = new ExpansionState(() => this.args, this.guid);

  private get dataArgs(): DataArgs<T> {
    let a = this.args;
    return {
      rows: a.items ?? a.options ?? a.dataSource,
      load: a.load,
      loadKey: a.loadKey,
      key: a.key,
      selectionMode: a.selectionMode,
      selected: a.selected,
      defaultSelected: a.defaultSelected,
      onSelectionChange: a.onSelectionChange,
      itemNoun: a.itemNoun,
      emptyTitle: a.emptyTitle,
      emptyMessage: a.emptyMessage,
      loadingLabel: a.loadingLabel,
      skeletonRows: a.skeletonRows,
    };
  }

  get rows(): T[] {
    return this.source.visibleRows;
  }
  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  get label(): string {
    return this.args.label ?? 'List';
  }
  get selectionMode(): SelectionMode {
    return this.source.selectionMode;
  }
  get selectable(): boolean {
    return this.selectionMode !== 'none';
  }
  get multi(): boolean {
    return this.selectionMode === 'multi';
  }
  get radioName(): string {
    return this.guid + '-list';
  }
  get divided(): string | undefined {
    return (this.args.divided ?? true) ? 'true' : undefined;
  }
  get bordered(): string | undefined {
    return this.args.bordered ? 'true' : undefined;
  }
  get busy(): 'true' | undefined {
    return (this.args.busy ?? this.args.loading) ? 'true' : undefined;
  }

  labelFor = (row: T, index: number): string =>
    this.args.rowLabel?.(row, index) ?? 'Row ' + String(index + 1);

  get lines(): ListLine<T>[] {
    return this.rows.map((row, index) => {
      let selected = this.source.isSelected(row, index);
      let key = this.source.keyFor(row, index);
      let label = this.labelFor(row, index);
      return {
        key,
        row,
        index,
        selected,
        selectedFlag: selected ? 'true' : undefined,
        active: this.cursor.isActive(index),
        api: {
          index,
          selected,
          active: this.cursor.isActive(index),
          toggle: () => this.source.toggleSelected(row, index),
        },
        label,
        expansion: this.expansion.viewFor(key, index, label),
      };
    });
  }

  isRoving = (index: number): boolean => this.cursor.isActive(index);
  isFocusTarget = (index: number): boolean => this.cursor.isFocusTarget(index);

  private indexFromEvent(event: Event): number | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-list-index]') as HTMLElement | null;
    let raw = el?.dataset['listIndex'];
    return raw === undefined ? undefined : Number(raw);
  }

  onFocusIn = (event: Event) => {
    let target = event.target as HTMLElement | null;
    let row = target?.closest('[data-list-index]') as HTMLElement | null;
    if (row) {
      row.dataset['detailFocus'] = target?.closest('.pretui-list-detail')
        ? 'true'
        : 'false';
    }
    let index = this.indexFromEvent(event);
    if (index !== undefined) {
      this.cursor.follow(index);
    }
  };

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (this.rows.length === 0) {
      return;
    }
    let target = ev.target as HTMLElement | null;
    // Only when the ROW itself has focus. A caret in a text field inside a
    // row still gets Home/End, and Space still types a space.
    let onRow = !!target?.matches('[data-list-index]');
    if (!onRow) {
      return;
    }
    if (this.cursor.handleKey(ev.key)) {
      ev.preventDefault();
      return;
    }
    let index = this.cursor.active;
    let row = this.rows[index];
    if (row === undefined) {
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.args.onActivate?.(row, index);
    } else if (ev.key === ' ' && this.selectable) {
      ev.preventDefault();
      this.source.toggleSelected(row, index);
    }
  };

  toggleExpanded = (key: RowKey) => this.expansion.toggle(key);
  detailLabel = (line: ListLine<T>): string => line.label + ' details';

  toggleRow = (row: T, index: number) => {
    this.source.toggleSelected(row, index);
  };
  activate = (row: T, index: number) => {
    this.args.onActivate?.(row, index);
  };

  /** A click on a row activates it, unless it landed on a control or in the
   * row's expanded detail. */
  onClick = (event: Event) => {
    if (!this.args.onActivate) {
      return;
    }
    let target = event.target as Element | null;
    let li = target?.closest?.('li[data-list-index]');
    if (
      !li ||
      target?.closest?.(OWNS_PRESS) ||
      target?.closest?.('.pretui-list-detail')
    ) {
      return;
    }
    let index = Number(li.getAttribute('data-list-index'));
    let row = this.rows[index];
    if (row !== undefined) {
      this.args.onActivate(row, index);
    }
  };

  <template>
    <div
      class='pretui-list'
      data-test-pretui-list
      data-size={{this.size}}
      data-divided={{this.divided}}
      data-bordered={{this.bordered}}
      aria-busy={{this.busy}}
      ...attributes
    >
      {{#if (has-block 'header')}}
        <div class='pretui-list-header'>{{yield to='header'}}</div>
      {{/if}}

      <DataShell
        @state={{this.source}}
        @hasLoading={{has-block 'loading'}}
        @hasEmpty={{has-block 'empty'}}
        @hasError={{has-block 'error'}}
        @emptyTitle={{@emptyTitle}}
        @emptyMessage={{@emptyMessage}}
        @loadingLabel={{@loadingLabel}}
        @skeletonRows={{@skeletonRows}}
      >
        <:default>
          <ul
            class='pretui-list-rows'
            aria-label={{this.label}}
            {{listen 'keydown' this.onKeydown}}
            {{listen 'focusin' this.onFocusIn}}
            {{listen 'click' this.onClick}}
          >
            {{#each this.lines key='key' as |line|}}
              <li
                class='pretui-list-row'
                data-list-index={{line.index}}
                data-selected={{line.selectedFlag}}
                data-expanded={{if
                  (has-block 'expanded')
                  line.expansion.expandedFlag
                }}
                data-test-pretui-list-row
                {{rovingTabindex (this.isRoving line.index)}}
                {{focusWhen (this.isFocusTarget line.index)}}
                {{restoreFocusOnCollapse line.expansion.expanded}}
              >
                <div class='pretui-list-line'>
                  {{#if this.selectable}}
                    <span class='pretui-list-pick'>
                      {{#if this.multi}}
                        <input
                          type='checkbox'
                          class='pretui-list-box'
                          checked={{line.selected}}
                          aria-label={{line.label}}
                          data-test-pretui-list-select
                          {{on
                            'change'
                            (fn this.toggleRow line.row line.index)
                          }}
                        />
                      {{else}}
                        <input
                          type='radio'
                          class='pretui-list-box pretui-list-radio'
                          name={{this.radioName}}
                          checked={{line.selected}}
                          aria-label={{line.label}}
                          data-test-pretui-list-select
                          {{on
                            'change'
                            (fn this.toggleRow line.row line.index)
                          }}
                        />
                      {{/if}}
                    </span>
                  {{/if}}
                  {{#if (has-block 'expanded')}}
                    <button
                      type='button'
                      class='pretui-list-expbtn'
                      aria-expanded={{line.expansion.expandedFlag}}
                      aria-controls={{line.expansion.controls}}
                      aria-label={{line.expansion.expandLabel}}
                      data-test-pretui-list-expand
                      {{on 'click' (fn this.toggleExpanded line.key)}}
                    >
                      <span class='pretui-list-chev' aria-hidden='true'>›</span>
                    </button>
                  {{/if}}
                  <div class='pretui-list-body'>
                    {{yield line.row line.index line.api to='item'}}
                  </div>
                </div>
                {{#if (has-block 'expanded')}}
                  {{#if line.expansion.expanded}}
                    <div
                      class='pretui-list-detail'
                      id={{line.expansion.detailId}}
                      role='region'
                      tabindex='-1'
                      aria-label={{this.detailLabel line}}
                      data-test-pretui-list-detail
                    >
                      {{yield line.row line.index to='expanded'}}
                    </div>
                  {{/if}}
                {{/if}}
              </li>
            {{/each}}
          </ul>
        </:default>
        <:loading>{{yield to='loading'}}</:loading>
        <:empty>{{yield to='empty'}}</:empty>
        <:error>{{yield to='error'}}</:error>
      </DataShell>

      {{#if (has-block 'footer')}}
        <div class='pretui-list-footer'>{{yield to='footer'}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-list {
          min-width: 0;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
        .pretui-list[data-size='xs'] {
          font-size: 10.5px;
        }
        .pretui-list[data-size='s'] {
          font-size: var(--boxel-font-size-2xs);
        }
        .pretui-list[data-size='l'] {
          font-size: 14px;
        }
        .pretui-list[data-size='xl'] {
          font-size: 16px;
        }
        .pretui-list[data-bordered] {
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          overflow: hidden;
        }
        .pretui-list[aria-busy='true'] {
          opacity: 0.62;
        }
        .pretui-list-header,
        .pretui-list-footer {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          padding: 0.62em var(--space-4, 11px);
          color: var(--muted-foreground);
        }
        .pretui-list-header {
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .pretui-list-footer {
          box-shadow: inset 0 1px 0 var(--border);
        }
        .pretui-list-rows {
          list-style: none;
          margin: 0;
          padding: 0;
          min-width: 0;
        }
        .pretui-list-row {
          min-width: 0;
          position: relative;
        }
        .pretui-list-line {
          container-type: inline-size;
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          min-width: 0;
          padding: 0.62em var(--space-4, 11px);
        }
        /* The divider and the hover both sit on the summary line, so a hover
           tint never paints over the hairline above it. */
        .pretui-list[data-divided]
          .pretui-list-row
          + .pretui-list-row
          > .pretui-list-line {
          box-shadow: inset 0 1px 0 var(--border);
        }
        /* A selected row keeps its tint under the pointer, summary and
           detail alike. */
        .pretui-list-row:not([data-selected='true']) > .pretui-list-line:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-list-row:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        /* Selection reads in a still frame and in greyscale (Law 8): a rule on
           the inline start, not colour alone. */
        .pretui-list-row[data-selected='true'] {
          background: var(--pretui-selected, var(--boxel-100));
        }
        .pretui-list-row[data-selected='true']::before {
          content: '';
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          inline-size: 2px;
          background: var(--primary);
        }
        .pretui-list-pick {
          flex: none;
          display: flex;
          align-items: center;
        }
        .pretui-list-body {
          flex: 1 1 auto;
          min-width: 0;
        }
        .pretui-list-expbtn {
          flex: none;
          display: inline-grid;
          place-content: center;
          inline-size: 1.7em;
          block-size: 1.7em;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: none;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-list-expbtn:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-list-expbtn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-list-chev {
          display: block;
          line-height: 1;
          transition: transform var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, cubic-bezier(0.2, 0.9, 0.25, 1.05));
        }
        .pretui-list-expbtn[aria-expanded='true'] .pretui-list-chev {
          transform: rotate(90deg);
        }
        /* tabindex=-1 so a click in the detail focuses the detail, not the
           row, and the row's Enter/Space stay with the row. */
        .pretui-list-detail:focus {
          outline: none;
        }
        .pretui-list-detail {
          min-width: 0;
          padding: 0.62em var(--space-4, 11px) 0.85em;
          box-shadow: inset 0 1px 0 var(--border);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-list-chev {
            transition: none;
          }
        }
        .pretui-list-box {
          appearance: none;
          width: 15px;
          height: 15px;
          margin: 0;
          border-radius: 5px;
          background: var(
            --pretui-control-rest,
            var(--field, var(--boxel-light))
          );
          box-shadow: 0 0 0 1px var(--pretui-control-border, var(--input));
          cursor: pointer;
          display: inline-grid;
          place-content: center;
          flex: none;
        }
        .pretui-list-radio {
          border-radius: 50%;
        }
        .pretui-list-box:checked {
          background: var(--primary);
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--primary) 70%, var(--border)),
            var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
        }
        .pretui-list-box:checked::before {
          content: '';
          width: 9px;
          height: 9px;
          background: var(--primary-foreground);
          clip-path: polygon(
            14% 47%,
            38% 70%,
            86% 18%,
            96% 30%,
            39% 89%,
            4% 58%
          );
        }
        .pretui-list-radio:checked::before {
          clip-path: circle(50%);
          width: 7px;
          height: 7px;
        }
        .pretui-list-box:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* Coarse pointers get the 44px floor without changing the fine-pointer
           rhythm. */
        @media (pointer: coarse) {
          .pretui-list-line {
            min-block-size: 44px;
          }
          .pretui-list-expbtn {
            inline-size: 2.4em;
            block-size: 2.4em;
          }
          .pretui-list-box {
            width: 20px;
            height: 20px;
          }
        }
      }
    </style>
  </template>
}
