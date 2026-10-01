// Pretui — ContextMenu: right-click, on the shared menu engine.
//
// ── This is not a fork of Menu ───────────────────────────────────────────
//
// `menu.gts` owns the `MenuNode` taxonomy, the `MenuEntry[]` → renderable
// transform (`buildMenuLevel`), the panel markup and its entire stylesheet
// (`MenuPanel`), the platform shortcut faces, the safe triangle, the roving
// tabindex and the type-ahead buffer. `Menubar` was built by taking exactly
// those pieces and adding only its own state machine; this does the same.
// A command object written for `Menu` renders unchanged here, in `Menubar`
// and in `CommandPalette` — which is the property that stops four menu
// surfaces drifting apart on the first HIG detail anyone changes.
//
// What a context menu genuinely does differently, and therefore all this file
// contains:
//
//  * **It is anchored to a POINT, not an element.** `anchorTo` measures a
//    `getBoundingClientRect()`, so the point is materialised as a zero-size
//    fixed-position span and handed over as the anchor. Radix does the same
//    thing with a virtual reference object; a real 0×0 element is the same
//    idea with no extra plumbing, and it flips and shifts near a viewport
//    edge for free because it goes through the identical primitive.
//  * **Its trigger is a region, not a control.** There is nothing to put
//    `aria-haspopup` on and nothing to hand focus back to unless the region
//    itself can hold focus — which is the crux of the keyboard story below.
//  * **Escape and dismissal have no trigger to return to**, so the component
//    remembers what had focus when the menu opened and puts it back.
//
// ── The keyboard path, which is the part implementations skip ────────────
//
// A right-click menu that can only be opened by right-clicking is a set of
// commands that do not exist for anyone using a keyboard. The platform key is
// **Shift+F10** (and the dedicated **Menu** key on keyboards that have one),
// and browsers do fire a `contextmenu` event for both — but only on an element
// that can hold focus, which an arbitrary `<div>` cannot. So:
//
//  1. The region takes a tab stop by default (`@focusable`, opt-out), which is
//     what makes it reachable and what makes the platform keys fire at all.
//  2. Shift+F10 and `ContextMenu` are ALSO handled explicitly, because the
//     browsers disagree about the coordinates they report — a key press has no
//     pointer position, and anchoring the menu at (0, 0) is the usual symptom.
//     Here it anchors at the region's own box, which is where the reader is.
//  3. Dismissal returns focus to the region, so the tab order continues from
//     the thing the menu was about rather than from the top of the document.
//
// ── Touch ────────────────────────────────────────────────────────────────
//
// Long-press opens it, on a one-shot `OwnedTimers` handle that any movement,
// lift or cancel clears. Radix ships the same 700ms; this uses 500ms, which is
// the platform long-press threshold on both mobile OSes.
//
// Realm laws observed: every `setTimeout` belongs to an `OwnedTimers` set an
// `ember-modifier` adopts and releases, and no timer re-arms itself; element
// references are plain untracked fields written from modifier bodies, never
// `@tracked`.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as menu.gts / menubar.gts)
import { modifier } from 'ember-modifier';
import type { PopupPlacement } from '../internal/overlay';
import { MenuPanel } from './menu-panel';
import { buildMenuLevel, detectShortcutPlatform } from '../internal/menu';
import type { LeafNode, MenuEntry, MenuLevel, MenuRow, ShortcutPlatform, SubmenuNode } from '../internal/menu';
import {
  OwnedTimers,
  PointerTrack,
  TypeaheadBuffer,
  listen,
  listenDocument,
  listenDocumentCapture,
  ownsTimers,
  rovingTabindex,
  tracksPointer,
  typeaheadIndex,
} from '../focus';
import type { SafeEdge } from '../focus';

/** Where a context menu was asked for, in viewport coordinates. */
export interface MenuPoint {
  x: number;
  y: number;
}

