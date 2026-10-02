// Pretui — data-component: the foundation base class every data-rich
// component in the kit extends (Chart, Sheet, Table, DataGrid, Feed, Tree,
// Masonry, Board, Lookup). It is state and contract, not layout: one shared,
// tested answer to loading, emptiness, failure, selection, activation and
// sort, so nine components stop reinventing five of them each.
//
// THREE ENTRY POINTS, in the order you should reach for them:
//   • `DataComponent<T>` — extend it when your component's args ARE the data
//     args. You inherit the template, the chrome and the whole API.
//   • `DataSource<T>`    — hold one when your component needs args or blocks
//     of its own (`@columns`, `@series`, a `<:cell>` block). Identical state
//     machine, one line: `data = new DataSource<T>(() => this.args)`.
//   • `DataShell`        — the chrome alone, pointed at either of the above.
//
// PORTED FROM — three lineages, none of them adopted whole:
//   • TanStack Table's row model (getRowId, sorting state, row selection as
//     a keyed record) — the interaction half.
//   • TanStack Query / ember-concurrency task state — the status half
//     (idle → loading → settled, with the error captured rather than thrown).
//   • The kit's own Feed/DataGrid, which had grown private, incompatible
//     copies of both halves.
//
// WHAT THIS DOES BETTER THAN ITS INSPIRATION (the acceptance test):
//
//   1. `empty` is a first-class status, never a boolean. TanStack Table has
//      no notion of emptiness at all, so every consumer writes
//      `{{#if (eq rows.length 0)}}No results{{/if}}` — which renders "No
//      results" while the first fetch is still in flight. Here the status is
//      DERIVED and `loading` outranks `empty`, so that bug is unwritable.
//   2. The row type is generic, end to end. TanStack types rows as
//      `TData` but the kit's own collections had decayed to
//      `Record<string, any>` (DataGrid), `[key: string]: unknown` (Feed) and
//      `readonly unknown[]` (Masonry) — every caller narrowing by hand inside
//      the block. `T` flows from `@rows` straight into the yielded block.
//   3. It does not own the fetch. TanStack Query needs a QueryClient and a
//      provider; this takes a plain `() => Promise<readonly T[]>` and knows
//      nothing about HTTP, cache keys or retries-with-backoff. That also
//      keeps it inside the realm's no-timer law — there is no debounce here,
//      because a debounce is a timer and belongs to the caller.
//   4. A stale response can never win. React's classic out-of-order-response
//      bug (documented in its own docs as "race conditions") is closed by a
//      monotonic request token: every settle re-checks that it is still the
//      newest request before it writes a single tracked field.
//   5. Accessibility is IN the base class, which is the entire argument for
//      having one. `aria-busy` while loading, and a polite live region that
//      announces the RESULT COUNT when it settles — the thing that makes an
//      async table usable with a screen reader and that essentially no table
//      library ships. It announces on settle, never per keystroke, because
//      the announcement string is derived only from settled state.
//   6. Errors are text, not a red border. The failure surfaces through
//      <Alert> with a title, the message, a retry button and (when the load
//      is keyed) a <BrokenLink> naming the dataset that would not come.
//
// DROPPED ON PURPOSE (Law 7 — name the edges rather than half-ship them):
//   • Pagination / virtualization. <Pagination> exists and
//     windowing is the host's job; a base class that also owned the window
//     would own layout, which is exactly what this must not do.
//   • Filtering and grouping. Both are pure functions over `@rows` that the
//     caller can apply before handing them over, and a filter model that
//     cannot be expressed as `rows.filter(...)` is a query, not a component.
//   • Debounce / polling / retry-with-backoff. All three are timers (realm
//     law), and all three are policy the caller owns.
//   • Optimistic mutation. This is a reading contract; writing is not here.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint can't see
// it here (accepted parse baseline, same as overlay.gts / structure-data.gts)
import { modifier } from 'ember-modifier';
import { Button } from './components/button';
import { Alert } from './components/alert';
import { BrokenLink } from './components/broken-link';
import { Spinner } from './components/spinner';
import { EmptyState } from './components/empty-state';
import { Skeleton } from './components/skeleton';

// ── The shared collection vocabulary ─────────────────────────────────────
// Exported as named primitives rather than buried, because every collection
// in the kit keys rows and every one of them should key them the same way.

/**
 * The five states a dataset can be in. Derived, never assigned: see
 * `DataComponent#status`. `empty` is distinguished from `loading` so that
 * "No results" can never render over an in-flight request.
 */
