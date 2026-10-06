// Pretui — Sidebar: a collapsible app rail with a keyboard-reachable handle, a mobile drawer mode and opt-in persisted collapse state.
//
//   Sidebar         shadcn's most-copied layout block
//   SidebarTrigger  the toolbar button that toggles it, wired for readers
//   SidebarGroup    a labelled section of the rail
//   SidebarItem     a nav row that survives the collapse to icon width
//
// ── Realm laws in force ─────────────────────────────────────────────────
// No timers, no `Date.now()`, no `Math.random()`. Every listener and observer
// is owned by an `ember-modifier` that disconnects it. No `!important`, no
// `:deep()`, no `:global()`, no dark branches, unnamed container queries only.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';

import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { listenDocumentCapture } from '../focus';
import { Drawer } from './drawer';
import { Tooltip } from './tooltip';
import { pretuiSize } from '../internal/structure-layout';
import type { SizeAlias } from '../internal/structure-layout';

// ── Placement ────────────────────────────────────────────────────────────

/** Logical placement. `left`/`right` are accepted and mapped, because every
 * React kit spells this physically and an agent will type one of them. */
export type ShellPlacement = 'start' | 'end';
export type ShellPlacementAlias = ShellPlacement | 'left' | 'right';

const PLACEMENTS: Record<string, ShellPlacement> = {
  start: 'start',
  left: 'start',
  end: 'end',
  right: 'end',
};

function shellPlacement(
  raw: string | undefined,
  fallback: ShellPlacement = 'start',
): ShellPlacement {
  let hit = raw === undefined ? undefined : PLACEMENTS[raw];
  return hit ?? fallback;
}


// ── Sidebar ──────────────────────────────────────────────────────────────
//
// Source read: shadcn-ui `ui/sidebar.tsx` (726 lines, 23 exports) and
// `hooks/use-mobile.ts`. Ant `layout/Sider.tsx` for the collapse trigger.
//
// What upstream gets wrong, and what is fixed here. These are not style
// quibbles — three of them make the component unusable without a mouse.
//
//   1. **The rail is deliberately unreachable by keyboard.** shadcn's
//      `SidebarRail` is a real `<button>` carrying `tabIndex={-1}`. Ant's two
//      triggers are worse: a `<div onClick>` and a `<span onClick>` with no
//      role, no tabindex, no key handler and no name, so **an Ant sider cannot
//      be collapsed by keyboard at all**. Here the handle is a `<button>` in
//      the tab order with a real accessible name that states the action.
//   2. **Nothing is announced.** Neither `SidebarTrigger` nor `SidebarRail`
//      sets `aria-expanded`, nothing sets `aria-controls`, and the desktop
//      sidebar has no `role`, no `<nav>`, no landmark and no accessible name.
//      Here the rail is a named `<nav>` landmark and every control that
//      toggles it carries `aria-expanded` + `aria-controls` pointing at it.
//   3. **The cookie is written from inside the setter, unconditionally.**
//      shadcn writes `document.cookie` on every toggle even when the consumer
//      controls `open`, with a hardcoded name, path and max-age, no
//      `SameSite`, no opt-out, and nothing ever reads it back. Persistence
//      here is **opt-in and named**: with no `@persistKey` this component
//      touches no storage at all, and with one it uses `localStorage` — the
//      honest primitive for a UI preference, since a cookie only makes sense
//      when a server reads it and there is no server here.
//   4. **Every dimension is a module constant.** `SIDEBAR_WIDTH`,
//      `SIDEBAR_WIDTH_ICON`, `SIDEBAR_COOKIE_MAX_AGE`,
//      `SIDEBAR_KEYBOARD_SHORTCUT` and `MOBILE_BREAKPOINT` are all
//      module-private with no prop. Here they are args and token knobs.
//   5. **A global `window` keydown listener with no escape hatch**, which
//      fires while you are typing in any field that does not stop
//      propagation, and stacks one listener per provider. Here the shortcut
//      is `@shortcut`/`@shortcutKey`, owned by a modifier that removes it,
//      and it **ignores the key while focus is in a text field** — which is
//      the bug shadcn ships.
//   6. **Mobile is a viewport media query** (`MOBILE_BREAKPOINT = 768`)
//      duplicated between JS and the Tailwind `md:` breakpoint, hydration-
//      unsafe (first paint is always desktop). A card does not know the
//      viewport — it knows its pane. This measures the shell's own inline
//      size with a `ResizeObserver`, so a sidebar in a 400px pane folds
//      whatever the window is doing, and `@mobile` overrides it outright.
//   7. **Physical `left`/`right` throughout** — `side`, `left-0`, `border-r`,
//      `-translate-x-1/2`, and a `rotate-180` on an empty spacer div to flip
//      the transition direction. Everything here is logical, so RTL is a
//      `dir` attribute rather than a re-authoring.
//   8. **No reduced-motion guard** on the 200ms width slide. There is one
//      here, and it lands on the end state.
//   9. **A collapsed rail stays focusable.** Mantine's AppShell navbar is
//      only `translateX`-ed off screen — still in the DOM, still tabbable,
//      still read aloud. Offcanvas collapse here is `visibility: hidden`,
//      which removes it from both the tab order and the accessibility tree.
//  10. **`Math.random()` in `SidebarMenuSkeleton`**, memoized per mount, so
//      server and client markup disagree. Forbidden by realm law here, and
//      not needed — `Skeleton` in `structure.gts` is deterministic.
//
// The mobile mode reuses `Drawer` (overlay.gts) rather than re-solving it:
// `Drawer` rides the native `<dialog>` top layer, so the focus trap, Escape,
// `::backdrop` and stacking are the platform's. shadcn instead renders its
// `Sheet` and then hides the Sheet's own close button with
// `[&>button]:hidden`, which is the tell that the composition was wrong.

