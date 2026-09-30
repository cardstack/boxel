// Pretui — Menubar: the application menu bar (File / Edit / View).
//
// ── Why this is not a `Menu` with a horizontal trigger row ───────────────
// `menu.gts` ships the WAI-ARIA **menu button** pattern: one trigger, one
// dropdown, Up/Down between siblings, Right to *enter* a submenu. A menubar
// is a different APG pattern with a different axis and a different focus
// story, and the differences are behavioural rather than visual:
//
//  * **The axis flips.** Left/Right move between top-level items; Down opens.
//  * **One tab stop for the whole bar**, always. A menu button has a trigger
//    that is part of the page's ordinary tab order; a menubar is a composite,
//    so Tab leaves it rather than walking it.
//  * **Left/Right stay live while a menu is open** — they close it, step to
//    the adjacent top-level item and open THAT one, with focus landing back
//    on the bar. This single behaviour is what makes a real application menu
//    bar feel like one, and it has no counterpart in a dropdown.
//  * **Hover is asymmetric.** Before anything is open, hovering a top-level
//    item does nothing at all; once the bar is "active" hovering another item
//    switches to it *immediately*, with no dwell delay. A menubar that opened
//    on hover would fire every time the pointer crossed the top of a window;
//    one that kept a dwell delay after opening would feel broken.
//
// Everything the two patterns AGREE about is shared rather than re-written:
// the `MenuNode` taxonomy, the row model, the panel markup and its whole
// stylesheet (`MenuPanel`), the shortcut faces, the safe triangle, the roving
// tabindex, the owned timers and the type-ahead buffer. A command object
// written for `Menu` renders unchanged in `Menubar` and in `CommandPalette`.
//
// ── Ported, not vendored: accessible-menu 4.4.0 (ISC, Nick Milton) ───────
// `src/menubar.js` + `src/_baseMenu.js` are the specification this follows —
// specifically their keyup state machine and the edge cases inside it (the
// "previous child was open" carry rule on Left/Right, `preview()` vs `open()`
// as two different things, and `hoverType: 'dynamic'`'s `hasOpened` gate,
// which is the hover asymmetry above). The library itself is not usable here:
// it attaches to *existing* DOM and mutates it, which fights Glimmer for
// ownership of every element it touches; and it would be a second menu engine
// beside the one `menu.gts` already is. Taking the state machine as a spec
// costs nothing and keeps one engine.
//
// Deviations from the reference, with reasons, are in `menubarKey` below.
//
// Realm laws observed: no `Date.now()`/`Math.random()`; every `setTimeout`
// belongs to an `OwnedTimers` set an `ember-modifier` adopts and releases, and
// no timer re-arms itself; element references are plain untracked fields
// written from modifier bodies, never `@tracked` (a tracked property read and
// written in one computation is a backtracking re-render).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint can't see
// it here (accepted parse baseline, same as menu.gts / focus.gts)
import { modifier } from 'ember-modifier';
import type { PopupPlacement } from '../internal/overlay';
import { MenuPanel } from './menu-panel';
import { buildMenuLevel, detectShortcutPlatform } from '../internal/menu';
import type { LeafNode, MenuEntry, MenuLevel, MenuRow, ShortcutPlatform, SubmenuNode } from '../internal/menu';
import {
  OwnedTimers,
  PointerTrack,
  TypeaheadBuffer,
  focusWhen,
  listen,
  listenDocument,
  listenDocumentCapture,
  ownsTimers,
  rovingTabindex,
  tracksPointer,
  typeaheadIndex,
} from '../focus';
import type { SafeEdge } from '../focus';

// ── The keyboard state machine, as pure functions ────────────────────────
//
// This is where menubar implementations go wrong, so it is written as data in
// and data out: no DOM, no component, no timers. Given (where focus is, what
// is open, which key) it returns (where focus goes, what is open, what the
// component must do). `menubar.test.gts` drives the whole transition table
// through it, which is both faster and far more searching than clicking a
// rendered bar — and it cannot hang.

/** Where keyboard focus lives. */
export type BarWhere = 'bar' | 'menu';

export interface BarState {
  /** index of the top-level item holding the bar's single tab stop */
  index: number;
  /** index of the top-level item whose menu is displayed, or -1 for none.
   * Note `open` may be set while `where` is still `'bar'`: that is the
   * "preview" state a menu bar spends most of its open life in — the menu is
   * down, focus is still on its title. accessible-menu models it as
   * `preview()` vs `open()`; conflating the two is the usual bug. */
  open: number;
  where: BarWhere;
  /** depth of the focused row: 0 on the bar, 1 in a top-level item's own
   * menu, 2+ inside a nested submenu */
  depth: number;
}