export type DataStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/** What a row is keyed by. Strings and numbers only — a key is compared with
 * `===` and must survive being written into a `data-` attribute. */
export type RowKey = string | number;

/** Caller-supplied key accessor: stable identity for one row. */
export type RowKeyFn<T> = (row: T, index: number) => RowKey;

/** The dataset loader. Deliberately knows nothing about HTTP: it is any
 * function returning a promise of rows. */
export type DataLoad<T> = () => Promise<readonly T[]> | readonly T[];

/** How many rows may be selected at once. */
export type SelectionMode = 'none' | 'single' | 'multi';

/** Sort direction. */
export type SortDir = 'asc' | 'desc';

/** The current sort: a column key plus a direction. `null` means unsorted,
 * which is a third state the asc/desc cycle passes through. */
export interface SortState {
  /** the field/column key being sorted on */
  key: string;
  /** ascending or descending */
  dir: SortDir;
}

/**
 * THE documented key fallback, shared by every collection in the kit.
 *
 * 1. `@key` accessor if the caller supplied one — always prefer this.
 * 2. otherwise the row's own `id` when it is a string or number (the shape
 *    Boxel cards, `FeedItem` and every fixture in examples.gts already have);
 * 3. otherwise the row's 0-based index.
 *
 * Branch 3 is a real, documented compromise, not a silent one: an
 * index-keyed row's identity MOVES when the collection is re-sorted or
 * spliced, so selection and the active row follow the position rather than
 * the record. Any collection whose rows can be re-ordered should pass `@key`.
 */
export function defaultRowKey(row: unknown, index: number): RowKey {
  if (row && typeof row === 'object') {
    let id = (row as Record<string, unknown>)['id'];
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
  }
  return index;
}

/** Reads one field off a row for the default comparator. Rows are generic,
 * so the read is an explicit widening rather than an `any`. */
function readField(row: unknown, key: string): unknown {
  return row && typeof row === 'object'
    ? (row as Record<string, unknown>)[key]
    : undefined;
}

/** Total order over unknown values: numbers numerically, everything else by
 * locale-free string compare, with null/undefined last in either direction.
 * Anything richer (dates as objects, money, nested paths) wants `@comparator`. */