export type SidebarCollapsible = 'rail' | 'offcanvas' | 'none';

/**
 * Reads a persisted collapse preference exactly once, on insert.
 *
 * A modifier rather than a constructor read for two reasons: `localStorage`
 * must never be touched during module evaluation or prerender (the indexer
 * runs both), and a modifier body only ever runs against a real DOM. Every
 * access is inside a `try` because storage throws outright in a partitioned
 * or storage-disabled context, and a failed preference must never take a
 * layout down.
 */
const restoresOpen = modifier(
  (
    _el: HTMLElement,
    [key, apply]: [string | undefined, (open: boolean) => void],
  ) => {
    if (!key || typeof localStorage === 'undefined') {
      return;
    }
    try {
      let stored = localStorage.getItem('pretui-sidebar:' + key);
      if (stored === 'open' || stored === 'closed') {
        apply(stored === 'open');
      }
    } catch {
      // Storage unavailable. The `@defaultOpen` value stands.
    }
  },
);

/**
 * Publishes the shell's own inline size as a coarse `wide | narrow` fact.
 *
 * `ResizeObserver`, never a viewport media query: a card does not know the
 * window, it knows its pane. The callback fires after layout, outside render,
 * so writing tracked state here cannot backtrack.
 */
const measuresPane = modifier(
  (
    element: HTMLElement,
    [breakpoint, apply]: [number, (narrow: boolean) => void],
  ) => {
    let observer = new ResizeObserver((entries) => {
      let entry = entries[0];
      if (!entry) {
        return;
      }
      // A width of 0 is not "narrow", it is "not laid out" — a shell inside a
      // `display: none` tab panel, a collapsed accordion, or a card that has
      // not been measured yet. Treating it as narrow would silently promote
      // the rail to a modal drawer the moment the pane was hidden, and the
      // reader would find it in the top layer when the tab came back.
      let width = entry.contentRect.width;
      apply(width > 0 && width < breakpoint);
    });
    // The observer reports once as soon as observation starts, and does so
    // asynchronously — a synchronous first report here would write tracked
    // state during the render that installed this modifier.
    observer.observe(element);
    return () => observer.disconnect();
  },
);

/** Text-entry contexts where a bare letter shortcut must not fire. shadcn
 * binds the shortcut on `window` with no such check, so Cmd+B inside a rich
 * text editor toggles the sidebar instead of bolding. */
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]';

export interface SidebarSignature {
  Args: {
    /** Controlled expanded state. Leave undefined for the uncontrolled half. */
    open?: boolean;
    /** Uncontrolled initial state. Default `true`. */
    defaultOpen?: boolean;
    /** Fires on every toggle, controlled or not. */
    onOpenChange?: (open: boolean) => void;
    /**
     * Persist the collapse preference under this key. **Opt-in**: with no key
     * this component reads and writes no storage whatsoever. The key is
     * namespaced to `pretui-sidebar:<key>` in `localStorage`.
     */
    persistKey?: string;
    /** Accessible name for the rail landmark. Default `Sidebar`. */
    label?: string;
    /** `start` (default) or `end`; `left`/`right` are accepted aliases. */
    placement?: ShellPlacementAlias;
    /**
     * What collapsing means. `rail` (default) shrinks to icon width and keeps
     * the rail reachable; `offcanvas` removes it from layout, the tab order
     * and the accessibility tree; `none` pins it open and hides the handle.
     */
    collapsible?: SidebarCollapsible;
    /** Expanded rail width. Any kit-valid CSS length. Default `16rem`. */
    width?: string;
    /** Collapsed rail width in `rail` mode. Default `3.25rem`. */
    railWidth?: string;
    /** Rail width in the mobile drawer. Default `18rem`. */
    mobileWidth?: string;
    /** Bind a Cmd/Ctrl shortcut for the toggle. Default `true`. */
    shortcut?: boolean;
    /** The shortcut's letter. Default `b`. Matched case-insensitively. */
    shortcutKey?: string;
    /** Force the drawer mode on or off, bypassing the pane measurement. */
    mobile?: boolean;
    /** Pane width in px below which the rail becomes a drawer. Default `640`. */
    mobileBreakpoint?: number;
    /** Draw the hairline between rail and content. Default `false`. */
    bordered?: boolean;
  };
  Blocks: {
    /** Rail chrome above the scrolling nav — a brand, a workspace switcher. */
    header: [{ open: boolean; collapsed: boolean; mobile: boolean }];
    /** The rail's scrolling body. */
    nav: [
      {
        open: boolean;
        collapsed: boolean;
        mobile: boolean;
        toggle: () => void;
      },
    ];
    /** Rail chrome below the nav — an account row, a version line. */
    footer: [{ open: boolean; collapsed: boolean; mobile: boolean }];
    /** The page beside the rail. Yielded the toggle and the rail's id. */
    default: [
      {
        open: boolean;
        collapsed: boolean;
        mobile: boolean;
        toggle: () => void;
        controls: string;
      },
    ];
  };
  Element: HTMLDivElement;
}