export interface BarContext {
  /** number of top-level items */
  count: number;
  /** whether top-level item `index` opens a menu AND is not disabled */
  hasMenu: (index: number) => boolean;
  /** whether the row focused inside a menu opens a submenu of its own.
   * Consulted only when `where === 'menu'`. */
  rowHasMenu: boolean;
}

export type BarEffect =
  /** the state is the whole answer */
  | 'none'
  /** move focus into item `index`'s menu, first row */
  | 'enterFirst'
  /** ... last row */
  | 'enterLast'
  /** open the focused row's own submenu and focus its first row */
  | 'openRow'
  /** pop one submenu level, focus the parent row */
  | 'closeLevel'
  /** activate the focused row, then close */
  | 'activate'
  /** close everything and let focus leave the bar */
  | 'leave';

export interface BarResult {
  state: BarState;
  /** the component should `preventDefault` */
  handled: boolean;
  effect: BarEffect;
  /** the key belongs to the LEVEL machine (sibling arrows, Home/End inside a
   * panel, type-ahead) rather than to the bar */
  inner: boolean;
}

function ignored(state: BarState): BarResult {
  return { state, handled: false, effect: 'none', inner: false };
}
function inner(state: BarState): BarResult {
  return { state, handled: false, effect: 'none', inner: true };
}

/**
 * Move the bar's focus to `next`, carrying openness.
 *
 * The carry rule IS the menubar: once any menu is displayed, stepping along
 * the bar keeps a menu displayed, so File → Edit → View reads as one
 * continuous surface rather than as three separate openings. When nothing is
 * open, stepping along the bar opens nothing. A landing item with no menu of
 * its own closes whatever was open, exactly as accessible-menu's
 * `closeChildren()` branch does.
 */
export function barCarry(
  state: BarState,
  next: number,
  ctx: BarContext,
): BarState {
  let active = state.open >= 0 || state.where === 'menu';
  return {
    index: next,
    open: active && ctx.hasMenu(next) ? next : -1,
    where: 'bar',
    depth: 0,
  };
}

/**
 * The whole menubar keyboard contract.
 *
 * Deviations from accessible-menu 4.4.0, each deliberate:
 *
 * 1. **Escape inside a NESTED submenu closes one level**, not the whole tree.
 *    The reference calls `rootMenu.closeChildren()` from any depth, which
 *    throws away every level at once. APG's rule is "closes submenu, moves
 *    focus to parent menu item", and one-level-per-Escape is also what
 *    `Menu` already does — so Escape means the same thing everywhere in the
 *    kit. At depth 1 the two agree exactly: the menu closes and focus
 *    returns to its top-level item, staying in the bar.
 * 2. **Type-ahead wraps.** The reference searches forward from the current
 *    item and stops at the end of the list, so typing "f" while on the last
 *    item finds nothing. `typeaheadIndex` wraps and supports a multi-character
 *    buffer, which is the APG behaviour and is already shared with `Menu`,
 *    `Tree` and the palette.
 * 3. **No `requestAnimationFrame` before focusing a submenu's first row.**
 *    The reference defers focus a frame so the panel is visually open first.
 *    Here the panel and the focus target render in the same Glimmer pass, and
 *    an unowned rAF is a realm-law violation besides.
 * 4. **A disabled top-level item has no menu** (`ctx.hasMenu` returns false),
 *    so Down/Enter do nothing on it and the carry rule closes rather than
 *    opens. It stays focusable and announced — `aria-disabled`, never the
 *    `disabled` attribute (Appendix N.5).
 */
