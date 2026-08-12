// `PopoverState` — the per-host state machine that owns the
// currently-open popover's `(row, col, kind)` plus the hover-pause and
// dismiss-grace timers.
//
// THE PROBLEM
// ===========
//
// Every host that wants the hover-to-Details + click-to-Edit +
// escalation flow was reinventing the same ~150 lines of state in
// its component class:
//
//   - `@tracked target` — open-cell + kind
//   - `private hoverTimer` / `dismissTimer` — pending opens / dismisses
//   - hover-enter / hover-leave handlers — schedule open / dismiss
//   - `openEdit` / `cancelEdit` / `escalate` — explicit transitions
//   - `cancelHoverTimer` / `cancelDismissTimer` / `scheduleDismiss`
//
// All of it driven by the same desktop gesture model (hover ~500ms
// pauses → details opens; pointer leaves source + popover → 200ms
// grace; pointer enters popover → grace canceled; click → edit opens;
// escalate transitions kind without unmounting). Different hosts
// kept getting the timing slightly wrong.
//
// THIS FILE
// =========
//
// Pulls that out into one class. The host owns ONE instance per
// surface root (one open popover at a time, just like a spreadsheet's
// CellPopover), passes it to the `surfacePopoverBinding` modifier on each
// hover-target element (cell / node / frame / unit — any unit the
// host wants to be popover-able), and reads `state.target / state.kind
// / state.anchorSelector` to drive the `<Popover>` mount.
//
// The state machine is host-agnostic — canvas nodes and kanban cards
// open popovers the same way grid cells do. "row" / "col" are just a
// generic coordinate pair the host assigns meaning to.
//
// Pure logic. No DOM, no Glimmer rendering. The companion
// `surfacePopoverBinding` modifier (in `modifiers/popover-binding.ts`)
// translates DOM events to method calls; the host's `<Popover>` template
// reads tracked properties for reactive opens / closes.
//
// LIFETIME
// ========
//
// One per surface root. Hosts construct it in their component
// constructor (or as a class field via `createPopoverState({...})`)
// and call `destroy()` in `willDestroy()` if they want to be tidy
// about leftover timers. Leaking timers is bounded (200-500ms) and
// harmless — they fire into a stale `@tracked` setter — but the
// destroy hook is there for fastidious hosts and tests.

import { tracked } from '@glimmer/tracking';

import type { PopoverKind } from './popover-types.ts';

/** The minimal per-unit contract this state machine reads: the list of
 *  popover kinds the unit supports. A unit whose `popover` array
 *  includes `'details'` gets hover peeks; one that includes `'edit'`
 *  gets dblclick-to-edit. Hosts with a richer contract object can pass
 *  it directly as long as it exposes a `popover: PopoverKind[]` field. */
export interface PopoverContract {
  popover: PopoverKind[];
}

/** What the host needs to know about the open popover. Three fields:
 *  WHICH unit (row, col coordinates), WHICH kind, and the implicit
 *  "is anything open" derived from `target !== null`.
 *
 *  `row` / `col` are intentionally generic: a grid uses (rowIdx,
 *  colIdx); a canvas uses (nodeRow, nodeField); a kanban could use
 *  (laneIdx, cardIdx). The state doesn't care what they mean — only
 *  that the pair uniquely identifies the unit so the
 *  `anchorSelectorFor` callback can resolve a DOM element. */
export interface PopoverTarget {
  row: number;
  col: number;
  kind: PopoverKind;
}

export interface PopoverStateOptions {
  /** Build the velcro anchor selector for the unit at (row, col).
   *  Defaults to `[data-row="${row}"][data-col="${col}"]` —
   *  override when the host scopes by id (e.g.,
   *  `[data-bx-grid="t1"] [data-row=...]`) or uses different
   *  attribute names. The selector must match exactly one element;
   *  velcro picks the first match if multiple match. */
  anchorSelectorFor?: (row: number, col: number) => string;

  /** Hover pause before opening the details popover. Filters out
   *  cursor flyovers (cursors that pass through a unit on the way
   *  to somewhere else). Tuned so deliberate hovers feel responsive
   *  but accidental ones don't trigger. ms. Default 500. */
  hoverPauseMs?: number;

  /** Grace window after `pointerleave` before dismissing the
   *  details popover. Lets the cursor travel from the source unit to
   *  the floating popover element without losing it (the popover cancels
   *  the dismiss on its own `pointerenter`). ms. Default 200. */
  dismissGraceMs?: number;