function compareValues(a: unknown, b: unknown): number {
  let aMissing = a === undefined || a === null;
  let bMissing = b === undefined || b === null;
  if (aMissing || bMissing) {
    return aMissing && bMissing ? 0 : aMissing ? 1 : -1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  let as = String(a);
  let bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Everything is an Error by the time it reaches tracked state — a thrown
 * string, a rejected `{ message }`, or a genuine Error. Never swallowed. */
function toError(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  if (typeof thrown === 'string') {
    return new Error(thrown);
  }
  let message = readField(thrown, 'message');
  return new Error(typeof message === 'string' ? message : 'Load failed');
}

// ── The load modifier ────────────────────────────────────────────────────
// Loading is kicked off from a modifier rather than a getter or a constructor
// for two reasons: a getter with a side effect is a backtracking re-render
// waiting to happen, and a constructor cannot re-run when the load key
// changes. The extra positionals are not read — they exist so that changing
// `@load`, `@loadKey`, or the reload epoch re-runs the modifier, which is
// what "re-load when the key changes" means with no timer and no observer.

/** Re-runs `beginLoad()` whenever the loader, its key, or the reload epoch
 * changes. Exported so a subclass that writes its own `<template>` (and
 * therefore does not render `<DataShell>`) can still wire the loader. */
export const dataLoad = modifier(
  (
    _el: Element,
    [state, _load, _key, _epoch]: [DataState, unknown, unknown, number],
  ) => {
    state.beginLoad();
  },
);

// ── The shell contract ───────────────────────────────────────────────────

/**
 * The narrow, non-generic slice of a data component that the shared chrome
 * needs. `DataComponent` implements it; a component that cannot extend
 * `DataComponent` (because it already extends something else) can implement
 * this instead and still wear the same chrome.
 */
export interface DataState {
  /** derived status — see `DataStatus` */
  readonly status: DataStatus;
  /** `'true'` while a request is in flight, for `aria-busy` */
  readonly busy: 'true' | 'false';
  /** the polite live-region text; empty while idle or loading */
  readonly announcement: string;
  /** human-readable failure message, `''` when there is none */
  readonly errorMessage: string;
  /** printable form of the load key, for the BrokenLink reference */
  readonly loadRef: string | undefined;
  /** true when there is a loader to retry with */
  readonly canRetry: boolean;
  /** dependency handle for the load modifier — never called by the shell */
  readonly loadFn: unknown;
  /** dependency handle for the load modifier — never called by the shell */
  readonly loadKey: unknown;
  /** bumped by `reload()`; re-runs the load modifier */
  readonly epoch: number;
  /** starts a load if one is warranted; safe to call on every render */
  beginLoad(): void;
  /** discards any in-flight request and starts a fresh one */
  reload(): void;
}

export interface DataShellSignature {
  Args: {
    /** the data component (or any `DataState`) whose chrome this is */
    state: DataState;
    /** true when the host was given a `loading` block to forward */
    hasLoading?: boolean;
    /** true when the host was given an `empty` block to forward */
    hasEmpty?: boolean;
    /** true when the host was given an `error` block to forward */
    hasError?: boolean;
    /** headline for the default empty state */
    emptyTitle?: string;
    /** supporting line for the default empty state */
    emptyMessage?: string;
    /** visible label beside the default loading spinner (default 'Loading') */
    loadingLabel?: string;
    /** how many skeleton lines the default loading state draws (default 3) */
    skeletonRows?: number;
    /** headline for the default error state (default 'Could not load') */
    errorTitle?: string;
  };
  Blocks: {
    /** the settled, non-empty content */
    default: [];
    /** replaces the default spinner + skeleton */
    loading: [];
    /** replaces the default EmptyState */
    empty: [];
    /** replaces the default Alert */
    error: [];
  };
  Element: HTMLDivElement;
}

/**
 * The small amount of shared chrome that goes with the base class: the
 * `aria-busy` root, the polite live region, and the four state slots. It is a
 * separate component precisely so a subclass that writes its own
 * `<template>` keeps every accessibility guarantee without copying it.
 */
export class DataShell extends Component<DataShellSignature> {
  // Three booleans rather than an `eq` helper: the kit vendors no helper
  // package (Law 9) and a getter reads better in the branch than a curly.
  get isLoading(): boolean {
    return this.args.state.status === 'loading';
  }
  get isError(): boolean {
    return this.args.state.status === 'error';
  }
  get isEmpty(): boolean {
    return this.args.state.status === 'empty';
  }
  get skeletonRows(): number[] {
    let n = Math.max(1, Math.floor(this.args.skeletonRows ?? 3));
    let out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i);
    }
    return out;
  }
  get loadingLabel(): string {
    return this.args.loadingLabel ?? 'Loading';
  }
  get emptyTitle(): string {
    return this.args.emptyTitle ?? 'Nothing to show yet';
  }
  get emptyMessage(): string {
    return (
      this.args.emptyMessage ??
      'No records match this view. Adjust the filters, or check back once the desk has logged something.'
    );
  }
  get errorTitle(): string {
    return this.args.errorTitle ?? 'Could not load';
  }
  retry = () => {
    this.args.state.reload();
  };

  <template>
    <div
      class='pretui-data'
      data-test-pretui-data
      data-status={{@state.status}}
      aria-busy={{@state.busy}}
      {{dataLoad @state @state.loadFn @state.loadKey @state.epoch}}
      ...attributes
    >
      {{! The live region is ALWAYS in the DOM and always empty-to-start:
          an aria-live element inserted with text already in it is not
          reliably announced. Its text changes only when a load settles,
          so sorting, hovering and typing produce no announcement. }}
      <p class='pretui-sr' role='status' data-test-pretui-data-live>
        {{@state.announcement}}
      </p>

      {{#if this.isLoading}}
        {{#if @hasLoading}}
          {{yield to='loading'}}
        {{else}}
          <div class='pretui-data-loading'>
            <span class='pretui-data-loading-head'>
              <Spinner />
              <span>{{this.loadingLabel}}</span>
            </span>
            {{#each this.skeletonRows key='@index' as |row|}}
              <span class='pretui-data-skeleton' data-row={{row}}>
                <Skeleton @width='34%' @height='11px' />
                <Skeleton @height='11px' />
              </span>
            {{/each}}
          </div>
        {{/if}}
      {{else if this.isError}}
        {{#if @hasError}}
          {{yield to='error'}}
        {{else}}
          <Alert @tone='danger' @title={{this.errorTitle}}>
            <:default>
              <p class='pretui-data-errmsg'>{{@state.errorMessage}}</p>
              {{#if @state.loadRef}}
                <BrokenLink
                  @label='dataset unavailable'
                  @refId={{@state.loadRef}}
                />
              {{/if}}
            </:default>
            <:action>
              {{#if @state.canRetry}}
                <Button
                  @appearance='outlined'
                  @size='s'
                  data-test-pretui-data-retry
                  {{on 'click' this.retry}}
                >Try again</Button>
              {{/if}}
            </:action>
          </Alert>
        {{/if}}
      {{else if this.isEmpty}}
        {{#if @hasEmpty}}
          {{yield to='empty'}}
        {{else}}
          <EmptyState @title={{this.emptyTitle}} @message={{this.emptyMessage}} />
        {{/if}}
      {{else}}
        {{yield}}
      {{/if}}
    </div>
    <style scoped>
      .pretui-data {
        container-type: inline-size;
        display: block;
        min-width: 0;
        color: var(--foreground);
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .pretui-data-loading {
        display: grid;
        gap: var(--pretui-data-gap, var(--space-3, 8px));
      }
      .pretui-data-loading-head {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        color: var(--muted-foreground);
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
      }
      .pretui-data-skeleton {
        display: grid;
        gap: 7px;
        padding: var(--space-4, 11px) var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .pretui-data-errmsg {
        margin: 0 0 var(--space-2, 6px);
        max-width: 60ch;
      }
      /* Unnamed container query only (a named one silently drops every
         later rule in the transpiled stylesheet). It resolves against the
         nearest ANCESTOR container — .pretui-data above — so it styles the
         children, never the container element itself. */
      @container (max-width: 24rem) {
        .pretui-data-skeleton {
          padding: var(--space-3, 8px) var(--space-4, 11px);
        }
      }
    </style>
  </template>
}

// ── The base class ───────────────────────────────────────────────────────

/**
 * Everything a data component accepts. Subclasses widen this through the
 * `Extra` type parameter rather than re-declaring it.
 */
export interface DataArgs<T> {
  /** Eager rows. Supply EITHER this or `@load`, never both — when `@rows` is
   * present it is the single source of truth and `@load` is never invoked. */
  rows?: readonly T[];
  /** Async loader, invoked and awaited by the component. It is any function
   * returning rows or a promise of rows: the component knows nothing about
   * HTTP, so authentication, caching and request cancellation stay yours. */
  load?: DataLoad<T>;
  /** Re-run `@load` whenever this value changes (a query string, a page
   * number, a card id). Compared by identity. There is NO debounce — that is
   * a timer, and the realm forbids timers; debounce this value yourself. */
  loadKey?: unknown;
  /** Stable identity for a row. Strongly recommended whenever rows can be
   * re-ordered — see `defaultRowKey` for the fallback and its consequences. */
  key?: RowKeyFn<T>;
  /** `'none'` (default), `'single'` or `'multi'`. */
  selectionMode?: SelectionMode;
  /** Controlled selection. Omit for uncontrolled (the component keeps its
   * own), pass an array to drive it from outside. */
  selected?: readonly RowKey[];
  /** Initial selection for the uncontrolled case. */
  defaultSelected?: readonly RowKey[];
  /** Fires with the next selection on every change, controlled or not. */
  onSelectionChange?: (keys: RowKey[], rows: T[]) => void;
  /** Controlled active/highlighted row (the keyboard cursor, not selection).
   * Omit for uncontrolled; pass `null` to force "no active row". */
  activeKey?: RowKey | null;
  /** Initial active row for the uncontrolled case. */
  defaultActiveKey?: RowKey | null;
  /** Fires with the next active row on every change. */
  onActiveChange?: (key: RowKey | null, row: T | undefined) => void;
  /** Controlled sort. Omit for uncontrolled; `null` means unsorted. */
  sort?: SortState | null;
  /** Initial sort for the uncontrolled case. */
  defaultSort?: SortState | null;
  /** Fires with the next sort on every change, including the `null` step. */
  onSortChange?: (sort: SortState | null) => void;
  /** Replaces the default field comparator. Receives the active sort so one
   * function can handle every column. Return <0, 0 or >0 for ASCENDING order;
   * the component applies the direction. */
  comparator?: (a: T, b: T, sort: SortState) => number;
  /** Accessible name for the collection, used in the count announcement
   * ("6 lots" rather than "6 results"). Singular/plural handled below. */
  itemNoun?: string;
  /** Silences the polite count announcement. Reach for this only when the
   * host already announces the same result elsewhere — double announcements
   * are worse than none. */
  silentCount?: boolean;
  /** Headline for the default empty state. */
  emptyTitle?: string;
  /** Supporting line for the default empty state. */
  emptyMessage?: string;
  /** Label beside the default loading spinner. */
  loadingLabel?: string;
  /** Skeleton line count for the default loading state (default 3). */
  skeletonRows?: number;
}

/** The interaction surface yielded to the default block alongside the rows.
 * Everything here is safe to call from a template. */
export interface DataApi<T> {
  /** derived status */
  status: DataStatus;
  /** number of rows currently rendered */
  count: number;
  /** failure message, `''` when there is none */
  errorMessage: string;
  /** the key this component would use for a row */
  keyFor: (row: T, index: number) => RowKey;
  /** current selection mode */
  selectionMode: SelectionMode;
  /** keys of the selected rows */
  selectedKeys: readonly RowKey[];
  /** the selected rows themselves */
  selectedRows: T[];
  /** is this row selected? */
  isSelected: (row: T, index: number) => boolean;
  /** toggle a row per the selection mode (no-op when mode is `'none'`) */
  toggleSelected: (row: T, index: number) => void;
  /** select every rendered row (multi only) */
  selectAll: () => void;
  /** drop the whole selection */
  clearSelection: () => void;
  /** key of the active/highlighted row */
  activeKey: RowKey | null;
  /** is this row the active one? */
  isActive: (row: T, index: number) => boolean;
  /** make this row active (`null` clears) */
  setActive: (row: T | null, index: number) => void;
  /** current sort */
  sort: SortState | null;
  /** cycle a column asc → desc → unsorted */
  toggleSort: (key: string) => void;
  /** `'ascending' | 'descending' | 'none'`, ready for `aria-sort` */
  ariaSort: (key: string) => 'ascending' | 'descending' | 'none';
  /** discard any in-flight request and load again */
  reload: () => void;
}

export interface DataBlocks<T> {
  /** the settled rows plus the interaction API */
  default: [rows: T[], data: DataApi<T>];
  /** replaces the default spinner + skeleton */
  loading: [];
  /** replaces the default EmptyState */
  empty: [];
  /** replaces the default Alert */
  error: [];
}

export interface DataComponentSignature<
  T,
  El extends Element = HTMLDivElement,
> {
  Args: DataArgs<T>;
  Blocks: DataBlocks<T>;
  Element: El;
}

/**
 * THE state machine, as a plain class rather than a component.
 *
 * It is separate from `DataComponent` for a reason that is worth stating,
 * because it is the difference between a base class that only serves its own
 * demo and one the whole kit can use. Glint infers a component's row type
 * from its `Args` type — and inference dies the moment `Args` is anything
 * but a bare `DataArgs<T>`: an intersection with an `Extra` type parameter
 * (`DataArgs<T> & Extra`) makes every caller's `T` collapse to `{}`. So a
 * base class cannot both infer `T` and let subclasses add their own args.
 *
 * Inheritance therefore covers the plain case, and DELEGATION covers the
 * rest: a component with its own signature — `@columns`, `@series`, extra
 * blocks, a different Element — holds a DataSource, points `<DataShell>` at
 * it, and gets the identical state machine:
 *
 *     class KitTable<T> extends Component<KitTableSignature<T>> {
 *       data = new DataSource<T>(() => this.args);
 *       <template><DataShell @state={{this.data}}> … </DataShell></template>
 *     }
 *
 * The constructor takes a THUNK, not the args object, so every read goes
 * through the live `this.args` and autotracking stays intact.
 */
export class DataSource<T> implements DataState {
  constructor(private readArgs: () => DataArgs<T>) {}

  /** the host's current args — read through the thunk on every access so
   * tracked argument changes are observed normally */
  private get a(): DataArgs<T> {
    return this.readArgs();
  }

  // ── load state ─────────────────────────────────────────────────────────
  @tracked private loadedRows: readonly T[] = [];
  @tracked private inFlight = false;
  @tracked private settled = false;
  @tracked private failure: Error | undefined = undefined;
  @tracked epoch = 0;

  // Plain (untracked) fields on purpose: the request token is compared, never
  // rendered, and reading it during a render would make every settle a
  // re-render dependency.
  private requestToken = 0;

  // ── interaction state ──────────────────────────────────────────────────
  // `undefined` means "the caller's @default* still applies"; anything else
  // is a real uncontrolled value, including an empty selection and a null
  // sort. Seeded lazily rather than in the field initialiser because field
  // initialisers run BEFORE the constructor body, where `readArgs` is
  // assigned — reading args here would be a crash, not a bug you find later.
  @tracked private internalSelected: readonly RowKey[] | undefined = undefined;
  @tracked private internalActive: RowKey | null | undefined = undefined;
  @tracked private internalSort: SortState | null | undefined = undefined;

  // ── loading ────────────────────────────────────────────────────────────

  get loadFn(): unknown {
    return this.a.load;
  }
  get loadKey(): unknown {
    return this.a.loadKey;
  }
  get loadRef(): string | undefined {
    let key = this.a.loadKey;
    return typeof key === 'string' || typeof key === 'number'
      ? String(key)
      : undefined;
  }
  get canRetry(): boolean {
    return this.a.load !== undefined && this.a.rows === undefined;
  }

  /**
   * Called by the `dataLoad` modifier on insert and on every change to
   * `@load` / `@loadKey` / `epoch`. Writes NO tracked state synchronously —
   * the modifier runs inside the render transaction, and a tracked write
   * there is the backtracking-rerender assertion.
   */
  beginLoad = (): void => {
    let load = this.a.load;
    // A new token retires every earlier request, in flight or not. This one
    // line is the whole stale-response guard: the token is the only thing a
    // settling promise is allowed to write through.
    let token = ++this.requestToken;
    if (!load || this.a.rows !== undefined) {
      return;
    }
    // Fire-and-forget by design; `runLoad` catches everything, so the promise
    // it returns can never reject and no rejection can go unhandled.
    void this.runLoad(load, token);
  };

  /** Discards whatever is in flight and loads again. */
  reload = (): void => {
    this.epoch = this.epoch + 1;
  };

  private async runLoad(load: DataLoad<T>, token: number): Promise<void> {
    // One microtask of distance from the render transaction that scheduled
    // us — after this line, tracked writes are safe. Not a timer.
    await Promise.resolve();
    if (token !== this.requestToken) {
      return;
    }
    this.inFlight = true;
    this.failure = undefined;
    try {
      let rows = await load();
      // STALE GUARD. A slower earlier request resolving after a faster later
      // one lands here with an outdated token and writes nothing.
      if (token !== this.requestToken) {
        return;
      }
      this.loadedRows = rows ?? [];
      this.failure = undefined;
    } catch (thrown) {
      if (token !== this.requestToken) {
        return;
      }
      // Captured, never swallowed: it becomes the error status and the
      // message the reader sees.
      this.failure = toError(thrown);
    } finally {
      // `return` inside `try` runs this too, so the guard is repeated: only
      // the newest request may flip the component out of `loading`.
      if (token === this.requestToken) {
        this.inFlight = false;
        this.settled = true;
      }
    }
  }

  // ── status ─────────────────────────────────────────────────────────────

  /**
   * The single readable state. DERIVED — nothing assigns it:
   *   error   a captured failure outranks everything, so a stale row set can
   *           never read as success;
   *   loading a request is in flight, OR one is about to start and has never
   *           settled (which is what closes the empty-flash on first paint);
   *   ready   settled with rows;
   *   empty   settled with none — only ever reachable when nothing is
   *           loading, which is the bug this ordering exists to prevent;
   *   idle    no rows and no loader: nobody has asked for anything.
   */
  get status(): DataStatus {
    if (this.failure) {
      return 'error';
    }
    if (this.inFlight) {
      return 'loading';
    }
    if (this.a.rows !== undefined) {
      return this.a.rows.length > 0 ? 'ready' : 'empty';
    }
    if (this.a.load === undefined) {
      return 'idle';
    }
    if (!this.settled) {
      return 'loading';
    }
    return this.loadedRows.length > 0 ? 'ready' : 'empty';
  }

  get busy(): 'true' | 'false' {
    return this.status === 'loading' ? 'true' : 'false';
  }

  get errorMessage(): string {
    return this.failure ? this.failure.message : '';
  }

  /** The rows as given: `@rows` when eager, the loaded set otherwise. */
  get rows(): readonly T[] {
    return this.a.rows ?? this.loadedRows;
  }

  /** The rows as rendered: sorted when a sort is active. Never mutates the
   * caller's array. */
  get visibleRows(): T[] {
    let rows = this.rows;
    let sort = this.sort;
    if (!sort) {
      return rows.slice();
    }
    let dir = sort.dir === 'desc' ? -1 : 1;
    // Annotated local: TS drops the `!sort` narrowing inside the closure.
    let active: SortState = sort;
    return rows.slice().sort((a, b) => this.compare(a, b, active) * dir);
  }

  get count(): number {
    return this.visibleRows.length;
  }

  /**
   * The polite announcement. Derived ONLY from settled state, which is how
   * "do not announce on every keystroke" is enforced structurally rather than
   * by remembering to: while a request is in flight the text is empty, so a
   * caller-driven filter that re-queries announces once when the new results
   * land, not once per key. Identical text is not re-announced by assistive
   * technology, so re-sorting the same 6 rows stays silent too.
   */
  get announcement(): string {
    if (this.a.silentCount) {
      return '';
    }
    let noun = this.a.itemNoun ?? 'result';
    switch (this.status) {
      case 'ready': {
        let n = this.count;
        return `${n} ${n === 1 ? noun : `${noun}s`}`;
      }
      case 'empty':
        return `No ${noun}s`;
      case 'error':
        return `Could not load: ${this.errorMessage}`;
      default:
        return '';
    }
  }

  // ── keys ───────────────────────────────────────────────────────────────

  keyFor = (row: T, index: number): RowKey =>
    this.a.key ? this.a.key(row, index) : defaultRowKey(row, index);

  private rowsForKeys(keys: readonly RowKey[]): T[] {
    let wanted = new Set<RowKey>(keys);
    return this.visibleRows.filter((row, i) => wanted.has(this.keyFor(row, i)));
  }

  // ── selection ──────────────────────────────────────────────────────────

  get selectionMode(): SelectionMode {
    return this.a.selectionMode ?? 'none';
  }

  get selectedKeys(): readonly RowKey[] {
    if (this.a.selected !== undefined) {
      return this.a.selected;
    }
    return this.internalSelected ?? this.a.defaultSelected ?? [];
  }

  get selectedRows(): T[] {
    return this.rowsForKeys(this.selectedKeys);
  }

  get allSelected(): boolean {
    return this.count > 0 && this.selectedKeys.length === this.count;
  }

  isSelected = (row: T, index: number): boolean =>
    this.selectedKeys.includes(this.keyFor(row, index));

  toggleSelected = (row: T, index: number): void => {
    let mode = this.selectionMode;
    if (mode === 'none') {
      return;
    }
    let key = this.keyFor(row, index);
    let current = this.selectedKeys;
    let next: RowKey[];
    if (mode === 'single') {
      next = current.length === 1 && current[0] === key ? [] : [key];
    } else {
      next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
    }
    this.commitSelection(next);
  };

  selectAll = (): void => {
    if (this.selectionMode !== 'multi') {
      return;
    }
    this.commitSelection(
      this.allSelected ? [] : this.visibleRows.map((r, i) => this.keyFor(r, i)),
    );
  };

  clearSelection = (): void => {
    this.commitSelection([]);
  };

  private commitSelection(next: RowKey[]): void {
    // Uncontrolled unless `@selected` was passed — the kit's Slider/Tabs/
    // Comparison rule, applied identically so this feels native.
    if (this.a.selected === undefined) {
      this.internalSelected = next;
    }
    this.a.onSelectionChange?.(next, this.rowsForKeys(next));
  }

  // ── active row ─────────────────────────────────────────────────────────

  get activeKey(): RowKey | null {
    if (this.a.activeKey !== undefined) {
      return this.a.activeKey;
    }
    return this.internalActive !== undefined
      ? this.internalActive
      : (this.a.defaultActiveKey ?? null);
  }

  isActive = (row: T, index: number): boolean =>
    this.activeKey !== null && this.activeKey === this.keyFor(row, index);

  setActive = (row: T | null, index: number): void => {
    let next = row === null ? null : this.keyFor(row, index);
    if (this.a.activeKey === undefined) {
      this.internalActive = next;
    }
    this.a.onActiveChange?.(next, row ?? undefined);
  };

  // ── sort ───────────────────────────────────────────────────────────────

  get sort(): SortState | null {
    if (this.a.sort !== undefined) {
      return this.a.sort;
    }
    return this.internalSort !== undefined
      ? this.internalSort
      : (this.a.defaultSort ?? null);
  }

  /** asc → desc → unsorted, the three-step cycle DataGrid already used. */
  toggleSort = (key: string): void => {
    let current = this.sort;
    let next: SortState | null =
      !current || current.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null;
    if (this.a.sort === undefined) {
      this.internalSort = next;
    }
    this.a.onSortChange?.(next);
  };

  ariaSort = (key: string): 'ascending' | 'descending' | 'none' => {
    let current = this.sort;
    if (!current || current.key !== key) {
      return 'none';
    }
    return current.dir === 'asc' ? 'ascending' : 'descending';
  };

  private compare(a: T, b: T, sort: SortState): number {
    return this.a.comparator
      ? this.a.comparator(a, b, sort)
      : compareValues(readField(a, sort.key), readField(b, sort.key));
  }

  // ── the yielded hash ───────────────────────────────────────────────────

  get data(): DataApi<T> {
    return {
      status: this.status,
      count: this.count,
      errorMessage: this.errorMessage,
      keyFor: this.keyFor,
      selectionMode: this.selectionMode,
      selectedKeys: this.selectedKeys,
      selectedRows: this.selectedRows,
      isSelected: this.isSelected,
      toggleSelected: this.toggleSelected,
      selectAll: this.selectAll,
      clearSelection: this.clearSelection,
      activeKey: this.activeKey,
      isActive: this.isActive,
      setActive: this.setActive,
      sort: this.sort,
      toggleSort: this.toggleSort,
      ariaSort: this.ariaSort,
      reload: this.reload,
    };
  }

}

/**
 * The base class: a `DataSource` plus a template, for the common case where
 * a data component's args ARE the data args.
 *
 *     class LotList extends DataComponent<Lot> {
 *       <template>
 *         <DataShell @state={{this.source}}> … </DataShell>
 *       </template>
 *     }
 *
 * Extend it and either take the inherited `<template>` (shell + yielded
 * rows + interaction API) or write your own and render
 * `<DataShell @state={{this.source}}>` inside it — that is how a subclass
 * keeps aria-busy, the live region and every state slot without copying a
 * line of it.
 *
 * A subclass inherits the whole `DataSource` surface by forwarding, listed
 * below. NAMED EDGE (Law 7): the ARG and BLOCK sets are fixed at
 * `DataArgs<T>` / `DataBlocks<T>`, because a generic type parameter anywhere
 * inside `Args` makes Glint infer every caller's row type as `{}`, and a
 * block map built from a generic intersection cannot be flattened at all. A
 * component that needs its OWN args or blocks does not subclass — it holds a
 * `DataSource` and points `<DataShell>` at it, which costs one line and
 * loses nothing.
 */
export class DataComponent<
  T,
  El extends Element = HTMLDivElement,
> extends Component<DataComponentSignature<T, El>> {
  /** the state machine — pass it to `<DataShell @state={{this.source}}>` */
  source = new DataSource<T>(() => this.args);

  // Thin forwards so a subclass template reads `this.visibleRows` rather
  // than `this.source.visibleRows`. Arrow-valued members are forwarded by
  // reference (they are already bound to the source), getters by delegation.
  get status(): DataStatus {
    return this.source.status;
  }
  get busy(): 'true' | 'false' {
    return this.source.busy;
  }
  get errorMessage(): string {
    return this.source.errorMessage;
  }
  get announcement(): string {
    return this.source.announcement;
  }
  get rows(): readonly T[] {
    return this.source.rows;
  }
  get visibleRows(): T[] {
    return this.source.visibleRows;
  }
  get count(): number {
    return this.source.count;
  }
  get selectionMode(): SelectionMode {
    return this.source.selectionMode;
  }
  get selectedKeys(): readonly RowKey[] {
    return this.source.selectedKeys;
  }
  get selectedRows(): T[] {
    return this.source.selectedRows;
  }
  get allSelected(): boolean {
    return this.source.allSelected;
  }
  get activeKey(): RowKey | null {
    return this.source.activeKey;
  }
  get sort(): SortState | null {
    return this.source.sort;
  }
  get data(): DataApi<T> {
    return this.source.data;
  }
  keyFor = this.source.keyFor;
  isSelected = this.source.isSelected;
  toggleSelected = this.source.toggleSelected;
  selectAll = this.source.selectAll;
  clearSelection = this.source.clearSelection;
  isActive = this.source.isActive;
  setActive = this.source.setActive;
  toggleSort = this.source.toggleSort;
  ariaSort = this.source.ariaSort;
  reload = this.source.reload;

  <template>
    <DataShell
      @state={{this.source}}
      @hasLoading={{has-block 'loading'}}
      @hasEmpty={{has-block 'empty'}}
      @hasError={{has-block 'error'}}
      @emptyTitle={{@emptyTitle}}
      @emptyMessage={{@emptyMessage}}
      @loadingLabel={{@loadingLabel}}
      @skeletonRows={{@skeletonRows}}
      ...attributes
    >
      <:default>{{yield this.visibleRows this.data}}</:default>
      <:loading>{{yield to='loading'}}</:loading>
      <:empty>{{yield to='empty'}}</:empty>
      <:error>{{yield to='error'}}</:error>
    </DataShell>
  </template>
}
