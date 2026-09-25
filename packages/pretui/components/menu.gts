// Pretui — Menu: the menu-button dropdown, one MenuNode tree rendered in place.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import {
  OwnedTimers,
  PointerTrack,
  TypeaheadBuffer,
  listen,
  listenDocument,
  listenDocumentCapture,
  ownsTimers,
  tracksPointer,
  typeaheadIndex,
} from '../focus';
import type { PopupPlacement } from '../internal/overlay';
import type { SafeEdge } from '../focus';
import { detectShortcutPlatform, buildMenuLevel } from '../internal/menu';
import type {
  SubmenuNode,
  MenuEntry,
  LeafNode,
  ShortcutPlatform,
  MenuRow,
  MenuLevel,
} from '../internal/menu';
import { MenuPanel } from './menu-panel';

export interface MenuSignature {
  Args: {
    /** the menu's contents. `MenuItemSpec` objects and `'---'` from before
     * the rebuild are valid `MenuEntry` values, unchanged. */
    items: MenuEntry[];
    /** which edge of the trigger the panel aligns to (default 'start') */
    align?: 'start' | 'end';
    /** full placement control; overrides @align */
    placement?: PopupPlacement;
    /** accessible name for the root panel (default 'Menu') */
    label?: string;
    /** controlled open state; omit for uncontrolled */
    open?: boolean;
    /** fires whenever the menu wants to open or close */
    onOpenChange?: (open: boolean) => void;
    /** fires after any item activates, alongside the node's own onSelect */
    onSelect?: (node: LeafNode) => void;
    /** anchor the root panel to something other than the trigger — this is
     * what makes SelectionMenu / a toolbar menu the same component */
    anchorElement?: HTMLElement;
    /** ms of hover before a submenu opens (default 110) */
    hoverDelay?: number;
    /** ms the safe triangle keeps deferring a sibling's hover (default 300) */
    safeDelay?: number;
    /** force the shortcut platform (docs pages use it) */
    platform?: ShortcutPlatform;
  };
  Blocks: {
    /** the control that opens the menu. Receives the open state and a toggle;
     * the component finds the focusable control inside this block and gives
     * it `aria-haspopup`, a live `aria-expanded` and the APG arrow keys
     * itself, so a caller that wires only `{{on 'click' toggle}}` still gets
     * the whole contract. */
    trigger: [open: boolean, toggle: () => void];
  };
  Element: HTMLSpanElement;
}

export class Menu extends Component<MenuSignature> {
  private guid = guidFor(this);
  private timers = new OwnedTimers();
  private track = new PointerTrack();
  private typeahead = new TypeaheadBuffer(this.timers);
  private elements = new Map<string, HTMLElement>();
  private triggerControl: HTMLElement | undefined;
  private hoverHandle: ReturnType<typeof setTimeout> | undefined;
  private lastDeferStamp = -1;

  @tracked private internalOpen = false;
  @tracked private openPath: string[] = [];
  @tracked private focusKey: string | undefined;
  /** true only while the keyboard is driving — focusWhen never fires on a
   * pointer path or a plain re-render */
  @tracked private navigating = false;
  @tracked private altHeld = false;
  // Deliberately NOT @tracked. Both are written from inside a modifier body
  // and read from another modifier's arguments; a tracked property read and
  // written in the same computation is a backtracking re-render, which
  // corrupts Glimmer's renderer for the rest of the page. Untracked is also
  // sufficient: modifier arguments are evaluated at INSTALL time in document
  // order, and the trigger span precedes every panel in this template, so the
  // element is always captured before a panel asks for it.
  private triggerEl: HTMLElement | undefined;
  private hostEl: HTMLElement | undefined;