/** True when a keydown is a request for the context menu: Shift+F10, or the
 * dedicated Menu key. Exported as a pure predicate so the keyboard contract is
 * testable without a rendered region. */
export function isContextMenuKey(
  key: string,
  shiftKey: boolean,
  ctrlKey = false,
  metaKey = false,
): boolean {
  if (ctrlKey || metaKey) {
    return false;
  }
  if (key === 'ContextMenu') {
    return true;
  }
  return key === 'F10' && shiftKey;
}

/**
 * Where a keyboard-invoked menu should be anchored.
 *
 * A key press carries no pointer, and the browsers disagree about what they
 * report for one — the usual bug is a menu pinned to the top-left corner of
 * the viewport. The answer that is always right is the box of the thing the
 * reader is on: its start edge, one third down, which reads as "attached to
 * this" without covering the row's own text.
 */
export function keyboardPoint(rect: {
  left: number;
  top: number;
  height: number;
}): MenuPoint {
  return { x: rect.left, y: rect.top + Math.min(rect.height, 24) };
}

export interface ContextMenuSignature {
  Args: {
    /** the MenuNode tree, identical to Menu's */
    items: MenuEntry[];
    /** controlled open state; omit for uncontrolled */
    open?: boolean;
    /** the uncontrolled starting state */
    defaultOpen?: boolean;
    /** fires on every transition, controlled or not */
    onOpenChange?: (open: boolean) => void;
    /** fires after any item activates, alongside the node's own onSelect */
    onSelect?: (node: LeafNode) => void;
    /** accessible name for the root panel (default 'Context menu') */
    label?: string;
    /** the region takes a tab stop, so Shift+F10 and the Menu key can reach
     * it (default true). Turning it off makes the menu pointer-only. */
    focusable?: boolean;
    /** seconds of long-press before a touch opens it (default 0.5) */
    longPressDelay?: number;
    /** ms of hover before a submenu opens (default 110) */
    hoverDelay?: number;
    /** ms the safe triangle keeps deferring a sibling's hover (default 300) */
    safeDelay?: number;
    /** force the shortcut platform (docs pages use it) */
    platform?: ShortcutPlatform;
  };
  Blocks: {
    /** the right-clickable region */
    default: [open: boolean];
  };
  Element: HTMLDivElement;
}

export class ContextMenu extends Component<ContextMenuSignature> {
  private guid = guidFor(this);
  private timers = new OwnedTimers();
  private track = new PointerTrack();
  private typeahead = new TypeaheadBuffer(this.timers);
  private elements = new Map<string, HTMLElement>();
  private hoverHandle: ReturnType<typeof setTimeout> | undefined;
  private pressHandle: ReturnType<typeof setTimeout> | undefined;
  private lastDeferStamp = -1;
  /** Untracked on purpose: written from modifier bodies, read from another
   * modifier's arguments. A tracked property read and written in one
   * computation is a backtracking re-render. */
  private regionEl: HTMLElement | undefined;
  private pointEl: HTMLElement | undefined;
  private restoreTo: HTMLElement | undefined;

  @tracked private internalOpen = this.args.defaultOpen ?? false;
  @tracked private x = 0;
  @tracked private y = 0;
  @tracked private openPath: string[] = [];
  @tracked private focusKey: string | undefined;
  @tracked private navigating = false;
  @tracked private altHeld = false;