/**
 * App chrome: a collapsible rail beside a page.
 *
 * ```hbs
 * <Sidebar @label='Workspace' @persistKey='studio' @collapsible='rail'>
 *   <:header as |bar|><Brand @compact={{bar.collapsed}} /></:header>
 *   <:nav as |bar|>
 *     <SidebarGroup @label='Library'>
 *       <SidebarItem @label='Lots' @active={{true}} @collapsed={{bar.collapsed}} />
 *     </SidebarGroup>
 *   </:nav>
 *   <:default as |bar|>
 *     <Toolbar>
 *       <SidebarTrigger
 *         @open={{bar.open}}
 *         @onToggle={{bar.toggle}}
 *         @controls={{bar.controls}}
 *       />
 *     </Toolbar>
 *   </:default>
 * </Sidebar>
 * ```
 *
 * State is passed DOWN through block params rather than sideways through a
 * context/service. React needs `useSidebar()` because a trigger can be
 * arbitrarily deep; Glimmer's named blocks already put the caller inside the
 * component's scope, so a yielded hash is the whole mechanism — no provider to
 * forget, no `useSidebar must be used within a SidebarProvider` throw, and the
 * dependency is visible in the template.
 */
export class Sidebar extends Component<SidebarSignature> {
  @tracked private internal = this.args.defaultOpen ?? true;
  @tracked private narrowPane = false;
  /** The drawer's own uncontrolled state, separate from the rail's expanded
   * state, so a narrow pane starts with the modal closed. */
  @tracked private drawerOpen = false;
  railId = `${guidFor(this)}-rail`;

  get open(): boolean {
    if (this.args.open !== undefined) {
      return this.args.open;
    }
    if (this.mobile) {
      return this.drawerOpen;
    }
    // a pinned rail is open, whatever a shortcut or trigger asked for
    return this.collapsible === 'none' ? true : this.internal;
  }
  get collapsible(): SidebarCollapsible {
    return this.args.collapsible ?? 'rail';
  }
  get placement(): ShellPlacement {
    return shellPlacement(this.args.placement);
  }
  get label(): string {
    return this.args.label ?? 'Sidebar';
  }
  get mobile(): boolean {
    return this.args.mobile ?? this.narrowPane;
  }
  /** Collapsed means "not showing its full width", which the drawer never is
   * — inside the drawer the rail is always at full width. */
  get collapsed(): boolean {
    return !this.mobile && !this.open && this.collapsible !== 'none';
  }
  get state(): string {
    return this.open ? 'expanded' : 'collapsed';
  }
  get showHandle(): boolean {
    return !this.mobile && this.collapsible !== 'none';
  }
  get handleLabel(): string {
    return this.open ? 'Collapse ' + this.label : 'Expand ' + this.label;
  }
  get mobileBreakpoint(): number {
    return this.args.mobileBreakpoint ?? 640;
  }
  get shortcutKey(): string {
    return (this.args.shortcutKey ?? 'b').toLowerCase();
  }
  get shortcutEnabled(): boolean {
    return (this.args.shortcut ?? true) && !this.args.mobile;
  }
  get style() {
    return cssStyleFrom([
      cssDeclaration('--pretui-sidebar-width', this.args.width),
      cssDeclaration('--pretui-sidebar-rail-width', this.args.railWidth),
      cssDeclaration('--pretui-drawer-size', this.args.mobileWidth),
    ]);
  }

  private setOpen = (next: boolean) => {
    // Internal state moves only while UNcontrolled; the callback always fires.
    if (this.args.open === undefined && this.mobile) {
      this.drawerOpen = next;
      this.args.onOpenChange?.(next);
      return;
    }
    if (this.args.open === undefined) {
      this.internal = next;
    }
    this.args.onOpenChange?.(next);
    this.persist(next);
  };