export function menubarKey(
  state: BarState,
  key: string,
  ctx: BarContext,
): BarResult {
  let count = ctx.count;
  if (count <= 0) {
    return ignored(state);
  }
  let onBar = state.where === 'bar';

  if (key === 'Tab') {
    // Tab is never preventDefault'ed: the bar closes and the browser's own
    // tab order continues from wherever focus already is.
    return {
      state: { index: state.index, open: -1, where: 'bar', depth: 0 },
      handled: false,
      effect: 'leave',
      inner: false,
    };
  }

  if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'Home' || key === 'End') {
    if (onBar) {
      let next =
        key === 'ArrowRight'
          ? (state.index + 1) % count
          : key === 'ArrowLeft'
            ? (state.index - 1 + count) % count
            : key === 'Home'
              ? 0
              : count - 1;
      return {
        state: barCarry(state, next, ctx),
        handled: true,
        effect: 'none',
        inner: false,
      };
    }
    // Inside a menu, Home/End belong to the level, not to the bar.
    if (key === 'Home' || key === 'End') {
      return inner(state);
    }
    if (key === 'ArrowRight') {
      if (ctx.rowHasMenu) {
        return {
          state: { ...state, depth: state.depth + 1 },
          handled: true,
          effect: 'openRow',
          inner: false,
        };
      }
      // A leaf: Right leaves the menu tree entirely, steps to the next
      // top-level item and opens it — with focus back on the bar.
      return {
        state: barCarry(state, (state.index + 1) % count, ctx),
        handled: true,
        effect: 'none',
        inner: false,
      };
    }
    // ArrowLeft
    if (state.depth > 1) {
      // A nested level closes just itself; the bar does not move.
      return {
        state: { ...state, depth: state.depth - 1 },
        handled: true,
        effect: 'closeLevel',
        inner: false,
      };
    }
    return {
      state: barCarry(state, (state.index - 1 + count) % count, ctx),
      handled: true,
      effect: 'none',
      inner: false,
    };
  }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (!onBar) {
      // sibling movement within the open level
      return inner(state);
    }
    if (!ctx.hasMenu(state.index)) {
      return ignored(state);
    }
    return {
      state: { index: state.index, open: state.index, where: 'menu', depth: 1 },
      handled: true,
      // Down lands on the first item, Up on the last — the one place the two
      // vertical arrows do different things rather than mirroring.
      effect: key === 'ArrowDown' ? 'enterFirst' : 'enterLast',
      inner: false,
    };
  }

  if (key === 'Enter' || key === ' ') {
    if (onBar) {
      if (ctx.hasMenu(state.index)) {
        return {
          state: {
            index: state.index,
            open: state.index,
            where: 'menu',
            depth: 1,
          },
          handled: true,
          effect: 'enterFirst',
          inner: false,
        };
      }
      return { state, handled: true, effect: 'activate', inner: false };
    }
    if (ctx.rowHasMenu) {
      return {
        state: { ...state, depth: state.depth + 1 },
        handled: true,
        effect: 'openRow',
        inner: false,
      };
    }
    return {
      state: { index: state.index, open: -1, where: 'bar', depth: 0 },
      handled: true,
      effect: 'activate',
      inner: false,
    };
  }

  if (key === 'Escape') {
    if (onBar) {
      if (state.open < 0) {
        // Nothing is open: Escape is not the bar's to take, so a host surface
        // that listens for it still hears it.
        return ignored(state);
      }
      return {
        state: { ...state, open: -1 },
        handled: true,
        effect: 'none',
        inner: false,
      };
    }
    if (state.depth > 1) {
      return {
        state: { ...state, depth: state.depth - 1 },
        handled: true,
        effect: 'closeLevel',
        inner: false,
      };
    }
    return {
      state: { index: state.index, open: -1, where: 'bar', depth: 0 },
      handled: true,
      effect: 'none',
      inner: false,
    };
  }

  // Everything else — letters included — is the caller's type-ahead.
  return ignored(state);
}

// ── The component ────────────────────────────────────────────────────────

export interface MenubarSignature {
  Args: {
    /** the bar's contents. Exactly `Menu`'s arg type: a `SubmenuNode` becomes
     * a File/Edit/View menu, a `CommandNode` becomes a bare command in the
     * bar (a "Help" that acts on click). Sections and `'---'` carry no
     * meaning at the top level of a bar and contribute no items. */
    items: MenuEntry[];
    /** accessible name for the bar (default 'Main menu'). A page with more
     * than one menubar needs these to differ. */
    label?: string;
    /** fires after any item activates, alongside the node's own onSelect */
    onSelect?: (node: LeafNode) => void;
    /** ms of hover before a NESTED submenu opens (default 110). Top-level
     * switching is never delayed — see `hoverBar`. */
    hoverDelay?: number;
    /** ms the safe triangle keeps deferring a sibling's hover (default 300) */
    safeDelay?: number;
    /** force the shortcut platform (docs pages use it) */
    platform?: ShortcutPlatform;
  };
  Element: HTMLElement;
}

export class Menubar extends Component<MenubarSignature> {
  private guid = guidFor(this);
  private timers = new OwnedTimers();
  private track = new PointerTrack();
  private typeahead = new TypeaheadBuffer(this.timers);
  private elements = new Map<string, HTMLElement>();
  private barElements = new Map<number, HTMLElement>();
  private hoverHandle: ReturnType<typeof setTimeout> | undefined;
  private lastDeferStamp = -1;
  /** the level the type-ahead buffer belongs to; changing level resets it */
  private lastTypeLevel = -1;
  /**
   * True from the moment a menu first opens until the bar closes completely.
   * The gate for the hover asymmetry: an inactive bar ignores hover entirely,
   * an active one switches on it instantly. Deliberately NOT `@tracked` — it
   * is read only from event handlers and never renders anything, and
   * accessible-menu's `hasOpened` plays the same role.
   */
  private barActive = false;
  // Untracked for the reason menu.gts documents: written from inside a
  // modifier body and read from another modifier's arguments. A tracked
  // property read and written in one computation is a backtracking
  // re-render, which corrupts the renderer for the rest of the page.
  private hostEl: HTMLElement | undefined;