  /** After an explicit close (commit / cancel / outside-click),
   *  how long to suppress hover-opens in `scheduleHoverDetails`.
   *  Without this, closing an EDIT popover leaves the cursor over the
   *  source cell — the cell's pointerenter re-fires, schedules
   *  details, and a tooltip pops the user didn't ask for. The
   *  cooldown bridges the gap between the explicit close and the
   *  next intentional hover. ms. Default 600. */
  dismissCooldownMs?: number;
}

/** The open-popover state machine. See module docstring. */
export class PopoverState {
  /** The currently-open popover's `(row, col, kind)`, or null when no
   *  popover is open. Tracked so templates re-render on transitions
   *  (open → close, kind change, target change). */
  @tracked target: PopoverTarget | null = null;

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  /** Timestamp of the most-recent explicit close (commit / cancel /
   *  dismiss). `scheduleHoverDetails` checks this against `dismissCooldownMs`
   *  to suppress immediate re-opens. Without this, closing an EDIT popover
   *  (the cursor is still over the source cell because the popover was
   *  covering it) would trigger pointerenter on the cell underneath
   *  → schedule hover details → 500ms later a details popover pops open
   *  the user didn't ask for. */
  private lastClosedAt = 0;

  private opts: Required<PopoverStateOptions>;

  constructor(opts: PopoverStateOptions = {}) {
    this.opts = {
      anchorSelectorFor: opts.anchorSelectorFor ?? defaultAnchorSelectorFor,
      hoverPauseMs: opts.hoverPauseMs ?? 500,
      dismissGraceMs: opts.dismissGraceMs ?? 200,
      dismissCooldownMs: opts.dismissCooldownMs ?? 600,
    };
  }

  // ─── reactive queries (host reads these from templates) ──────────

  /** True when any popover is open (any unit, any kind). */
  get isOpen(): boolean {
    return this.target !== null;
  }

  /** The open popover's kind, or null if nothing is open. Templates
   *  use this to switch between Details and Edit content. */
  get kind(): PopoverKind | null {
    return this.target?.kind ?? null;
  }

  /** Velcro anchor selector for the open popover, or `''` if nothing
   *  is open. Pass directly to
   *  `<Popover @anchor={{state.anchorSelector}}>`. */
  get anchorSelector(): string {
    if (!this.target) return '';
    return this.opts.anchorSelectorFor(this.target.row, this.target.col);
  }

  /** True if the popover is open AND it points at this exact unit.
   *  Used by per-unit chrome (e.g. an affordance button) that needs to
   *  know "is the popover open on ME, specifically." */
  isOpenFor(row: number, col: number): boolean {
    return (
      this.target !== null && this.target.row === row && this.target.col === col
    );
  }

  // ─── transitions (modifier + host call these) ────────────────────

  /** Open the details popover on (row, col). Cancels any pending
   *  hover-open or dismiss timers. Idempotent — calling on the
   *  already-open unit is a no-op. */
  openDetails = (row: number, col: number): void => {
    this.cancelHoverTimer();
    this.cancelDismissTimer();
    this.target = { row, col, kind: 'details' };
  };

  /** Open the edit popover on (row, col). Cancels any pending hover /
   *  dismiss timers. The host typically calls this from explicit
   *  edit gestures (dblclick, Enter, F2). Idempotent. */
  openEdit = (row: number, col: number): void => {
    this.openPopover(row, col, 'edit');
  };

  /** Open the tools popover on (row, col). Tools popovers host action
   *  menus / command palettes. Same dispatch shape as openEdit; the
   *  host picks which to call based on the unit's supported kinds. */
  openTools = (row: number, col: number): void => {
    this.openPopover(row, col, 'tools');
  };

  /** Generic open-by-kind. Hosts that want to dispatch dynamically
   *  (e.g. "open whichever kind the unit declared most-escalated")
   *  call this directly:
   *
   *    const kind = contract.popover[contract.popover.length - 1];
   *    if (kind) this.popoverState.openPopover(rowIdx, colIdx, kind);
   *
   *  `openEdit` / `openTools` / `openDetails` stay as named
   *  conveniences for callers that always know the kind statically. */
  openPopover = (row: number, col: number, kind: PopoverKind): void => {
    this.cancelHoverTimer();
    this.cancelDismissTimer();
    this.target = { row, col, kind };
  };

