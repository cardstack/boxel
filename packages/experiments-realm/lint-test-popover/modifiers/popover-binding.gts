// `surfacePopoverBinding` — element modifier on each hover-target unit
// (grid cell, canvas node, kanban card, calendar event ... whatever the
// host considers "popover-able") that wires the desktop popover gesture
// model to a shared `PopoverState`.
//
// The modifier is host-agnostic; "cell" is just one kind of unit. It
// works the same for any unit the host assigns a `(row, col)` coordinate.
//
// THE CONTRACT
// ============
//
// Read in: a `PopoverState` (one per surface root) + a per-unit
// `PopoverContract` (tells us which popover kinds the unit supports)
// + the unit's `(row, col)` coordinates + optional host hooks
// (`onSelect` for click, `onActivate` for dblclick).
//
// Wire out: pointerenter / pointerleave / click / dblclick on the
// modified element. The modifier translates DOM events into
// `state.scheduleHoverDetails / scheduleDismissDetails / openEdit`
// calls; it doesn't paint, doesn't read tracked state, doesn't draw
// chrome.
//
// WHAT IT DOES NOT DO
// ===================
//
// 1. KEYBOARD. Unit-level keyboard nav lives at the surface root
//    (Enter / F2 / printable char on the focused unit, Esc to
//    clear, arrow keys). The host installs that on its grid / canvas
//    element via `{{on "keydown" handleKeydown}}`. The modifier stays
//    unit-local.
//
// 2. POPOVER-LEVEL HOVER. The `<Popover>` element itself attaches its
//    own `pointerenter` / `pointerleave` via `{{on}}` to call
//    `state.cancelDismiss / scheduleDismissDetails`. Different
//    target element, different handler — kept inline rather than
//    invented as a second modifier.
//
// 3. FOCUS SETTING. The host owns the focus model. The modifier
//    just calls `onSelect(row, col, event)` and lets the host
//    decide what "select" means.
//
// 4. CHROME. Visual treatment of the unit (hover bg, focused
//    border, in-range tint) lives in CSS — the modifier doesn't
//    add classes.
//
// LIFETIME
// ========
//
// One per unit `<div>` / `<td>`. Auto-cleans listeners on teardown
// via the modifier's return cleanup. Per-unit timers are NOT
// installed here — they live on the shared `PopoverState` instance
// and are bounded (200-500ms). Re-runs on arg changes (contract
// changes, row/col shift after sort), which is correct because the
// listeners close over the CURRENT args.

import { modifier } from 'ember-modifier';

import type { PopoverState, PopoverContract } from '../utils/popover-state.ts';

export interface PopoverBindingArgs {
  /** The shared popover-state instance (one per surface root). */
  state: PopoverState;

  /** This unit's contract. Determines which gestures are valid:
   *  - `popover.includes('details')` → hover schedules a peek
   *  - `popover.includes('edit')`    → dblclick opens edit (or calls
   *                                     `onActivate` if provided)
   *  Units whose `popover` is empty get only `onSelect` (click) — no
   *  hover, no dblclick popover. */
  contract: PopoverContract;

  /** Unit coordinates. The modifier passes these to state methods
   *  so the state knows which unit to anchor / open against. */
  row: number;
  col: number;

  /** Click handler. Receives the click event so the host can read
   *  modifiers (shift / cmd) for range extension. Typical use:
   *  `(r, c, e) => focusResource.setFocus(r, c, e.shiftKey)`. The
   *  modifier doesn't do anything with the click on its own —
   *  click is purely the host's "select this unit" gesture. */
  onSelect?: (row: number, col: number, event: MouseEvent) => void;

  /** Edit-open handler. Default: calls `state.openEdit(row, col)`
   *  if the unit's contract lists `'edit'` in `popover[]`. Override
   *  when the host wants to route through a different editor (e.g.,
   *  inline editor for some widgets, popover for others).
   *  Fired on `dblclick`; Enter / F2 keyboard activation goes
   *  through the host's surface-level keydown handler instead. */
  onActivate?: (row: number, col: number) => void;
}

interface ModifierSignature {
  Element: HTMLElement;
  Args: {
    Named: PopoverBindingArgs;
  };
}

const surfacePopoverBinding = modifier<ModifierSignature>(
  (element, _positional, args) => {
    // Snapshot args at this run — modifier re-runs on arg changes,
    // so the listeners always close over the current values.
    const { state, contract, row, col, onSelect, onActivate } = args;
    const supportsDetails = contract.popover.includes('details');
    const supportsEdit = contract.popover.includes('edit');

    const openDetails = (): void => {
      if (!supportsDetails) return;
      state.scheduleHoverDetails(row, col, contract);
    };

    const refreshDetails = (): void => {
      if (!supportsDetails) return;
      if (state.isOpenFor(row, col)) return;
      state.scheduleHoverDetails(row, col, contract);
    };

    const dismissDetails = (): void => {
      // Always cancel pending hover-open and (if details is open)
      // schedule the grace dismiss. The popover's own pointerenter
      // cancels the dismiss if the cursor traveled there.
      state.scheduleDismissDetails();
    };

    const onPointerEnter = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      openDetails();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      refreshDetails();
    };

    const onPointerLeave = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      dismissDetails();
    };

    const onMouseEnter = (): void => {
      openDetails();
    };

    const onMouseMove = (): void => {
      refreshDetails();
    };

    const onMouseLeave = (): void => {
      dismissDetails();
    };

    const onClick = (event: MouseEvent): void => {
      onSelect?.(row, col, event);
    };

    const onDblClick = (event: MouseEvent): void => {
      // `onActivate` (when provided) is the host's universal
      // edit-activation hook — fires for ANY dblclick, regardless
      // of whether the unit supports a popover. Hosts use it to route
      // inline editing alongside popover opening. When `onActivate`
      // is absent, we fall back to the default (open the edit popover
      // if the contract supports it; otherwise no-op).
      if (onActivate) {
        event.stopPropagation();
        onActivate(row, col);
        return;
      }
      if (!supportsEdit) return;
      event.stopPropagation();
      state.openEdit(row, col);
    };

    element.addEventListener('pointerenter', onPointerEnter);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerleave', onPointerLeave);
    element.addEventListener('mouseenter', onMouseEnter);
    element.addEventListener('mousemove', onMouseMove);
    element.addEventListener('mouseleave', onMouseLeave);
    element.addEventListener('click', onClick);
    element.addEventListener('dblclick', onDblClick);

    return () => {
      element.removeEventListener('pointerenter', onPointerEnter);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('mouseenter', onMouseEnter);
      element.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('mouseleave', onMouseLeave);
      element.removeEventListener('click', onClick);
      element.removeEventListener('dblclick', onDblClick);
    };
  },
);

export default surfacePopoverBinding;