  @tracked private index = 0;
  /** top-level index whose menu is displayed, or -1 */
  @tracked private openIndex = -1;
  /** keys of rows INSIDE the open menu whose own submenus are open */
  @tracked private openPath: string[] = [];
  /** the focused row's key, or undefined when focus is on the bar itself */
  @tracked private focusKey: string | undefined;
  /** true only while the keyboard or a hover is driving — `focusWhen` never
   * steals focus on a plain re-render */
  @tracked private navigating = false;
  @tracked private altHeld = false;

  get platform(): ShortcutPlatform {
    return this.args.platform ?? detectShortcutPlatform();
  }
  get barLabel(): string {
    return this.args.label ?? 'Main menu';
  }
  get isOpen(): boolean {
    return this.openIndex >= 0;
  }
  private get hoverDelay(): number {
    return this.args.hoverDelay ?? 110;
  }
  private get safeDelay(): number {
    return this.args.safeDelay ?? 300;
  }

  // ── Levels ────────────────────────────────────────────────────────────

  /** The bar itself, built by the SAME transform the panels use — so a
   * top-level item gets the ellipsis convention, the platform shortcut face,
   * the disabled rule and the icon lookup for free, and cannot drift from the
   * rows below it. */
  get topRows(): MenuRow[] {
    return buildMenuLevel(this.args.items ?? [], {
      depth: 0,
      prefix: 'b',
      label: this.barLabel,
      guid: this.guid,
      altHeld: this.altHeld,
      platform: this.platform,
    }).rows;
  }

  /** The open menu, plus one level per open nested submenu. `levels[i].depth`
   * is `i + 1`: depth 0 is the bar. */
  get levels(): MenuLevel[] {
    let top = this.topRows[this.openIndex];
    if (this.openIndex < 0 || !top || !top.hasSubmenu) {
      return [];
    }
    let out: MenuLevel[] = [
      buildMenuLevel((top.node as SubmenuNode).items ?? [], {
        depth: 1,
        prefix: 'm' + this.openIndex,
        label: top.label,
        guid: this.guid,
        altHeld: this.altHeld,
        platform: this.platform,
      }),
    ];
    for (let i = 0; i < this.openPath.length; i++) {
      let parentKey = this.openPath[i];
      let parent = out[i]?.rows.find((row) => row.key === parentKey);
      if (!parent || !parent.hasSubmenu) {
        break;
      }
      out.push(
        buildMenuLevel((parent.node as SubmenuNode).items ?? [], {
          depth: i + 2,
          prefix: parentKey,
          label: parent.label,
          parentKey,
          guid: this.guid,
          altHeld: this.altHeld,
          platform: this.platform,
        }),
      );
    }
    return out;
  }

  private get focusLevel(): MenuLevel | undefined {
    let key = this.focusKey;
    if (!key) {
      return undefined;
    }
    return this.levels.find((level) =>
      level.rows.some((row) => row.key === key),
    );
  }

  private get focusRow(): MenuRow | undefined {
    return this.rowFor(this.focusKey);
  }