  /**
   * Opt-in, and never on the path of a component that was given no key.
   * Wrapped because storage throws in partitioned contexts — a preference
   * that cannot be saved is not a reason for a layout to fail.
   */
  private persist(next: boolean) {
    let key = this.args.persistKey;
    if (!key || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem('pretui-sidebar:' + key, next ? 'open' : 'closed');
    } catch {
      // Preference not persisted. Nothing else changes.
    }
  }

  toggle = () => {
    this.setOpen(!this.open);
  };
  closeDrawer = () => {
    this.setOpen(false);
  };
  /** Restore runs only while UNcontrolled — a controlled parent owns the
   * value and a stored preference must not fight it. */
  restore = (stored: boolean) => {
    if (this.args.open === undefined) {
      this.internal = stored;
    }
  };
  setNarrow = (narrow: boolean) => {
    if (narrow !== this.narrowPane) {
      this.drawerOpen = false;
    }
    this.narrowPane = narrow;
  };

  /** The shell element, so the shortcut can tell which sidebar owns focus. */
  private rootEl: HTMLElement | null = null;
  captureRoot = modifier((el: HTMLElement) => {
    this.rootEl = el;
    return () => {
      this.rootEl = null;
    };
  });

  onShortcut = (event: Event) => {
    if (!this.shortcutEnabled || (this.collapsible === 'none' && !this.mobile)) {
      return;
    }
    let key = event as KeyboardEvent;
    if (!key.metaKey && !key.ctrlKey) {
      return;
    }
    // A real browser reports `b` with Caps off and `B` with Shift or Caps on,
    // and `triggerKeyEvent` only accepts the uppercase form — so both cases
    // are matched rather than one.
    if (key.key.toLowerCase() !== this.shortcutKey) {
      return;
    }
    let target = key.target as HTMLElement | null;
    if (target && target.closest && target.closest(TEXT_ENTRY)) {
      return;
    }
    // Every sidebar with @shortcut listens, but one press toggles one rail:
    // the innermost sidebar that holds focus, or, with focus in none, the
    // first to see the key (the rest see it already taken).
    let owner = (document.activeElement as HTMLElement | null)?.closest?.('.pretui-sidebar-shell') ?? null;
    if (owner ? owner !== this.rootEl : key.defaultPrevented) {
      return;
    }
    key.preventDefault();
    this.toggle();
  };