  get isOpen(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get platform(): ShortcutPlatform {
    return this.args.platform ?? detectShortcutPlatform();
  }
  get rootLabel(): string {
    return this.args.label ?? 'Context menu';
  }
  get focusable(): boolean {
    return this.args.focusable ?? true;
  }
  private get hoverDelay(): number {
    return this.args.hoverDelay ?? 110;
  }
  private get safeDelay(): number {
    return this.args.safeDelay ?? 300;
  }
  private get longPressMs(): number {
    return Math.max(0, (this.args.longPressDelay ?? 0.5) * 1000);
  }

  /** The virtual anchor's position. Two clamped numbers, nothing else. */
  get pointStyle() {
    let x = Math.max(0, Math.round(this.x));
    let y = Math.max(0, Math.round(this.y));
    return htmlSafe('left: ' + x + 'px; top: ' + y + 'px');
  }

  // ── Level construction (identical rules to Menu, by construction) ──────

  private buildLevel(
    entries: MenuEntry[],
    depth: number,
    prefix: string,
    label: string,
    parentKey?: string,
  ): MenuLevel {
    return buildMenuLevel(entries, {
      depth,
      prefix,
      label,
      parentKey,
      guid: this.guid,
      altHeld: this.altHeld,
      platform: this.platform,
    });
  }

  get levels(): MenuLevel[] {
    if (!this.isOpen) {
      return [];
    }
    let out: MenuLevel[] = [
      this.buildLevel(this.args.items ?? [], 0, 'r', this.rootLabel),
    ];
    for (let depth = 0; depth < this.openPath.length; depth++) {
      let parentKey = this.openPath[depth];
      let parent = out[depth]?.rows.find((row) => row.key === parentKey);
      if (!parent || !parent.hasSubmenu) {
        break;
      }
      let node = parent.node as SubmenuNode;
      out.push(
        this.buildLevel(
          node.items ?? [],
          depth + 1,
          parentKey,
          parent.label,
          parentKey,
        ),
      );
    }
    return out;
  }

  private get focusLevel(): MenuLevel | undefined {
    let levels = this.levels;
    if (!levels.length) {
      return undefined;
    }
    let current = this.focusKey;
    if (current) {
      let hit = levels.find((level) =>
        level.rows.some((row) => row.key === current),
      );
      if (hit) {
        return hit;
      }
    }
    return levels[levels.length - 1];
  }

  get rovingKey(): string | undefined {
    let level = this.focusLevel;
    if (!level) {
      return undefined;
    }
    let current = this.focusKey;
    if (current && level.rows.some((row) => row.key === current)) {
      return current;
    }
    return level.rows[0]?.key;
  }

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

  itemFor = (key: string | undefined): HTMLElement | undefined =>
    key ? this.elements.get(key) : undefined;

  // ── Open / close ──────────────────────────────────────────────────────

  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  /** Opens at a point. `focusFirst` is true only on the keyboard path, where
   * the APG asks for the first item to take focus immediately; a right-click
   * opens with the menu merely displayed, exactly as a platform menu does. */
  private openAt(point: MenuPoint, focusFirst: boolean) {
    let active = document.activeElement;
    this.restoreTo =
      active instanceof HTMLElement ? active : (this.regionEl ?? undefined);
    this.x = point.x;
    this.y = point.y;
    this.openPath = [];
    this.typeahead.reset();
    this.setOpen(true);
    let rows = this.buildLevel(
      this.args.items ?? [],
      0,
      'r',
      this.rootLabel,
    ).rows;
    this.focusKey = focusFirst ? rows[0]?.key : undefined;
    this.navigating = focusFirst;
  }

  close = () => {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    this.openPath = [];
    this.focusKey = undefined;
    this.navigating = false;
    this.altHeld = false;
    this.typeahead.reset();
    this.setOpen(false);
  };

  /** Closes and puts focus back where the menu found it. A context menu has
   * no trigger control, so without this every dismissal drops focus on the
   * body — which is the defect that makes right-click menus a dead end for
   * keyboard readers even in kits that open them correctly. */
  private dismiss = () => {
    let back = this.restoreTo ?? this.regionEl;
    this.restoreTo = undefined;
    this.close();
    if (back && back.isConnected) {
      back.focus();
    }
  };

  // ── Activation ────────────────────────────────────────────────────────

  private openSubmenu(row: MenuRow, focusFirst: boolean) {
    if (!row.hasSubmenu || row.disabled) {
      return;
    }
    this.openPath = [...this.openPath.slice(0, row.depth), row.key];
    if (focusFirst) {
      let child = this.levels[row.depth + 1]?.rows[0];
      if (child) {
        this.focusKey = child.key;
        this.navigating = true;
      }
    }
  }

  private closeLevel() {
    if (this.openPath.length === 0) {
      this.dismiss();
      return;
    }
    let parentKey = this.openPath[this.openPath.length - 1];
    this.openPath = this.openPath.slice(0, -1);
    this.focusKey = parentKey;
    this.navigating = true;
  }

  private activate(row: MenuRow) {
    if (row.disabled) {
      return;
    }
    if (row.hasSubmenu) {
      this.openSubmenu(row, true);
      return;
    }
    let node = row.node;
    if (node.kind === 'toggle') {
      node.onChange?.(node.checked !== true);
    }
    node.onSelect?.();
    this.args.onSelect?.(node);
    this.dismiss();
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

  private rowFromEvent(event: Event): MenuRow | undefined {
    let target = event.target as HTMLElement | null;
    let el = target?.closest('[data-menu-key]') as HTMLElement | null;
    return this.rowFor(el?.dataset.menuKey);
  }

  // ── Opening gestures ─────────────────────────────────────────────────

  /** The pointer path. `preventDefault` suppresses the browser's own menu —
   * which is the one place a component may legitimately do that, because it
   * is replacing it rather than removing it. */
  onContextMenu = (event: Event) => {
    let ev = event as MouseEvent;
    ev.preventDefault();
    ev.stopPropagation();
    this.timers.cancel(this.pressHandle);
    this.pressHandle = undefined;
    // A keyboard-generated contextmenu reports button -1 and, in some
    // browsers, coordinates of 0. Route it through the keyboard anchor rather
    // than trusting them.
    let keyboardish = ev.button === -1 || (ev.clientX === 0 && ev.clientY === 0);
    if (keyboardish) {
      this.openFromRegion();
      return;
    }
    this.openAt({ x: ev.clientX, y: ev.clientY }, false);
  };

  private openFromRegion() {
    let region = this.regionEl;
    let rect = region?.getBoundingClientRect();
    this.openAt(
      rect ? keyboardPoint(rect) : { x: 0, y: 0 },
      // keyboard invocation focuses the first item, per the APG
      true,
    );
  }

  /** Shift+F10 and the Menu key, handled explicitly — see the header note on
   * why the browser's own `contextmenu` for these is not enough. */
  onRegionKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (this.isOpen) {
      return;
    }
    if (!isContextMenuKey(ev.key, ev.shiftKey, ev.ctrlKey, ev.metaKey)) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.openFromRegion();
  };

  /** Long-press. One-shot: any movement, lift or cancel clears the handle,
   * and nothing re-arms it. */
  onRegionPointerDown = (event: Event) => {
    let ev = event as PointerEvent;
    if (ev.pointerType === 'mouse' || this.isOpen) {
      return;
    }
    this.timers.cancel(this.pressHandle);
    let point = { x: ev.clientX, y: ev.clientY };
    this.pressHandle = this.timers.after(this.longPressMs, () => {
      this.pressHandle = undefined;
      this.openAt(point, false);
    });
  };

  onRegionPointerCancel = () => {
    this.timers.cancel(this.pressHandle);
    this.pressHandle = undefined;
  };

  // ── Pointer inside the panels ─────────────────────────────────────────

  private considerHover(row: MenuRow) {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    let openAtDepth = this.openPath[row.depth];
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
    this.openPath = this.openPath.slice(0, row.depth);
    if (row.hasSubmenu && !row.disabled) {
      this.hoverHandle = this.timers.after(this.hoverDelay, () =>
        this.openSubmenu(row, false),
      );
    }
  }

  onPointerOver = (event: Event) => {
    let row = this.rowFromEvent(event);
    if (!row || row.key === this.focusKey) {
      return;
    }
    this.considerHover(row);
  };

  onClick = (event: Event) => {
    let row = this.rowFromEvent(event);
    if (row) {
      this.activate(row);
    }
  };

  onDocumentPointerDown = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    if (target && this.hostEl?.contains(target)) {
      return;
    }
    this.close();
  };