  private rowFor(key: string | undefined): MenuRow | undefined {
    if (!key) {
      return undefined;
    }
    for (let level of this.levels) {
      let hit = level.rows.find((row) => row.key === key);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  // ── Template predicates ───────────────────────────────────────────────

  /** The single tab stop. When focus is inside a panel the focused ROW holds
   * it, so the bar and its menus never present two tab stops at once. */
  barIsTabStop = (i: number): boolean =>
    i === this.index && this.focusKey === undefined;
  barIsFocusTarget = (i: number): boolean =>
    this.navigating && this.focusKey === undefined && i === this.index;
  barIsActive = (i: number): boolean => i === this.index;
  barIsOpen = (i: number): string | undefined => {
    let row = this.topRows[i];
    if (!row?.hasSubmenu) {
      return undefined;
    }
    return this.openIndex === i ? 'true' : 'false';
  };
  barPopup = (i: number): string | undefined =>
    this.topRows[i]?.hasSubmenu ? 'menu' : undefined;

  anchorFor = (depth: number): HTMLElement | undefined =>
    depth <= 1
      ? this.barElements.get(this.openIndex)
      : this.elements.get(this.openPath[depth - 2]);

  placementFor = (depth: number): PopupPlacement =>
    depth <= 1 ? 'bottom-start' : 'right-start';

  distanceFor = (depth: number): number => (depth <= 1 ? 4 : 2);

  itemFor = (key: string | undefined): HTMLElement | undefined =>
    key ? this.elements.get(key) : undefined;

  // ── Element registries (plain Maps; never tracked) ────────────────────

  captureHost = modifier((el: HTMLElement) => {
    this.hostEl = el;
  });

  captureBarItem = modifier((el: HTMLElement, [i]: [number]) => {
    this.barElements.set(i, el);
    return () => {
      if (this.barElements.get(i) === el) {
        this.barElements.delete(i);
      }
    };
  });

  onItemElement = (key: string, el: HTMLElement | undefined) => {
    if (el) {
      this.elements.set(key, el);
    } else {
      this.elements.delete(key);
    }
  };

  onEdge = (edge: SafeEdge | undefined) => {
    this.track.edge = edge;
  };

  // ── Open / close ──────────────────────────────────────────────────────

  private closeAll() {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    this.openIndex = -1;
    this.openPath = [];
    this.focusKey = undefined;
    this.altHeld = false;
    this.barActive = false;
    this.typeahead.reset();
    this.lastTypeLevel = -1;
  }

  private openRowSubmenu(row: MenuRow, focusFirst: boolean) {
    if (!row.hasSubmenu || row.disabled) {
      return;
    }
    // a row at depth d is recorded at openPath[d - 1]
    this.openPath = [...this.openPath.slice(0, row.depth - 1), row.key];
    if (focusFirst) {
      // levels[d] is the level at depth d + 1 — the row's own submenu
      let child = this.levels[row.depth]?.rows[0];
      if (child) {
        this.focusKey = child.key;
        this.navigating = true;
      }
    }
  }

  private moveTo(row: MenuRow | undefined) {
    if (!row) {
      return;
    }
    this.navigating = true;
    this.focusKey = row.key;
    // moving within a level closes anything deeper
    this.openPath = this.openPath.slice(0, row.depth - 1);
  }

  private activateRow(row: MenuRow) {
    if (row.disabled) {
      return;
    }
    if (row.hasSubmenu) {
      this.openRowSubmenu(row, true);
      return;
    }
    this.fire(row.node);
    this.closeAll();
    // focus returns to the top-level item the command came from
    this.navigating = true;
  }

  private fire(node: LeafNode) {
    if (node.kind === 'toggle') {
      // HIG: flipping a checkmark closes the menu, like any other command.
      node.onChange?.(node.checked !== true);
    }
    node.onSelect?.();
    this.args.onSelect?.(node);
  }

  // ── Applying a machine result ─────────────────────────────────────────

  private get barState(): BarState {
    return {
      index: this.index,
      open: this.openIndex,
      where: this.focusKey === undefined ? 'bar' : 'menu',
      depth: this.focusKey === undefined ? 0 : (this.focusLevel?.depth ?? 1),
    };
  }

  private get ctx(): BarContext {
    let rows = this.topRows;
    let focused = this.focusRow;
    return {
      count: rows.length,
      hasMenu: (i: number) => !!rows[i]?.hasSubmenu && !rows[i]?.disabled,
      rowHasMenu: !!focused?.hasSubmenu && !focused?.disabled,
    };
  }

  private apply(result: BarResult) {
    let s = result.state;
    this.navigating = true;

    if (result.effect === 'leave') {
      this.index = s.index;
      this.closeAll();
      // Tab must not be caught by `focusWhen` on the way out.
      this.navigating = false;
      return;
    }
    if (result.effect === 'activate') {
      let row = this.focusRow;
      let top = this.topRows[s.index];
      this.index = s.index;
      this.closeAll();
      this.navigating = true;
      if (row) {
        if (!row.disabled) {
          this.fire(row.node);
        }
      } else if (top && !top.disabled && !top.hasSubmenu) {
        this.fire(top.node);
      }
      return;
    }
    if (result.effect === 'openRow') {
      let row = this.focusRow;
      if (row) {
        this.openRowSubmenu(row, true);
      }
      return;
    }
    if (result.effect === 'closeLevel') {
      let parentKey = this.openPath[this.openPath.length - 1];
      this.openPath = this.openPath.slice(0, -1);
      this.focusKey = parentKey;
      return;
    }

    // 'none' | 'enterFirst' | 'enterLast'
    this.index = s.index;
    this.openIndex = s.open;
    this.openPath = [];
    this.barActive = s.open >= 0 || s.where === 'menu';
    if (s.where === 'bar') {
      this.focusKey = undefined;
      if (s.open < 0) {
        this.timers.cancel(this.hoverHandle);
        this.hoverHandle = undefined;
        this.typeahead.reset();
      }
    } else {
      let rows = this.levels[0]?.rows ?? [];
      let target =
        result.effect === 'enterLast' ? rows[rows.length - 1] : rows[0];
      this.focusKey = target?.key;
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.key === 'Escape') {
      // owned by onEscapeCapture, so a host listening on capture cannot act
      // on the same key first
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      return;
    }
    let result = menubarKey(this.barState, ev.key, this.ctx);
    if (result.inner) {
      this.innerKey(ev);
      return;
    }
    if (result.handled || result.effect !== 'none') {
      if (result.handled) {
        ev.preventDefault();
      }
      this.apply(result);
      return;
    }
    if (!ev.altKey && ev.key.length === 1 && /\S/.test(ev.key)) {
      this.typeaheadKey(ev);
    }
  };

  /** Sibling movement and Home/End inside an open panel — identical to
   * `Menu`'s, because inside a panel the two patterns agree completely. */
  private innerKey(ev: KeyboardEvent) {
    let level = this.focusLevel;
    let rows = level?.rows ?? [];
    if (!rows.length) {
      return;
    }
    let index = rows.findIndex((row) => row.key === this.focusKey);
    ev.preventDefault();
    if (ev.key === 'ArrowDown') {
      this.moveTo(rows[(index + 1 + rows.length) % rows.length]);
    } else if (ev.key === 'ArrowUp') {
      this.moveTo(rows[(index - 1 + rows.length) % rows.length]);
    } else if (ev.key === 'Home') {
      this.moveTo(rows[0]);
    } else if (ev.key === 'End') {
      this.moveTo(rows[rows.length - 1]);
    }
  }

  /** Type-ahead at every level, with the buffer reset when the level changes:
   * "pr" typed in File's menu must not still be in the buffer when the reader
   * arrives in Edit's. */
  private typeaheadKey(ev: KeyboardEvent) {
    let level = this.focusLevel;
    let levelId = this.focusKey === undefined ? 0 : (level?.depth ?? 0);
    if (levelId !== this.lastTypeLevel) {
      this.typeahead.reset();
      this.lastTypeLevel = levelId;
    }
    let prefix = this.typeahead.push(ev.key);
    if (this.focusKey === undefined) {
      let rows = this.topRows;
      if (!rows.length) {
        return;
      }
      let hit = typeaheadIndex(
        rows.map((row) => row.label),
        prefix,
        this.index,
        this.typeahead.isCycling,
      );
      if (hit >= 0) {
        ev.preventDefault();
        this.apply({
          state: barCarry(this.barState, hit, this.ctx),
          handled: true,
          effect: 'none',
          inner: false,
        });
      }
      return;
    }
    let rows = level?.rows ?? [];
    if (!rows.length) {
      return;
    }
    let index = rows.findIndex((row) => row.key === this.focusKey);
    let hit = typeaheadIndex(
      rows.map((row) => row.label),
      prefix,
      index < 0 ? 0 : index,
      this.typeahead.isCycling,
    );
    if (hit >= 0) {
      ev.preventDefault();
      this.moveTo(rows[hit]);
    }
  }

  /**
   * Escape, taken in the capture phase: an open bar owns the key outright and
   * nothing else in the page sees it. Without capture, a host surface that
   * listens for Escape on capture acts first and Escape means two things at
   * once — the defect the boxel-catalog popover fork documents.
   */
  onEscapeCapture = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.key !== 'Escape' || !this.isOpen) {
      return;
    }
    let result = menubarKey(this.barState, 'Escape', this.ctx);
    if (!result.handled) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.apply(result);
  };