  <template>
    <div
      class='pretui-sidebar-shell'
      style={{this.style}}
      data-placement={{this.placement}}
      data-state={{this.state}}
      data-collapsible={{this.collapsible}}
      data-mobile={{if this.mobile 'true' 'false'}}
      data-bordered={{if @bordered 'true' 'false'}}
      data-test-pretui-sidebar
      {{restoresOpen @persistKey this.restore}}
      {{measuresPane this.mobileBreakpoint this.setNarrow}}
      {{!-- A document listener, not an `on 'keydown'` modifier on this div —
            realm lint's no-invalid-interactive rejects a template listener on
            a non-widget element, and the shortcut has to work while focus is
            anywhere on the page anyway. Capture phase and non-passive so it
            may preventDefault; owned by this element, so it is removed with
            the component. Each mounted sidebar has its own listener, and
            onShortcut routes one press to one of them. --}}
      {{listenDocumentCapture 'keydown' this.onShortcut}}
      {{this.captureRoot}}
      ...attributes
    >
      {{#if this.mobile}}
        <Drawer
          @open={{this.open}}
          @onClose={{this.closeDrawer}}
          @label={{this.label}}
          @placement={{this.placement}}
        >
          <:default>
            <nav
              id={{this.railId}}
              class='pretui-sidebar-rail'
              aria-label={{this.label}}
              data-mobile='true'
              data-test-pretui-sidebar-rail
            >
              {{#if (has-block 'header')}}
                <div class='pretui-sidebar-head'>{{yield
                    (hash open=this.open collapsed=false mobile=true)
                    to='header'
                  }}</div>
              {{/if}}
              <div class='pretui-sidebar-body'>
                {{yield
                  (hash
                    open=this.open
                    collapsed=false
                    mobile=true
                    toggle=this.toggle
                  )
                  to='nav'
                }}
              </div>
              {{#if (has-block 'footer')}}
                <div class='pretui-sidebar-foot'>{{yield
                    (hash open=this.open collapsed=false mobile=true)
                    to='footer'
                  }}</div>
              {{/if}}
            </nav>
          </:default>
        </Drawer>
      {{else}}
        <nav
          id={{this.railId}}
          class='pretui-sidebar-rail'
          aria-label={{this.label}}
          data-state={{this.state}}
          data-mobile='false'
          data-test-pretui-sidebar-rail
        >
          {{#if (has-block 'header')}}
            <div class='pretui-sidebar-head'>{{yield
                (hash
                  open=this.open collapsed=this.collapsed mobile=false
                )
                to='header'
              }}</div>
          {{/if}}
          <div class='pretui-sidebar-body'>
            {{yield
              (hash
                open=this.open
                collapsed=this.collapsed
                mobile=false
                toggle=this.toggle
              )
              to='nav'
            }}
          </div>
          {{#if (has-block 'footer')}}
            <div class='pretui-sidebar-foot'>{{yield
                (hash
                  open=this.open collapsed=this.collapsed mobile=false
                )
                to='footer'
              }}</div>
          {{/if}}
        </nav>

        {{#if this.showHandle}}
          {{! A REAL tab stop. shadcn's rail is a <button tabIndex={-1}> and
              Ant's is a <div onClick> — in both, the rail's own affordance is
              mouse-only. The name states the action rather than the object,
              so a reader hears what pressing it will do. }}
          <button
            type='button'
            class='pretui-sidebar-handle'
            aria-label={{this.handleLabel}}
            aria-expanded={{if this.open 'true' 'false'}}
            aria-controls={{this.railId}}
            data-test-pretui-sidebar-handle
            {{on 'click' this.toggle}}
          ><span class='pretui-sidebar-handle-line' aria-hidden='true'></span>
          </button>
        {{/if}}
      {{/if}}

      <div class='pretui-sidebar-content'>
        {{yield
          (hash
            open=this.open
            collapsed=this.collapsed
            mobile=this.mobile
            toggle=this.toggle
            controls=this.railId
          )
        }}
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        /* One grid, not a viewport-pinned panel plus an in-flow ghost spacer.
           shadcn needs the ghost because its rail is pinned to the VIEWPORT and
           therefore out of flow; inside a card that is simply wrong, and a grid
           track animates exactly the same way with one element instead of
           three. (The phrase this comment is avoiding trips the kit's own
           no-css-position-fixed lint rule, which scans comment text too.) */
        .pretui-sidebar-shell {
          --pretui-sidebar-width: 16rem;
          --pretui-sidebar-rail-width: 3.25rem;
          display: grid;
          grid-template-columns: var(--pretui-sidebar-track) minmax(0, 1fr);
          --pretui-sidebar-track: var(--pretui-sidebar-width);
          min-inline-size: 0;
          min-block-size: 0;
          inline-size: 100%;
          block-size: 100%;
          position: relative;
          container-type: inline-size;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
          transition: grid-template-columns var(--pretui-dur-morph, 300ms)
            var(--pretui-ease-morph, cubic-bezier(0.3, 0.7, 0.2, 1.02));
        }
        /* Logical: `end` swaps the tracks and moves the rail to column 2. In RTL
           the whole thing mirrors with no second stylesheet — the `rotate-180`
           on an empty spacer that shadcn uses to fake this has no analogue
           because there is nothing to fake. */
        .pretui-sidebar-shell[data-placement='end'] {
          grid-template-columns: minmax(0, 1fr) var(--pretui-sidebar-track);
        }
        .pretui-sidebar-shell[data-placement='end'] .pretui-sidebar-rail {
          grid-column: 2;
          grid-row: 1;
        }
        .pretui-sidebar-shell[data-placement='end'] .pretui-sidebar-content {
          grid-column: 1;
          grid-row: 1;
        }
        .pretui-sidebar-shell[data-state='collapsed'][data-collapsible='rail'] {
          --pretui-sidebar-track: var(--pretui-sidebar-rail-width);
        }
        .pretui-sidebar-shell[data-state='collapsed'][data-collapsible='offcanvas'] {
          --pretui-sidebar-track: 0px;
        }
        /* In the drawer mode the rail is in the top layer, so the grid is one
           column and the content takes all of it. */
        .pretui-sidebar-shell[data-mobile='true'] {
          --pretui-sidebar-track: 0px;
          grid-template-columns: minmax(0, 1fr);
        }
        .pretui-sidebar-rail {
          grid-column: 1;
          grid-row: 1;
          display: flex;
          flex-direction: column;
          min-inline-size: 0;
          min-block-size: 0;
          overflow: hidden;
          background: var(--pretui-sidebar-bg, var(--inset, var(--boxel-100)));
        }
        .pretui-sidebar-shell[data-bordered='true'] .pretui-sidebar-rail {
          box-shadow: inset -1px 0 0 var(--border);
        }
        .pretui-sidebar-shell[data-bordered='true'][data-placement='end']
          .pretui-sidebar-rail {
          box-shadow: inset 1px 0 0 var(--border);
        }
        /* An offcanvas rail leaves the tab order and the accessibility tree.
           Mantine's AppShell only translates its navbar off screen, so a
           "hidden" navbar is still tabbable and still read aloud. */
        .pretui-sidebar-shell[data-state='collapsed'][data-collapsible='offcanvas']
          .pretui-sidebar-rail {
          visibility: hidden;
        }
        /* The drawer's own rail is not a grid child — it lives inside a
           <dialog> in the top layer. */
        .pretui-sidebar-rail[data-mobile='true'] {
          display: flex;
          block-size: 100%;
          background: none;
          box-shadow: none;
        }
        .pretui-sidebar-head,
        .pretui-sidebar-foot {
          flex: none;
          min-inline-size: 0;
          padding: var(--space-3, 8px);
        }
        .pretui-sidebar-foot {
          box-shadow: 0 -1px 0 var(--border);
        }
        .pretui-sidebar-head {
          box-shadow: 0 1px 0 var(--border);
        }
        .pretui-sidebar-body {
          flex: 1 1 auto;
          min-block-size: 0;
          min-inline-size: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          padding: var(--space-3, 8px);
          display: grid;
          gap: var(--space-3, 8px);
          align-content: start;
        }
        .pretui-sidebar-content {
          grid-column: 2;
          grid-row: 1;
          min-inline-size: 0;
          min-block-size: 0;
        }
        .pretui-sidebar-shell[data-mobile='true'] .pretui-sidebar-content {
          grid-column: 1;
        }
        /* The handle straddles the seam. 44px of hit area on a coarse pointer
           , a 2px painted line, and a resize-style cursor so the
           affordance reads before it is pressed. */
        .pretui-sidebar-handle {
          position: absolute;
          inset-block: 0;
          inset-inline-start: calc(var(--pretui-sidebar-track) - 0.5rem);
          inline-size: 1rem;
          z-index: var(--pretui-z-raised, 1);
          display: grid;
          place-items: center;
          padding: 0;
          border: 0;
          background: none;
          cursor: ew-resize;
          transition: inset-inline-start var(--pretui-dur-morph, 300ms)
            var(--pretui-ease-morph, cubic-bezier(0.3, 0.7, 0.2, 1.02));
        }
        .pretui-sidebar-shell[data-placement='end'] .pretui-sidebar-handle {
          inset-inline-start: auto;
          inset-inline-end: calc(var(--pretui-sidebar-track) - 0.5rem);
        }
        .pretui-sidebar-handle-line {
          inline-size: 2px;
          block-size: 100%;
          border-radius: 2px;
          background: transparent;
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-sidebar-handle:hover .pretui-sidebar-handle-line {
          background: var(--primary);
        }
        .pretui-sidebar-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          border-radius: var(--radius-chip, 6px);
        }
        /* Coarse pointers get a real target rather than a 16px sliver. */
        @media (any-pointer: coarse) {
          .pretui-sidebar-handle {
            inline-size: 44px;
            inset-inline-start: calc(var(--pretui-sidebar-track) - 22px);
          }
          .pretui-sidebar-shell[data-placement='end'] .pretui-sidebar-handle {
            inset-inline-end: calc(var(--pretui-sidebar-track) - 22px);
          }
        }
        /* Reduced motion lands on the end state: the rail is at its width, the
           handle is at the seam, nothing is mid-slide. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-sidebar-shell,
          .pretui-sidebar-handle,
          .pretui-sidebar-handle-line {
            transition: none;
          }
        }
      }
    </style>
  </template>
}

// ── SidebarTrigger ───────────────────────────────────────────────────────

export interface SidebarTriggerSignature {
  Args: {
    /** The rail's current state, from the yielded hash. */
    open: boolean;
    /** The rail's toggle, from the yielded hash. */
    onToggle: () => void;
    /** The rail's element id, from the yielded hash. */
    controls: string;
    /** What the rail is called, so the name says which one. Default `sidebar`. */
    label?: string;
    size?: SizeAlias;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement;
}

/**
 * The toolbar button that toggles a `Sidebar`.
 *
 * shadcn's `SidebarTrigger` reads its state from React context and still emits
 * neither `aria-expanded` nor `aria-controls`, so a reader hears "Toggle
 * Sidebar" with no state and no relationship. Here the three facts it needs
 * come from the yielded hash and all three reach the DOM.
 */
export class SidebarTrigger extends Component<SidebarTriggerSignature> {
  get size() {
    return pretuiSize(this.args.size);
  }
  get label(): string {
    let noun = this.args.label ?? 'sidebar';
    return (this.args.open ? 'Collapse ' : 'Expand ') + noun;
  }
  <template>
    <button
      type='button'
      class='pretui-sidebar-trigger'
      data-size={{this.size}}
      aria-label={{this.label}}
      aria-expanded={{if @open 'true' 'false'}}
      aria-controls={{@controls}}
      data-test-pretui-sidebar-trigger
      {{on 'click' @onToggle}}
    >
      {{#if (has-block)}}
        {{yield}}
      {{else}}
        <span class='pretui-sidebar-trigger-glyph' aria-hidden='true'></span>
      {{/if}}
    </button>
    <style scoped>
      @layer PretComponent {
        .pretui-sidebar-trigger {
          display: inline-grid;
          place-items: center;
          inline-size: 2.24em;
          block-size: 2.24em;
          padding: 0;
          border: 0;
          border-radius: var(--radius-chip, 6px);
          background: none;
          color: var(--muted-foreground);
          font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
          cursor: pointer;
        }
        .pretui-sidebar-trigger[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
        }
        .pretui-sidebar-trigger[data-size='s'] {
          font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
        }
        .pretui-sidebar-trigger[data-size='l'] {
          font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
        }
        .pretui-sidebar-trigger[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
        }
        .pretui-sidebar-trigger:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-sidebar-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* Three bars with the first one short — a rail glyph, drawn rather than
           imported, so the component has no icon dependency. */
        .pretui-sidebar-trigger-glyph {
          inline-size: 1em;
          block-size: 0.75em;
          border-inline-start: 0.28em solid currentColor;
          border-inline-end: 1.5px solid currentColor;
          border-block: 1.5px solid currentColor;
          border-radius: 2px;
        }
      }
    </style>
  </template>
}

// ── SidebarGroup ─────────────────────────────────────────────────────────

export interface SidebarGroupSignature {
  Args: {
    /** Section heading. Also the group's accessible name. */
    label?: string;
    /** Hide the heading visually but keep it as the accessible name. */
    hideLabel?: boolean;
  };
  Blocks: { default: []; action: [] };
  Element: HTMLDivElement;
}

/**
 * A labelled section of the rail.
 *
 * shadcn's `SidebarGroupLabel` collapses by moving itself off screen with
 * `-mt-8 opacity-0`, which leaves the label in the accessibility tree while it
 * is visually gone — a reader hears a heading for a section it cannot see.
 * `@hideLabel` here uses the kit's `sr-only` treatment, which is the same
 * visual result with the opposite accessibility meaning stated on purpose.
 */
export class SidebarGroup extends Component<SidebarGroupSignature> {
  labelId = `${guidFor(this)}-label`;
  <template>
    <div
      class='pretui-sbgroup'
      role='group'
      aria-labelledby={{if @label this.labelId}}
      data-test-pretui-sidebar-group
      ...attributes
    >
      {{#if @label}}
        <div class='pretui-sbgroup-head'>
          <span
            id={{this.labelId}}
            class='pretui-sbgroup-label'
            data-hidden={{if @hideLabel 'true' 'false'}}
          >{{@label}}</span>
          {{#if (has-block 'action')}}
            <span class='pretui-sbgroup-action'>{{yield to='action'}}</span>
          {{/if}}
        </div>
      {{/if}}
      <div class='pretui-sbgroup-body'>{{yield}}</div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-sbgroup {
          display: grid;
          gap: 2px;
          min-inline-size: 0;
        }
        .pretui-sbgroup-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2, 6px);
          padding: var(--space-2, 6px) var(--space-2, 6px) 2px;
          min-inline-size: 0;
        }
        .pretui-sbgroup-label {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
          min-inline-size: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Visually gone, still the accessible name — the opposite of a label
           parked off screen with opacity, which stays announced but describes
           nothing the reader can find. */
        .pretui-sbgroup-label[data-hidden='true'] {
          position: absolute;
          inline-size: 1px;
          block-size: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-sbgroup-action {
          flex: none;
        }
        .pretui-sbgroup-body {
          display: grid;
          gap: 1px;
          min-inline-size: 0;
        }
      }
    </style>
  </template>
}

// ── SidebarItem ──────────────────────────────────────────────────────────

export interface SidebarItemSignature {
  Args: {
    /** The row's text. Always the accessible name, collapsed or not. */
    label: string;
    /** Navigates rather than acts — renders an `<a>`. */
    href?: string;
    /** Acts rather than navigates — renders a `<button>`. */
    onClick?: () => void;
    /** Marks the current location. Emits `aria-current='page'`. */
    active?: boolean;
    /** A trailing count or status word. */
    badge?: string;
    /**
     * The rail is at icon width. Comes from the `Sidebar` block param — an
     * explicit yield rather than a React context, so the dependency is
     * visible in the template and there is no provider to forget.
     */
    collapsed?: boolean;
    /** Announced and styled as disabled; stays focusable (`aria-disabled`). */
    disabled?: boolean;
  };
  Blocks: {
    /** The leading glyph. Kept visible at icon width. */
    icon: [];
  };
  Element: HTMLElement;
}

/**
 * A nav row that survives the collapse to icon width.
 *
 * Collapsed, the label becomes the row's `aria-label` and a `Tooltip`, so the
 * name never disappears — shadcn's `SidebarMenuButton` only renders a tooltip
 * when you remember to pass `tooltip`, and the visible label is hidden by a
 * `group-data-[collapsible=icon]:hidden` utility on a span, leaving an
 * icon-only control whose accessible name is whatever the icon happens to
 * carry. Here the name is an argument, so it cannot go missing.
 */
export class SidebarItem extends Component<SidebarItemSignature> {
  get isLink(): boolean {
    return this.args.href !== undefined && !this.args.disabled;
  }
  get current(): string | undefined {
    return this.args.active ? 'page' : undefined;
  }
  act = () => {
    if (this.args.disabled) {
      return;
    }
    this.args.onClick?.();
  };
  <template>
    {{#if @collapsed}}
      <Tooltip
        class='pretui-sbitem-tip'
        @content={{@label}}
        @side='right'
        data-test-pretui-sidebar-item-tip
      >
        {{#if this.isLink}}
          <a
            class='pretui-sbitem'
            href={{@href}}
            aria-label={{@label}}
            aria-current={{this.current}}
            data-active={{if @active 'true' 'false'}}
            data-collapsed='true'
            data-test-pretui-sidebar-item
            ...attributes
          >
            <span class='pretui-sbitem-icon'>{{yield to='icon'}}</span>
          </a>
        {{else}}
          <button
            type='button'
            class='pretui-sbitem'
            aria-label={{@label}}
            aria-current={{this.current}}
            aria-disabled={{if @disabled 'true'}}
            data-active={{if @active 'true' 'false'}}
            data-collapsed='true'
            data-test-pretui-sidebar-item
            {{on 'click' this.act}}
            ...attributes
          >
            <span class='pretui-sbitem-icon'>{{yield to='icon'}}</span>
          </button>
        {{/if}}
      </Tooltip>
    {{else if this.isLink}}
      <a
        class='pretui-sbitem'
        href={{@href}}
        aria-current={{this.current}}
        data-active={{if @active 'true' 'false'}}
        data-collapsed='false'
        data-test-pretui-sidebar-item
        ...attributes
      >
        <span class='pretui-sbitem-icon'>{{yield to='icon'}}</span>
        <span class='pretui-sbitem-label'>{{@label}}</span>
        {{#if @badge}}
          <span class='pretui-sbitem-badge'>{{@badge}}</span>
        {{/if}}
      </a>
    {{else}}
      <button
        type='button'
        class='pretui-sbitem'
        aria-current={{this.current}}
        aria-disabled={{if @disabled 'true'}}
        data-active={{if @active 'true' 'false'}}
        data-collapsed='false'
        data-test-pretui-sidebar-item
        {{on 'click' this.act}}
        ...attributes
      >
        <span class='pretui-sbitem-icon'>{{yield to='icon'}}</span>
        <span class='pretui-sbitem-label'>{{@label}}</span>
        {{#if @badge}}
          <span class='pretui-sbitem-badge'>{{@badge}}</span>
        {{/if}}
      </button>
    {{/if}}
    <style scoped>
      /* above Tooltip's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* The Tooltip wrapper is a child component; the scope attribute rides
           `...attributes` to its root, so this rule reaches it with no
           `:deep()`. Verified mechanism, see the file header of
           structure-layout.gts. */
        .pretui-sbitem-tip {
          display: block;
          inline-size: 100%;
        }
        .pretui-sbitem {
          display: flex;
          align-items: center;
          gap: 0.6em;
          inline-size: 100%;
          min-inline-size: 0;
          min-block-size: var(--control-h, 28px);
          padding: 0 0.6em;
          border: 0;
          border-radius: var(--radius-chip, 6px);
          background: none;
          color: var(--muted-foreground);
          font: inherit;
          letter-spacing: inherit;
          text-align: start;
          text-decoration: none;
          cursor: pointer;
          box-sizing: border-box;
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-sbitem[data-collapsed='true'] {
          justify-content: center;
          padding: 0;
        }
        .pretui-sbitem:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-sbitem:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-sbitem:active {
          transform: scale(0.985);
        }
        .pretui-sbitem[data-active='true'] {
          background: var(--pretui-selected, var(--boxel-100));
          color: var(--pretui-primary-ink, var(--primary));
          font-weight: 600;
        }
        .pretui-sbitem[aria-disabled='true'] {
          opacity: 0.45;
          cursor: default;
        }
        .pretui-sbitem[aria-disabled='true']:hover {
          background: none;
        }
        .pretui-sbitem-icon {
          flex: none;
          display: grid;
          place-items: center;
          inline-size: 1.15em;
          block-size: 1.15em;
        }
        .pretui-sbitem-label {
          flex: 1 1 auto;
          min-inline-size: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-sbitem-badge {
          flex: none;
          font-variant-numeric: tabular-nums;
          font-size: 0.9em;
          color: var(--ink-3, var(--boxel-400));
        }
        /* A coarse pointer gets the 44px row the guideline asks for; a fine
           pointer keeps the kit's 28px rhythm. */
        @media (any-pointer: coarse) {
          .pretui-sbitem {
            min-block-size: 44px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-sbitem {
            transition: none;
          }
          .pretui-sbitem:active {
            transform: none;
          }
        }
      }
    </style>
  </template>
}