  /** Schedule details to open on (row, col) after the hover pause.
   *  Bails out if the unit's contract doesn't list `'details'` in
   *  `popover[]`, or if an edit popover is already open (the user is
   *  committed to editing — no peeks). The companion modifier
   *  calls this on `pointerenter`. */
  scheduleHoverDetails = (
    row: number,
    col: number,
    contract: PopoverContract,
  ): void => {
    if (!contract.popover.includes('details')) return;
    // If edit is already open (any unit), don't peek — the user is
    // committed to editing.
    if (this.target?.kind === 'edit') return;
    // Dismiss-cooldown: after an explicit close (commit / cancel /
    // outside-click), suppress hover-opens for a brief window. Without
    // this, closing an EDIT popover leaves the cursor over the source
    // cell (the popover was covering it); the cell's pointerenter would
    // re-fire → schedule details → ~500ms later a tooltip pops the
    // user didn't ask for. The cooldown bridges the close → next
    // intentional hover gap.
    if (
      this.lastClosedAt > 0 &&
      Date.now() - this.lastClosedAt < this.opts.dismissCooldownMs
    ) {
      return;
    }
    this.cancelHoverTimer();
    this.cancelDismissTimer();
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      // Re-check after the wait — the user may have clicked, opened
      // edit, or moved focus mid-pause.
      if (this.target?.kind === 'edit') return;
      this.target = { row, col, kind: 'details' };
    }, this.opts.hoverPauseMs);
  };

  /** Cancel a pending hover-to-details timer; if a details popover IS
   *  open, schedule a dismiss after the grace window. Used by both
   *  source-pointerleave and popover-pointerleave — the dismiss only
   *  fires if neither the source nor the popover cancels it via
   *  `cancelDismiss()` first. */
  scheduleDismissDetails = (): void => {
    this.cancelHoverTimer();
    if (this.target?.kind !== 'details') return;
    this.cancelDismissTimer();
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      if (this.target?.kind === 'details') this.target = null;
    }, this.opts.dismissGraceMs);
  };

  /** Cancel a pending dismiss — pointer entered the popover element
   *  before the grace expired, so the user is reading the details. */
  cancelDismiss = (): void => {
    this.cancelDismissTimer();
  };

  /** Switch the open popover's kind without closing it. Same anchor,
   *  different content — the `<Popover>` re-renders its body without
   *  unmounting. Used for details ↔ edit escalation from inside
   *  the popover body or its toolbar. No-op if no popover is open. */
  escalate = (kind: PopoverKind): void => {
    if (!this.target) return;
    this.target = { ...this.target, kind };
  };

  /** Close the popover. Cancels all pending timers. Used for explicit
   *  dismissals (Esc, click-out, commit, cancel). Stamps `lastClosedAt`
   *  so `scheduleHoverDetails` can suppress immediate hover re-opens
   *  (the cursor is still over the source cell because the popover was
   *  covering it; the unmount triggers a synthetic pointerenter). */
  close = (): void => {
    this.cancelHoverTimer();
    this.cancelDismissTimer();
    this.target = null;
    this.lastClosedAt = Date.now();
  };

  // ─── teardown ────────────────────────────────────────────────────

  /** Cancel any pending timers. Hosts call this from `willDestroy()`
   *  to keep teardown tidy. Safe to call multiple times. */
  destroy(): void {
    this.cancelHoverTimer();
    this.cancelDismissTimer();
  }

  // ─── internals ───────────────────────────────────────────────────

  private cancelHoverTimer(): void {
    if (this.hoverTimer != null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private cancelDismissTimer(): void {
    if (this.dismissTimer != null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }
}

/** Default anchor selector — every host's body unit stamps
 *  `data-row="N"` and `data-col="N"`. Override via
 *  `PopoverStateOptions.anchorSelectorFor` when the host scopes by id
 *  (multiple grids on one page, multiple canvases stacked) or uses
 *  a different attribute scheme. */
function defaultAnchorSelectorFor(row: number, col: number): string {
  return `[data-row="${row}"][data-col="${col}"]`;
}

/** Factory. Use as a class field in your host component:
 *
 *    popoverState = createPopoverState({
 *      anchorSelectorFor: (r, c) =>
 *        `[data-bx-grid="t1"] [data-row="${r}"][data-col="${c}"]`,
 *    });
 *
 *  The instance is reactive — templates that read `state.target /
 *  kind / isOpen / anchorSelector` re-render on transitions. */
export function createPopoverState(
  opts: PopoverStateOptions = {},
): PopoverState {
  return new PopoverState(opts);
}