  // ── Pointer ───────────────────────────────────────────────────────────

  private barIndexFromEvent(event: Event): number | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-bar-index]') as HTMLElement | null;
    if (!el) {
      return undefined;
    }
    let raw = Number(el.dataset.barIndex);
    return Number.isInteger(raw) ? raw : undefined;
  }

  private rowFromEvent(event: Event): MenuRow | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-menu-key]') as HTMLElement | null;
    return this.rowFor(el?.dataset.menuKey);
  }

  /**
   * **The hover asymmetry.** Before the bar is active, hovering a top-level
   * item does nothing — a menu bar that opened on hover would fire every time
   * the pointer crossed the top of the window. Once a menu is open the reader
   * has already declared intent, so switching is *immediate*: no dwell delay,
   * no hover-intent timer. Both halves are the pattern; shipping only one is
   * the usual mistake (accessible-menu's `hoverType: 'dynamic'` gated on
   * `hasOpened` is the same rule).
   *
   * Hover moves REAL focus, not just the highlight, as the WAI-ARIA menu
   * pattern says — and it must here, because switching top-level items tears
   * down the panel any focused row lived in.
   */
  private hoverBar(i: number) {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    if (!this.barActive) {
      return;
    }
    if (i === this.index && this.focusKey === undefined) {
      return;
    }
    this.navigating = true;
    this.index = i;
    this.openIndex = this.ctx.hasMenu(i) ? i : -1;
    this.openPath = [];
    this.focusKey = undefined;
    this.typeahead.reset();
    this.lastTypeLevel = -1;
  }

  /**
   * Hover inside a panel, with the Amazon safe triangle in front of it —
   * identical to `Menu`'s, and reusing the same pure geometry. While the
   * pointer travels diagonally toward an open submenu's near edge, a sibling
   * row it happens to cross must not take over the hover; one deferral per
   * pointer move, so a cursor that comes to rest inside the triangle lets the
   * sibling win rather than re-arming a timer forever.
   */
  private considerHover(row: MenuRow) {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    let openAtDepth = this.openPath[row.depth - 1];
    let wouldCloseSubmenu = !!openAtDepth && openAtDepth !== row.key;
    if (
      wouldCloseSubmenu &&
      this.track.travellingToSubmenu &&
      this.track.stamp !== this.lastDeferStamp
    ) {
      this.lastDeferStamp = this.track.stamp;
      this.hoverHandle = this.timers.after(this.safeDelay, () =>
        this.considerHover(row),
      );
      return;
    }
    this.navigating = true;
    this.focusKey = row.key;
    this.openPath = this.openPath.slice(0, row.depth - 1);
    if (row.hasSubmenu && !row.disabled) {
      this.hoverHandle = this.timers.after(this.hoverDelay, () =>
        this.openRowSubmenu(row, false),
      );
    }
  }

  onPointerOver = (event: Event) => {
    let barIndex = this.barIndexFromEvent(event);
    if (barIndex !== undefined) {
      this.hoverBar(barIndex);
      return;
    }
    let row = this.rowFromEvent(event);
    if (!row || row.key === this.focusKey) {
      return;
    }
    this.considerHover(row);
  };

  onClick = (event: Event) => {
    let barIndex = this.barIndexFromEvent(event);
    if (barIndex !== undefined) {
      this.clickBar(barIndex);
      return;
    }
    let row = this.rowFromEvent(event);
    if (row) {
      this.activateRow(row);
    }
  };

  private clickBar(i: number) {
    let row = this.topRows[i];
    if (!row) {
      return;
    }
    this.navigating = true;
    this.index = i;
    if (row.disabled) {
      return;
    }
    if (!row.hasSubmenu) {
      this.closeAll();
      this.navigating = true;
      this.fire(row.node);
      return;
    }
    if (this.openIndex === i) {
      // clicking the open title closes it, as every real menu bar does
      this.closeAll();
      this.navigating = true;
      return;
    }
    this.openIndex = i;
    this.openPath = [];
    this.focusKey = undefined;
    this.barActive = true;
    this.typeahead.reset();
    this.lastTypeLevel = -1;
  }

  onDocumentPointerDown = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    if (target && this.hostEl?.contains(target)) {
      return;
    }
    // ember-power-select renders its dropdown in a portal at document.body;
    // treat that portal as logically inside, so choosing an option from a
    // Select hosted in a menu does not dismiss the bar underneath it
    let el = target instanceof Element ? target : null;
    if (el?.closest('.ember-basic-dropdown-content')) {
      return;
    }
    this.navigating = false;
    this.closeAll();
  };

  /** Option/Alt swaps dynamic items while held, at every level including the
   * bar. Watched on the document so a modifier press with the pointer outside
   * the panels still registers. */
  onAltDown = (event: Event) => {
    if ((event as KeyboardEvent).altKey && !this.altHeld) {
      this.altHeld = true;
    }
  };
  onAltUp = (event: Event) => {
    if (!(event as KeyboardEvent).altKey && this.altHeld) {
      this.altHeld = false;
    }
  };

  <template>
    <div
      class='pretui-menubar-wrap'
      data-test-pretui-menubar
      {{this.captureHost}}
      {{ownsTimers this.timers}}
      {{listen 'click' this.onClick}}
      {{listen 'keydown' this.onKeydown}}
      {{listen 'pointerover' this.onPointerOver}}
      ...attributes
    >
      <menu
        class='pretui-menubar'
        role='menubar'
        aria-label={{this.barLabel}}
        data-test-pretui-menubar-list
      >
        {{#each this.topRows key='key' as |row i|}}
          <li
            class='pretui-menubar-item'
            role='menuitem'
            data-bar-index={{i}}
            data-active={{if (this.barIsActive i) 'true'}}
            data-open={{this.barIsOpen i}}
            aria-disabled={{if row.disabled 'true'}}
            aria-haspopup={{this.barPopup i}}
            aria-expanded={{this.barIsOpen i}}
            aria-keyshortcuts={{row.keyshortcuts}}
            {{rovingTabindex (this.barIsTabStop i)}}
            {{focusWhen (this.barIsFocusTarget i)}}
            {{this.captureBarItem i}}
          >
            {{#if row.icon}}
              <row.icon class='pretui-menubar-icon' role='presentation' />
            {{/if}}
            <span class='pretui-menubar-label'>{{row.label}}</span>
            {{#if row.shortcut}}
              <span
                class='pretui-menubar-kbd'
                aria-hidden='true'
              >{{row.shortcut}}</span>
            {{/if}}
          </li>
        {{/each}}
      </menu>

      {{#if this.isOpen}}
        {{!-- dismissal, dynamic items and the pointer track live only while a
              menu is open — every listener leaves with the element --}}
        <span
          class='pretui-menubar-watch'
          {{tracksPointer this.track}}
          {{listenDocumentCapture 'keydown' this.onEscapeCapture}}
          {{listenDocument 'pointerdown' this.onDocumentPointerDown true}}
          {{listenDocument 'keydown' this.onAltDown false}}
          {{listenDocument 'keyup' this.onAltUp false}}
        ></span>

        {{#each this.levels key='depth' as |level|}}
          <MenuPanel
            @level={{level}}
            @anchor={{this.anchorFor level.depth}}
            @placement={{this.placementFor level.depth}}
            @distance={{this.distanceFor level.depth}}
            @rovingKey={{this.focusKey}}
            @navigating={{this.navigating}}
            @openKeys={{this.openPath}}
            @onItemElement={{this.onItemElement}}
            @parentItem={{this.itemFor level.parentKey}}
            @onEdge={{this.onEdge}}
            data-test-pretui-menubar-panel={{level.depth}}
          />
        {{/each}}
      {{/if}}
    </div>

    <style scoped>
      .pretui-menubar-wrap {
        display: block;
        container-type: inline-size;
      }
      .pretui-menubar-watch {
        display: none;
      }
      .pretui-menubar {
        display: flex;
        align-items: stretch;
        gap: var(--pretui-menubar-gap, 1px);
        margin: 0;
        padding: var(--pretui-menubar-padding, 3px);
        list-style: none;
        background: var(--pretui-menubar-background, var(--card));
        color: var(--foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 12.5px);
        /* The bar is a single line of titles; when the pane is too narrow it
           scrolls rather than wrapping — a wrapped menu bar loses the one
           spatial fact readers rely on, which title sits where. */
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: thin;
      }
      .pretui-menubar-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--pretui-menubar-item-height, 26px);
        padding-block: 3px;
        padding-inline: var(--pretui-menubar-item-padding, 9px);
        border-radius: var(--radius-control, 6px);
        color: inherit;
        cursor: default;
        user-select: none;
        white-space: nowrap;
        /* the title's own colour is the only thing that moves, so the bar is
           still legible in a greyscale screenshot (Law 8) */
        transition: background-color 90ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-menubar-item[aria-disabled='true'] {
        /* dimmed, still focusable, still announced — HIG's "dim, don't
           remove", which the `disabled` attribute cannot express */
        opacity: 0.42;
      }
      .pretui-menubar-item[data-active='true']:not([aria-disabled='true']) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-menubar-item[data-open='true'] {
        background: var(--accent);
        color: var(--accent-foreground);
      }
      .pretui-menubar-item:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }
      .pretui-menubar-label {
        font-weight: 500;
      }
      .pretui-menubar-icon {
        width: 14px;
        height: 14px;
      }
      .pretui-menubar-kbd {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pretui-menubar-item[data-open='true'] .pretui-menubar-kbd {
        color: inherit;
      }

      /* Touch: a 26px title is a miss target on a finger, and a touch reader
         has no hover at all — every title is reachable by tap, which is why
         the bar never depends on hover to open. */
      @media (any-pointer: coarse) {
        .pretui-menubar-item {
          min-height: 44px;
          padding-inline: 12px;
        }
      }
      /* Unnamed container query only — the named forms silently drop every
         following rule in the transpiled stylesheet. */
      @container (max-width: 380px) {
        .pretui-menubar-item {
          padding-inline: 7px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-menubar-item {
          transition: none;
        }
      }
    </style>
  </template>
}
