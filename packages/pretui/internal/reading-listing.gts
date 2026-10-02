// Pretui — reading-listing: the RECORD LISTING territory.
//
// Four components, and the first thing to say is what each of them is NOT,
// because the kit now has five things that draw rows and an agent trained on
// the React corpus will reach for the wrong one:
//
//   <Sheet>      the SPREADSHEET. Editable cells, a real
//                `role='grid'`, the boxel-grid engine. Not this.
//   <Table>      the MARKUP PRIMITIVE. You write the <tr>s.
//   <DataGrid>   the READ-ONLY structured grid, args in, rows
//                out, no toolbar and no view state.
//   <DataTable>  HERE — the record LISTING agents mean by "data table":
//                sortable headers, per-column filters, column visibility,
//                row selection, expandable rows, pinned columns, density.
//   <List>/<Item> HERE — the same listing as a row collection, which is what
//                a table becomes when the pane gets narrow.
//
// None of these absorbs another. `DataTable` composes what already exists —
// `DataSource`/`DataShell` for load state, selection,
// sort and the polite result announcement; `Pagination` and `EmptyState`;
// `Menu` for the column switcher; `FilterChips` for enum filters; `focus.gts`
// for keyboard.
//
// ─── BETTER THAN THE INSPIRATION (Appendix K's acceptance test) ──────────
// Read against shadcn's TanStack Data Table, Ant's Table, MUI's Table,
// Mantine's Table and Tremor's Table. What they get wrong, and what is fixed:
//
//  1. SORT SEMANTICS. shadcn, Mantine and Tremor emit NO `aria-sort` at all —
//     the arrow glyph is the entire affordance, so a sorted table is silent.
//     Ant sets `aria-sort` only on the active column, MUI only if the caller
//     remembers to pass `sortDirection`. Here every SORTABLE column carries
//     `aria-sort` — `none` when it is not the active one — so the header row
//     announces which columns can be sorted as well as which one is.
//  2. SORT CONTROL. Ant makes the whole `<th>` a `tabindex='0'` click target
//     with a hand-wired Enter handler; MUI's `TableSortLabel` is a `<span>`
//     dressed as a button. Here it is a real `<button>`: role, Enter, Space
//     and focus ring come from the platform, and it carries a visually
//     hidden mirror ("sorted ascending — activate to sort descending") so the
//     next state is announced rather than guessed.
//  3. `scope`. shadcn's `<th>` has no `scope`, and neither does Mantine's or
//     Tremor's — every header cell in those kits is ambiguous to a screen
//     reader in a table with row headers. Every `<th>` here is `scope='col'`.
//  4. ROW SELECTION STATE. Nobody in the corpus puts `aria-selected` on the
//     row: shadcn uses `data-state='selected'`, Ant a class, MUI a class,
//     react-aria `data-selected`. MUI's own docs go the other way and put
//     `role='checkbox'` + `aria-checked` ON the `<tr>`, which destroys the
//     row's cells for assistive technology (a checkbox's children are
//     presentational). Here the `<tr>` carries `aria-selected` — valid on
//     `role='row'` — AND `data-selected` for CSS, while the operable control
//     stays a real per-row checkbox with its own name.
//  5. `role='grid'` IS NOT CLAIMED, deliberately. Only react-aria takes it
//     on, and it has to drag in roving tabindex, typeahead, `aria-rowindex`
//     and arrow-key cell travel to make it true. A listing whose cells hold
//     links, buttons and menus wants the browser's native table navigation
//     and its own tab order. Half a grid role is worse than none; the kit's
//     full one lives in <Sheet>.
//  6. THE SCROLL CONTAINER IS REACHABLE. MUI's `TableContainer` is literally
//     `{width:'100%',overflowX:'auto'}` with no `tabindex` and no `role`, so
//     a table wider than its pane cannot be scrolled from the keyboard at
//     all. Tremor and shadcn ship the same bug. Here the scroller is a named
//     `role='region'` with a tab stop, the documented pattern.
//  7. FILTERED-EMPTY IS ITS OWN STATE. shadcn renders one "No results." for
//     both "this dataset is empty" and "your filters matched nothing" — the
//     second needs a way out, and gets one here: a distinct state with a
//     Clear filters action. `DataShell` still owns loading/error/empty.
//  8. FILTERS ARE IN THE TOOLBAR, NOT IN HEADER POPOVERS. Ant hides each
//     column's filter behind a funnel icon inside the `<th>`, which puts a
//     second interactive control in a cell that is also the sort button and
//     leaves the ACTIVE filter invisible until you go looking. Here every
//     filterable column gets a labelled control in the toolbar (a text field,
//     or `FilterChips` for an enum), the affected `<th>` is marked
//     `data-filtered`, and the whole filter state is legible in a still
//     frame — Law 8.
//  9. PINNING IS HONEST. Ant's `fixed` measures columns at runtime; <Sheet>
//     documents that its own pinning is CSS, not the engine's. Here a pinned
//     column must declare `@width`, offsets are summed from those declared
//     widths, and a pinned column that follows an unmeasurable one is left
//     unpinned rather than overlapping — the failure is visible, not subtle.
// 10. NO WINDOW MEDIA QUERIES. Ant's `Descriptions` and `List` resolve their
//     responsive column counts through `matchMedia` on the VIEWPORT. Inside a
//     Boxel card that is the wrong box entirely — a card knows its pane, not
//     the window. Everything here folds on unnamed container queries.
// 11. NO HEADING HAZARD. Ant's `List.Item.Meta` hard-codes an `<h4>` for
//     every row title, so a list drops an h4 into whatever outline it lands
//     in. `<Item>` emits a `<span>`; put your own heading in `<:title>`.
//
// ─── DELIBERATELY NOT BUILT (Law 7 — name the edge) ──────────────────────
//   • VIRTUALIZATION. Not here, and not a stub. The kit already owns one
//     windowing implementation — `AssetGrid` (media-library.gts) over
//     TanStack Virtual's framework-agnostic core — and a second one inside a
//     `<table>` would be a second engine, not a feature. A listing that needs
//     more rows than the DOM can hold should page (`@pageSize`) or use
//     AssetGrid's model. Say so out loud rather than shipping a slow table.
//   • TREE DATA. `<Tree>` is the kit's tree and it is a
//     better one than Ant's `childrenColumnName` recursion. `<:expanded>`
//     covers per-row detail, which is the case a listing actually has.
//   • MULTI-COLUMN SORT, column resize, drag-reorder. Each is a real feature
//     with a real interaction contract; none is half-shipped here.
//   • SERVER-SIDE FILTERING as a mode. The built-in matchers run in the
//     browser over whatever rows are in hand, eager or loaded. To filter at
//     the source instead, hold `@filters` yourself, feed them into `@loadKey`
//     and let `@load` return the narrowed set — the component then filters a
//     set that is already narrow, which is a no-op, not a conflict.
//
// Pretui — the record-listing vocabulary shared by Descriptions, Item, List and DataTable: the size scale, row cursor and value printing.
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { PretuiSize } from '../pretui-primitives';