  /** A right-click OUTSIDE an open menu must move the menu to the new point
   * rather than leaving a stale one behind — the behaviour every desktop has
   * and most web implementations miss. */
  onDocumentContextMenu = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    if (target && this.regionEl?.contains(target)) {
      return;
    }
    this.close();
  };

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

  onEscapeCapture = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (!this.isOpen) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeLevel();
      return;
    }
    // a right-click leaves focus where it was, so the first arrow has to be
    // routed into the menu from wherever focus is
    if (this.navigating) {
      return;
    }
    let rows = this.levels[0]?.rows ?? [];
    let target =
      ev.key === 'ArrowDown' || ev.key === 'Home'
        ? rows[0]
        : ev.key === 'ArrowUp' || ev.key === 'End'
          ? rows[rows.length - 1]
          : undefined;
    if (!target) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.moveTo(target);
  };

  // ── Keyboard inside the panels ───────────────────────────────────────

  private moveTo(row: MenuRow | undefined) {
    if (!row) {
      return;
    }
    this.navigating = true;
    this.focusKey = row.key;
    this.openPath = this.openPath.slice(0, row.depth);
  }

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (!this.isOpen) {
      return;
    }
    let level = this.focusLevel;
    if (!level) {
      return;
    }
    let rows = level.rows;
    let index = rows.findIndex((row) => row.key === this.rovingKey);
    let row = rows[index];
    let key = ev.key;

    if (key === 'Escape') {
      return;
    }
    if (key === 'Tab') {
      // Tab dismisses and moves on. Focus goes back to the region first, so
      // the browser's own tab order continues from the thing the menu was
      // about — the APG rule, applied to a region instead of a trigger.
      this.dismiss();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || rows.length === 0) {
      return;
    }
    if (key === 'ArrowDown') {
      ev.preventDefault();
      this.moveTo(rows[(index + 1 + rows.length) % rows.length]);
    } else if (key === 'ArrowUp') {
      ev.preventDefault();
      this.moveTo(rows[(index - 1 + rows.length) % rows.length]);
    } else if (key === 'Home') {
      ev.preventDefault();
      this.moveTo(rows[0]);
    } else if (key === 'End') {
      ev.preventDefault();
      this.moveTo(rows[rows.length - 1]);
    } else if (key === 'ArrowRight') {
      if (row?.hasSubmenu && !row.disabled) {
        ev.preventDefault();
        this.openSubmenu(row, true);
      }
    } else if (key === 'ArrowLeft') {
      if (level.depth > 0) {
        ev.preventDefault();
        this.closeLevel();
      }
    } else if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      if (row) {
        this.activate(row);
      }
    } else if (!ev.altKey && key.length === 1 && /\S/.test(key)) {
      let prefix = this.typeahead.push(key);
      let hit = typeaheadIndex(
        rows.map((candidate) => candidate.label),
        prefix,
        index < 0 ? 0 : index,
        this.typeahead.isCycling,
      );
      if (hit >= 0) {
        ev.preventDefault();
        this.moveTo(rows[hit]);
      }
    }
  };

  // ── Element wiring ───────────────────────────────────────────────────

  private hostEl: HTMLElement | undefined;

  captureHost = modifier((el: HTMLElement) => {
    this.hostEl = el;
    return () => {
      this.hostEl = undefined;
    };
  });

  captureRegion = modifier((el: HTMLElement) => {
    this.regionEl = el;
    return () => {
      this.regionEl = undefined;
    };
  });

  capturePoint = modifier((el: HTMLElement) => {
    this.pointEl = el;
    return () => {
      this.pointEl = undefined;
    };
  });

  anchorFor = (depth: number): HTMLElement | undefined =>
    depth === 0 ? this.pointEl : this.elements.get(this.openPath[depth - 1]);

  placementFor = (depth: number): PopupPlacement =>
    depth === 0 ? 'bottom-start' : 'right-start';

  distanceFor = (depth: number): number => (depth === 0 ? 0 : 2);

  <template>
    <div
      class='pretui-cm'
      data-test-pretui-contextmenu
      data-state={{if this.isOpen 'open' 'closed'}}
      {{this.captureHost}}
      {{ownsTimers this.timers}}
      {{listen 'click' this.onClick}}
      {{listen 'keydown' this.onKeydown}}
      {{listen 'pointerover' this.onPointerOver}}
      ...attributes
    >
      <div
        class='pretui-cm-region'
        data-test-pretui-contextmenu-region
        {{this.captureRegion}}
        {{rovingTabindex this.focusable}}
        {{listen 'contextmenu' this.onContextMenu}}
        {{listen 'keydown' this.onRegionKeydown}}
        {{listen 'pointerdown' this.onRegionPointerDown}}
        {{listen 'pointerup' this.onRegionPointerCancel}}
        {{listen 'pointermove' this.onRegionPointerCancel}}
        {{listen 'pointercancel' this.onRegionPointerCancel}}
      >
        {{yield this.isOpen}}
      </div>

      {{!-- The virtual anchor: a zero-size fixed box at the invocation point,
            measured by the same anchorTo every other Pretui overlay uses, so
            flip and shift near a viewport edge come for free.

            It is rendered ALWAYS, not only while open, and that is load
            bearing: pointEl is an untracked field written from a modifier
            body, so it has to be captured in an earlier render pass than the
            panel that reads it. Rendering it beside the panels would make the
            first open measure against undefined. It costs one empty,
            pointer-transparent, zero-size span.
            (No backticks in template text: the lint pass stops seeing the
            whole template past twelve of them.) --}}
      <span
        class='pretui-cm-point'
        aria-hidden='true'
        style={{this.pointStyle}}
        {{this.capturePoint}}
      ></span>

      {{#if this.isOpen}}
        <span
          class='pretui-cm-watch'
          {{tracksPointer this.track}}
          {{listenDocumentCapture 'keydown' this.onEscapeCapture}}
          {{listenDocument 'pointerdown' this.onDocumentPointerDown true}}
          {{listenDocument 'contextmenu' this.onDocumentContextMenu true}}
          {{listenDocument 'keydown' this.onAltDown false}}
          {{listenDocument 'keyup' this.onAltUp false}}
        ></span>

        {{#each this.levels key='depth' as |level|}}
          <MenuPanel
            @level={{level}}
            @anchor={{this.anchorFor level.depth}}
            @placement={{this.placementFor level.depth}}
            @distance={{this.distanceFor level.depth}}
            @rovingKey={{this.rovingKey}}
            @navigating={{this.navigating}}
            @openKeys={{this.openPath}}
            @onItemElement={{this.onItemElement}}
            @parentItem={{this.itemFor level.parentKey}}
            @onEdge={{this.onEdge}}
          />
        {{/each}}
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-cm {
          display: contents;
        }
        .pretui-cm-region {
          display: block;
          border-radius: var(--radius-surface, 10px);
        }
        .pretui-cm-region:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-cm-point {
          /* The virtual anchor is measured in VIEWPORT coordinates, because
             that is what a contextmenu event reports and what
             getBoundingClientRect returns. Anything but fixed would place it
             against an offset parent the point knows nothing about. Same
             accepted warning overlay.gts carries. */
          position: fixed;
          width: 0;
          height: 0;
          pointer-events: none;
        }
        .pretui-cm-watch {
          display: none;
        }
      }
    </style>
  </template>
}