  get isOpen(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get platform(): ShortcutPlatform {
    return this.args.platform ?? detectShortcutPlatform();
  }
  get rootLabel(): string {
    return this.args.label ?? 'Menu';
  }
  private get hoverDelay(): number {
    return this.args.hoverDelay ?? 110;
  }
  private get safeDelay(): number {
    return this.args.safeDelay ?? 300;
  }

  // ── Level construction ────────────────────────────────────────────────

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

  /** Root plus one level per open submenu, outermost first. */
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

  /** The level the KEYBOARD is in — the one holding the focused row, which is
   * not always the deepest open one. Hovering a submenu parent opens its
   * panel without moving focus off the parent (OS parity), and from there
   * ArrowDown must walk the parent's own siblings, not the submenu. */
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

  /** The single tab stop: the focused row, or its level's first row when the
   * focused one no longer exists (its branch collapsed under it). */
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

  /** Element registry, handed to every `MenuPanel`. A plain Map, deliberately
   * untracked: it is written from inside a modifier body. */
  onItemElement = (key: string, el: HTMLElement | undefined) => {
    if (el) {
      this.elements.set(key, el);
    } else {
      this.elements.delete(key);
    }
  };

  /** Receives the open submenu's near edge from its panel. */
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

  private openMenu(focusLast: boolean) {
    this.openPath = [];
    this.typeahead.reset();
    this.setOpen(true);
    let rows = this.buildLevel(
      this.args.items ?? [],
      0,
      'r',
      this.rootLabel,
    ).rows;
    let target = focusLast ? rows[rows.length - 1] : rows[0];
    this.focusKey = target?.key;
    this.navigating = true;
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

  /** Closes and returns focus where the reader left it (APG). Focus moves
   * before the panel is torn down, so Tab continues from the trigger. */
  private dismiss = () => {
    this.close();
    this.triggerControl?.focus();
  };

  toggle = () => {
    if (this.isOpen) {
      this.dismiss();
    } else {
      this.openMenu(false);
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
    // The aria-disabled contract: visible, focusable, announced — and inert.
    if (row.disabled) {
      return;
    }
    if (row.hasSubmenu) {
      this.openSubmenu(row, true);
      return;
    }
    let node = row.node;
    if (node.kind === 'toggle') {
      // HIG: flipping a checkmark closes the menu, like any other command.
      node.onChange?.(node.checked !== true);
    }
    node.onSelect?.();
    this.args.onSelect?.(node);
    this.dismiss();
  }

  // ── Pointer ───────────────────────────────────────────────────────────

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

  /**
   * Hover, with the Amazon safe triangle in front of it.
   *
   * A submenu opens to the side of its parent row, so reaching its contents
   * means moving diagonally — and that diagonal crosses sibling rows. The
   * naive implementation lets each crossed sibling win its pointer enter,
   * closes the open submenu and opens the wrong one: the submenu flickers
   * away exactly as it is reached for. While the pointer is travelling into
   * the open submenu's near edge this defers the sibling's hover and
   * re-checks after `safeDelay`. A pointer that stops moving stops
   * qualifying, so the sibling always wins in the end.
   *
   * Pointer-only. Arrow keys open and close submenus directly, so if the
   * triangle is disabled or wrong, every action is still reachable.
   */
  private considerHover(row: MenuRow) {
    this.timers.cancel(this.hoverHandle);
    this.hoverHandle = undefined;
    let openAtDepth = this.openPath[row.depth];
    let wouldCloseSubmenu = !!openAtDepth && openAtDepth !== row.key;
    if (
      wouldCloseSubmenu &&
      this.track.travellingToSubmenu &&
      // one deferral per pointer move: a cursor that comes to rest inside the
      // triangle must NOT keep re-arming the grace timer, or the sibling
      // never wins and the timer never stops
      this.track.stamp !== this.lastDeferStamp
    ) {
      this.lastDeferStamp = this.track.stamp;
      this.hoverHandle = this.timers.after(this.safeDelay, () =>
        this.considerHover(row),
      );
      return;
    }
    // Hover moves real focus, not just the highlight — the WAI-ARIA menu
    // pattern says so, and it is what keeps the keyboard alive after a
    // pointer detour: leaving focus on a row that is no longer the tab stop
    // strands it on the body the moment that row is torn down.
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
    // ember-power-select renders its dropdown in a portal at document.body;
    // treat that portal as logically inside, so choosing an option from a
    // Select hosted in a menu does not dismiss the menu underneath it
    let el = target instanceof Element ? target : null;
    if (el?.closest('.ember-basic-dropdown-content')) {
      return;
    }
    this.close();
  };

  /** Option/Alt swaps dynamic items while held. Watched on the document so a
   * modifier press with the pointer outside the panel still registers. */
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

  /**
   * Escape, taken in the capture phase. An open menu owns Escape outright:
   * it closes exactly ONE level and nothing else in the page hears the key.
   * Without capture, a host surface listening on capture would act first and
   * Escape would mean two things at once — the defect the boxel-catalog
   * popover fork documents.
   */
  onEscapeCapture = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.key !== 'Escape' || !this.isOpen) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.closeLevel();
  };

  // ── Keyboard ──────────────────────────────────────────────────────────

  private moveTo(row: MenuRow | undefined) {
    if (!row) {
      return;
    }
    this.navigating = true;
    this.focusKey = row.key;
    // moving within a level closes anything deeper
    this.openPath = this.openPath.slice(0, row.depth);
  }

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    let level = this.focusLevel;
    if (!level) {
      return;
    }
    let rows = level.rows;
    let index = rows.findIndex((row) => row.key === this.rovingKey);
    let row = rows[index];
    let key = ev.key;

    if (key === 'Escape') {
      // handled in the capture phase (onEscapeCapture) so a host that listens
      // for Escape on capture cannot act on it first
      return;
    }
    if (key === 'Tab') {
      // Tab closes the whole menu and moves on. No preventDefault: focus is
      // put back on the trigger first, so the browser's own tab order
      // continues from there — which is what the APG asks for.
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

  // ── Element wiring ────────────────────────────────────────────────────

  captureHost = modifier((el: HTMLElement) => {
    this.hostEl = el;
  });

  /** Records the trigger element and the focusable control inside it. Split
   * from `triggerBehavior` on purpose: this one takes no arguments, so it
   * runs exactly once and never re-enters while the menu opens and closes. */
  captureTrigger = modifier((el: HTMLElement) => {
    this.triggerEl = el;
    this.triggerControl =
      (el.querySelector(
        'button, [role="button"], a[href], input, select, textarea, [tabindex]',
      ) as HTMLElement | null) ?? el;
  });

  /**
   * Gives the caller's trigger the APG menu-button contract without the
   * caller having to know about it: `aria-haspopup='menu'`, a live
   * `aria-expanded`, and ArrowDown/ArrowUp to open (Down lands on the first
   * item, Up on the last). Enter/Space are deliberately NOT handled — every
   * real button already fires `click` on those, and intercepting them would
   * open and immediately re-toggle. Every attribute is restored on teardown,
   * so the caller's element is left exactly as it was found.
   */
  triggerBehavior = modifier((el: HTMLElement, [isOpen]: [boolean]) => {
    let control =
      (el.querySelector(
        'button, [role="button"], a[href], input, select, textarea, [tabindex]',
      ) as HTMLElement | null) ?? el;
    let hadPopup = control.getAttribute('aria-haspopup');
    control.setAttribute('aria-haspopup', 'menu');
    control.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    let onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      event.preventDefault();
      // the wrapper's delegated handler must not see this same event and
      // move the selection a second time
      event.stopPropagation();
      this.openMenu(event.key === 'ArrowUp');
    };
    control.addEventListener('keydown', onKeydown);
    return () => {
      control.removeEventListener('keydown', onKeydown);
      if (hadPopup === null) {
        control.removeAttribute('aria-haspopup');
      } else {
        control.setAttribute('aria-haspopup', hadPopup);
      }
      control.removeAttribute('aria-expanded');
    };
  });

  anchorFor = (depth: number): HTMLElement | undefined =>
    depth === 0
      ? (this.args.anchorElement ?? this.triggerEl)
      : this.elements.get(this.openPath[depth - 1]);

  placementFor = (depth: number): PopupPlacement =>
    depth === 0
      ? (this.args.placement ??
        (this.args.align === 'end' ? 'bottom-end' : 'bottom-start'))
      : 'right-start';

  distanceFor = (depth: number): number => (depth === 0 ? 4 : 2);

  <template>
    <span
      class='pretui-menuwrap'
      data-test-pretui-menu
      {{this.captureHost}}
      {{ownsTimers this.timers}}
      {{listen 'click' this.onClick}}
      {{listen 'keydown' this.onKeydown}}
      {{listen 'pointerover' this.onPointerOver}}
      ...attributes
    >
      <span
        class='pretui-menu-trigger'
        {{this.captureTrigger}}
        {{this.triggerBehavior this.isOpen}}
      >
        {{yield this.isOpen this.toggle to='trigger'}}
      </span>

      {{#if this.isOpen}}
        {{! dismissal, dynamic items and the pointer track live only while the
            menu is open — every listener leaves with the element }}
        <span
          class='pretui-menu-watch'
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
            @rovingKey={{this.rovingKey}}
            @navigating={{this.navigating}}
            @openKeys={{this.openPath}}
            @onItemElement={{this.onItemElement}}
            @parentItem={{this.itemFor level.parentKey}}
            @onEdge={{this.onEdge}}
          />
        {{/each}}
      {{/if}}
    </span>

    <style scoped>
      .pretui-menuwrap {
        position: relative;
        display: inline-flex;
      }
      .pretui-menu-trigger {
        display: inline-flex;
      }
      .pretui-menu-watch {
        display: none;
      }
    </style>
  </template>
}