// ── shared vocabulary ────────────────────────────────────────────────────

/** Every `@size` spelling an agent might type, narrowed to the house scale.
 * The house enum stays `xs|s|m|l|xl` (Appendix E.2); `sm`/`md`/`lg` are the
 * shadcn/Tailwind spellings, `small`/`medium`/`large` MUI's and Ant's, and
 * `middle` is Ant's deprecated one. */
export type ListingSizeArg =
  | PretuiSize
  | 'sm'
  | 'md'
  | 'lg'
  | 'default'
  | 'small'
  | 'medium'
  | 'large'
  | 'middle';


/**
 * Sets `indeterminate` — a PROPERTY with no content attribute at all, which
 * is why it cannot be bound as `indeterminate={{...}}`: Glimmer would call
 * `setAttribute` and the checkbox would stay unchecked-looking with no
 * mixed state and no `aria-checked='mixed'`.
 *
 * Exported because a select-all checkbox is not a table-only idea.
 */
export const setsIndeterminate = modifier(
  (el: HTMLInputElement, [mixed]: [boolean]) => {
    el.indeterminate = mixed;
  },
);

/**
 * The roving keyboard cursor a row collection needs: one tab stop for the
 * whole list, arrows to move within it, Home/End to the ends.
 *
 * It is a plain class, not a component and not a modifier, for the reason
 * `DataSource` is one: it is testable without a DOM and it can be held by
 * anything. `<List>` holds one. `<DataTable>` deliberately does NOT — a
 * plain `<table>` must leave Tab alone so the links, buttons and checkboxes
 * inside its cells stay reachable in document order. Roving row focus is a
 * `role='grid'` behaviour, and this file does not claim that role.
 */
export class RowCursor {
  constructor(private readCount: () => number) {}

  @tracked private index = 0;
  /** true only while the KEYBOARD is driving, so `focusWhen` never steals
   * focus on a pointer path or a plain re-render */
  @tracked navigating = false;

  get count(): number {
    return this.readCount();
  }
  /** the cursor, clamped to the collection as it is right now */
  get active(): number {
    return Math.min(this.index, Math.max(0, this.count - 1));
  }
  isActive = (index: number): boolean => index === this.active;
  isFocusTarget = (index: number): boolean =>
    this.navigating && this.isActive(index);

  /** move the cursor and take focus with it */
  moveTo = (index: number): void => {
    if (index < 0 || index >= this.count) {
      return;
    }
    this.navigating = true;
    this.index = index;
  };

  /** follow focus that arrived some other way (a click, a Tab from outside)
   * without taking it — the early return is what keeps `focusWhen`'s
   * synchronous `el.focus()` from re-entering as a backtracking re-render */
  follow = (index: number): void => {
    if (index === this.active) {
      return;
    }
    this.navigating = false;
    this.index = index;
  };

  /** returns true when the key was consumed and the caller should
   * `preventDefault()` */
  handleKey = (key: string): boolean => {
    switch (key) {
      case 'ArrowDown':
        this.moveTo(this.active + 1);
        return true;
      case 'ArrowUp':
        this.moveTo(this.active - 1);
        return true;
      case 'Home':
        this.moveTo(0);
        return true;
      case 'End':
        this.moveTo(this.count - 1);
        return true;
      default:
        return false;
    }
  };
}

/** Read one field off a generic row without an `any`. */
export function readField(row: unknown, key: string): unknown {
  return row && typeof row === 'object'
    ? (row as Record<string, unknown>)[key]
    : undefined;
}

/** Print a cell value. `null`/`undefined` become the placeholder rather than
 * the strings "null" and "undefined", which is what `String(v)` would give
 * you and what half the corpus actually renders. */
export function printValue(value: unknown, placeholder: string): string {
  if (value === undefined || value === null || value === '') {
    return placeholder;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}
