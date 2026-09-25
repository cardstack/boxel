// Pretui — overlay territory (foundation pass, merge-sequence step 3).
// Ported from Web Awesome's overlay layer (MIT, (c) Fonticons), re-cut for
// realm constraints: wa-popup's floating-ui positioning becomes a ~50-line
// measuring modifier (flip + shift + align) that only ever runs while an
// overlay is open — so it never executes during prerender; wa-dialog/
// wa-drawer ride the native <dialog> top layer (focus trap, Escape via
// 'cancel', stacking — no JS dismissible-stack needed); Popover generalizes
// the Select backdrop-close pattern. Entry/exit motion is pure CSS via
// @starting-style (Motion Rule: encodes open state; reduced-motion gets the
// end state).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { listenDocumentCapture } from './focus';
import { emit, firstDefined, resolveSize } from './pretui-primitives';
import type { PretuiSizeArg } from './pretui-primitives';

export type PopupPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end';

const GUTTER = 8;

// ── Placement alias layer (react-ecosystem-gap.md, step 1) ───────────────
// Four kits spell one idea four ways. Radix splits it into `side` + `align`;
// Mantine calls the composite `position`; Vaul/shadcn's Drawer calls it
// `direction`; everyone else writes `placement`. Pretui's canonical arg
// stays `@placement`, and every other spelling resolves into it here.
//
// Logical `start`/`end` are accepted and mapped to physical left/right for
// LTR — the direction the whole kit is travelling. When the popup placement
// enum itself goes logical, only this table changes.
type PlacementArgs = {
  placement?: string;
  side?: string;
  align?: string;
  position?: string;
  direction?: string;
};

const SIDE_ALIASES: Record<string, Side> = {
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  start: 'left',
  end: 'right',
  'inline-start': 'left',
  'inline-end': 'right',
  'block-start': 'top',
  'block-end': 'bottom',
  before: 'left',
  after: 'right',
  up: 'top',
  down: 'bottom',
};
const ALIGN_ALIASES: Record<string, string> = {
  center: '',
  centre: '',
  middle: '',
  start: '-start',
  end: '-end',
  top: '-start',
  bottom: '-end',
  left: '-start',
  right: '-end',
};

/** Split a composite placement without shredding `inline-start`. */
function splitPlacement(p: string): [string, string | undefined] {
  if (SIDE_ALIASES[p]) {
    return [p, undefined];
  }
  let i = p.lastIndexOf('-');
  return i === -1 ? [p, undefined] : [p.slice(0, i), p.slice(i + 1)];
}

export function resolvePlacement(
  args: PlacementArgs,
  fallback: PopupPlacement,
): PopupPlacement {
  let composite = firstDefined(
    args.placement,
    args.position,
    args.direction,
    args.side,
  );
  let [sideToken, alignToken] = composite
    ? splitPlacement(composite)
    : [undefined, undefined];
  let side = SIDE_ALIASES[sideToken ?? ''];
  if (!side) {
    return fallback;
  }
  let align = ALIGN_ALIASES[alignToken ?? args.align ?? 'center'] ?? '';
  return (side + align) as PopupPlacement;
}

/** Drawer's placement is already logical, and has no `top` edge. */
export type DrawerPlacement = 'start' | 'end' | 'bottom';
const DRAWER_PLACEMENTS: Record<string, DrawerPlacement> = {
  start: 'start',
  end: 'end',
  bottom: 'bottom',
  left: 'start',
  right: 'end',
  'inline-start': 'start',
  'inline-end': 'end',
  'block-end': 'bottom',
  down: 'bottom',
};

export function resolveDrawerPlacement(
  args: PlacementArgs,
  fallback: DrawerPlacement = 'end',
): DrawerPlacement {
  let raw = firstDefined(
    args.placement,
    args.position,
    args.direction,
    args.side,
  );
  return (raw ? DRAWER_PLACEMENTS[raw] : undefined) ?? fallback;
}

/** Every spelling of "is this layer showing". */
export type OpenArgs = {
  open?: boolean;
  isOpen?: boolean;
  opened?: boolean;
};
export function resolveOpen(args: OpenArgs): boolean | undefined {
  return firstDefined(args.open, args.isOpen, args.opened);
}

type Side = 'top' | 'bottom' | 'left' | 'right';
const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function positionPopup(
  a: DOMRect,
  w: number,
  h: number,
  placement: PopupPlacement,
  distance: number,
) {
  let [side, align] = placement.split('-') as [Side, string | undefined];
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let space: Record<Side, number> = {
    top: a.top - distance,
    bottom: vh - a.bottom - distance,
    left: a.left - distance,
    right: vw - a.right - distance,
  };
  let need = side === 'top' || side === 'bottom' ? h : w;
  if (space[side] < need && space[OPPOSITE[side]] >= need) {
    side = OPPOSITE[side];
  }
  let top = 0;
  let left = 0;
  if (side === 'top') top = a.top - h - distance;
  if (side === 'bottom') top = a.bottom + distance;
  if (side === 'left') left = a.left - w - distance;
  if (side === 'right') left = a.right + distance;
  if (side === 'top' || side === 'bottom') {
    left =
      align === 'start'
        ? a.left
        : align === 'end'
          ? a.right - w
          : a.left + a.width / 2 - w / 2;
    left = Math.min(Math.max(left, GUTTER), Math.max(vw - w - GUTTER, GUTTER));
  } else {
    top =
      align === 'start'
        ? a.top
        : align === 'end'
          ? a.bottom - h
          : a.top + a.height / 2 - h / 2;
    top = Math.min(Math.max(top, GUTTER), Math.max(vh - h - GUTTER, GUTTER));
  }
  return { top, left };
}

// Positions the popup against its anchor and keeps it placed across scroll/
// resize (listeners live only while the popup is rendered — the modifier's
// cleanup removes them on close). Exported as the kit's shared anchored-
// positioning primitive: the same offset/flip/shift behavior floating-ui's
// middleware provides, measured against the REAL panel box — floating-ui
// itself is not realm-importable, and boxel-ui's Velcro path portals to the
// app root, outside the theme island (Appendix F renderInPlace decision).
export const anchorTo = modifier(
  (
    el: HTMLElement,
    [anchor, placement, distance, matchWidth, scale]: [
      HTMLElement | undefined,
      PopupPlacement,
      number,
      boolean,
      (number | undefined)?,
    ],
  ) => {
    if (!anchor) return;
    let apply = () => {
      // `relativeScale` — a panel anchored inside a zoomable surface
      // (NodeCanvas, Board) has to scale WITH the surface. It is applied as a
      // `transform`, never CSS `zoom`: `zoom` also scales the positional
      // top/left this modifier writes, so a panel at `top: 200px; zoom: .8`
      // paints at 160px and slides off its anchor. `transform` leaves the
      // used position alone, and getBoundingClientRect reports post-transform
      // boxes, so the flip/shift maths below measures the box the reader
      // actually sees. Clamped 0.4–2.5 (the fork's range).
      if (scale !== undefined && scale !== 1) {
        let s = Math.min(2.5, Math.max(0.4, scale));
        el.style.transformOrigin = 'top left';
        el.style.transform = `scale(${s})`;
      }
      if (matchWidth) {
        el.style.minWidth = `${anchor.getBoundingClientRect().width}px`;
      }
      let r = el.getBoundingClientRect();
      let p = positionPopup(
        anchor.getBoundingClientRect(),
        r.width,
        r.height,
        placement,
        distance,
      );
      el.style.top = `${p.top}px`;
      el.style.left = `${p.left}px`;
    };
    apply();
    window.addEventListener('scroll', apply, { capture: true, passive: true });
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('scroll', apply, true);
      window.removeEventListener('resize', apply);
    };
  },
);

export interface PopupSignature {
  Args: OpenArgs &
    PlacementArgs & {
      placement?: PopupPlacement | string;
      distance?: number;
      matchWidth?: boolean;
      /** Scale the floating panel with a zoomable host surface. Applied as a
       * `transform`, clamped 0.4–2.5; 1 (the default) writes no transform. */
      scale?: number;
    };
  Blocks: { anchor: []; default: [] };
  Element: HTMLSpanElement;
}

/**
 * Headless anchored-positioning primitive (wa-popup, trimmed). Renders its
 * anchor inline and, while @open, a fixed-position container placed against
 * it. Fixed positioning is intentional — anchored overlays must escape
 * scroll clipping (lint warns; accepted, same as the Select backdrop).
 */
export class Popup extends Component<PopupSignature> {
  @tracked anchorEl?: HTMLElement;
  captureAnchor = modifier((el: HTMLElement) => {
    this.anchorEl = el;
  });
  get placement(): PopupPlacement {
    return resolvePlacement(this.args, 'bottom-start');
  }
  get open() {
    return resolveOpen(this.args) ?? false;
  }
  get distance() {
    return this.args.distance ?? 6;
  }
  get matchWidth() {
    return this.args.matchWidth ?? false;
  }
  <template>
    <span class='pretui-popup-anchor' {{this.captureAnchor}} ...attributes>
      {{yield to='anchor'}}
      {{#if this.open}}
        <span
          class='pretui-popup'
          {{anchorTo
            this.anchorEl
            this.placement
            this.distance
            this.matchWidth
            @scale
          }}
        >
          {{yield}}
        </span>
      {{/if}}
    </span>
    <style scoped>
      .pretui-popup-anchor {
        display: inline-block;
      }
      .pretui-popup {
        /* anchored overlays must escape scroll clipping; measured on open
           only — never during prerender (lint warns, accepted) */
        position: fixed;
        top: 0;
        left: 0;
        /* kit stacking scale (pretui-css.gts): `overlay` sits above
           `dropdown` because a Popup can CONTAIN a Select or Menu, and a
           containing panel must never paint under its own content.
           Dialog/Drawer are not on the scale in practice — showModal()
           promotes them to the top layer, above every z-index here. */
        z-index: var(--pretui-z-overlay, 70);
        display: block;
      }
    </style>
  </template>
}

// Keeps the native <dialog>'s modal state in sync with the controlled @open
// arg, and owns its 'cancel' (Escape) and 'click' (backdrop) listeners —
// attached here rather than with {{on}} because the lint rule
// no-invalid-interactive rejects template listeners on <dialog>. showModal()
// promotes to the top layer: focus trap, Escape, ::backdrop, and stacking
// all come from the platform.
const modalBehavior = modifier(
  (
    el: HTMLDialogElement,
    [open, onCancel, onClick]: [
      boolean | undefined,
      (e: Event) => void,
      (e: Event) => void,
    ],
  ) => {
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  },
);

/** The three width steps a Dialog paints, and every spelling of them. */
type DialogSize = 's' | 'm' | 'l';
const DIALOG_SIZES: Record<string, DialogSize> = {
  xs: 's',
  s: 's',
  m: 'm',
  l: 'l',
  xl: 'l',
};

export interface DialogSignature {
  Args: OpenArgs & {
    /** Canonical close notify. Optional since 2026-08-13: a caller who only
     * passes `@onOpenChange` (the Radix/shadcn contract, and what an agent
     * will type) used to hit a hard `this.args.onClose is not a function`. */
    onClose?: () => void;
    /** alias — the Radix/shadcn layer notify, called with `false` on close.
     * A layer needs a two-way knob: `@onClose` alone cannot reopen it. */
    onOpenChange?: (open: boolean) => void;
    label?: string;
    /** the `s|m|l` width steps; `sm`/`md`/`lg`/`default` accepted */
    size?: DialogSize | PretuiSizeArg;
    dismissible?: boolean;
  };
  Blocks: { title: []; default: []; footer: [] };
  Element: HTMLDialogElement;
}

export class Dialog extends Component<DialogSignature> {
  get dismissible() {
    return this.args.dismissible ?? true;
  }
  get open() {
    return resolveOpen(this.args);
  }
  get size(): DialogSize {
    return DIALOG_SIZES[resolveSize(this.args.size)] ?? 'm';
  }
  private requestClose() {
    emit([this.args.onClose]);
    emit([this.args.onOpenChange], false);
  }
  onCancel = (e: Event) => {
    // Escape. Keep the element controlled: never let the platform close it
    // out from under the @open arg.
    e.preventDefault();
    if (this.dismissible) {
      this.requestClose();
    }
  };
  onClick = (e: Event) => {
    // The inner wrapper covers the whole dialog, so a click that targets the
    // <dialog> itself landed on the ::backdrop.
    if (this.dismissible && e.target === e.currentTarget) {
      this.requestClose();
    }
  };
  <template>
    <dialog
      class='pretui-dialog'
      data-size={{this.size}}
      aria-label={{@label}}
      data-test-pretui-dialog
      {{modalBehavior this.open this.onCancel this.onClick}}
      ...attributes
    >
      <div class='pretui-dialog-inner'>
        {{#if (has-block 'title')}}
          <header class='pretui-dialog-title'>{{yield to='title'}}</header>
        {{/if}}
        <div class='pretui-dialog-body'>{{yield}}</div>
        {{#if (has-block 'footer')}}
          <footer class='pretui-dialog-footer'>{{yield to='footer'}}</footer>
        {{/if}}
      </div>
    </dialog>
    <style scoped>
      .pretui-dialog {
        border: 0;
        padding: 0;
        background: var(--card);
        color: var(--foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 12px 40px rgb(16 24 40 / 0.18));
        width: min(560px, calc(100vw - 32px));
        max-height: calc(100dvh - 64px);
        font-family: var(--font-sans);
        font-size: var(--text-body, 15px);
      }
      .pretui-dialog[data-size='s'] {
        width: min(400px, calc(100vw - 32px));
      }
      .pretui-dialog[data-size='l'] {
        width: min(760px, calc(100vw - 32px));
      }
      .pretui-dialog::backdrop {
        background: var(--pretui-overlay-scrim, rgb(16 24 40 / 0.4));
      }
      .pretui-dialog[open] {
        opacity: 1;
        transform: none;
        transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-dialog[open] {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
        }
      }
      .pretui-dialog-inner {
        display: grid;
        gap: var(--space-4, 11px);
        padding: var(--space-6, 19px);
      }
      .pretui-dialog-title {
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
      }
      .pretui-dialog-body {
        color: var(--muted-foreground);
        line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
      }
      .pretui-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3, 8px);
        border-top: 1px solid var(--border);
        padding-top: var(--space-4, 11px);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-dialog[open] {
          transition: none;
        }
      }
    </style>
  </template>
}

// An agent asking for a "Sheet" means THIS component (shadcn's Sheet is a
// slide-over; Pretui's Sheet is a spreadsheet grid). Vaul and shadcn spell
// the edge `direction='right'`, Mantine `position='right'`, Radix `side`;
// all three land on the logical `@placement` here — `right` → `end`.
export interface DrawerSignature {
  Args: OpenArgs &
    PlacementArgs & {
      /** Canonical close notify — optional, see Dialog. */
      onClose?: () => void;
      /** alias — the Radix/shadcn layer notify, called with `false` */
      onOpenChange?: (open: boolean) => void;
      label?: string;
      placement?: DrawerPlacement | string;
      dismissible?: boolean;
    };
  Blocks: { title: []; default: []; footer: [] };
  Element: HTMLDialogElement;
}

export class Drawer extends Component<DrawerSignature> {
  get dismissible() {
    return this.args.dismissible ?? true;
  }
  get open() {
    return resolveOpen(this.args);
  }
  get placement(): DrawerPlacement {
    return resolveDrawerPlacement(this.args);
  }
  private requestClose() {
    emit([this.args.onClose]);
    emit([this.args.onOpenChange], false);
  }
  onCancel = (e: Event) => {
    e.preventDefault();
    if (this.dismissible) {
      this.requestClose();
    }
  };
  onClick = (e: Event) => {
    if (this.dismissible && e.target === e.currentTarget) {
      this.requestClose();
    }
  };
  <template>
    <dialog
      class='pretui-drawer'
      data-placement={{this.placement}}
      aria-label={{@label}}
      data-test-pretui-drawer
      {{modalBehavior this.open this.onCancel this.onClick}}
      ...attributes
    >
      <div class='pretui-drawer-inner'>
        {{#if (has-block 'title')}}
          <header class='pretui-drawer-title'>{{yield to='title'}}</header>
        {{/if}}
        <div class='pretui-drawer-body'>{{yield}}</div>
        {{#if (has-block 'footer')}}
          <footer class='pretui-drawer-footer'>{{yield to='footer'}}</footer>
        {{/if}}
      </div>
    </dialog>
    <style scoped>
      .pretui-drawer {
        border: 0;
        padding: 0;
        background: var(--card);
        color: var(--foreground);
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 12px 40px rgb(16 24 40 / 0.18));
        font-family: var(--font-sans);
        font-size: var(--text-body, 15px);
        max-width: none;
        max-height: none;
      }
      .pretui-drawer[data-placement='end'],
      .pretui-drawer[data-placement='start'] {
        width: min(var(--pretui-drawer-size, 360px), calc(100vw - 48px));
        height: 100dvh;
        margin-block: 0;
      }
      .pretui-drawer[data-placement='end'] {
        margin-inline: auto 0;
        border-radius: var(--radius-surface, 10px) 0 0 var(--radius-surface, 10px);
      }
      .pretui-drawer[data-placement='start'] {
        margin-inline: 0 auto;
        border-radius: 0 var(--radius-surface, 10px) var(--radius-surface, 10px) 0;
      }
      .pretui-drawer[data-placement='bottom'] {
        width: 100vw;
        margin: auto 0 0;
        max-height: min(var(--pretui-drawer-size, 420px), 80dvh);
        border-radius: var(--radius-surface, 10px) var(--radius-surface, 10px) 0 0;
      }
      .pretui-drawer::backdrop {
        background: var(--pretui-overlay-scrim, rgb(16 24 40 / 0.4));
      }
      .pretui-drawer[open] {
        opacity: 1;
        transform: none;
        transition: opacity 220ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 220ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-drawer[open][data-placement='end'] {
          opacity: 0;
          transform: translateX(24px);
        }
        .pretui-drawer[open][data-placement='start'] {
          opacity: 0;
          transform: translateX(-24px);
        }
        .pretui-drawer[open][data-placement='bottom'] {
          opacity: 0;
          transform: translateY(24px);
        }
      }
      .pretui-drawer-inner {
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: var(--space-4, 11px);
        padding: var(--space-6, 19px);
        height: 100%;
        box-sizing: border-box;
        align-content: start;
      }
      .pretui-drawer-title {
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
      }
      .pretui-drawer-body {
        overflow-y: auto;
        color: var(--muted-foreground);
        line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
      }
      .pretui-drawer-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3, 8px);
        border-top: 1px solid var(--border);
        padding-top: var(--space-4, 11px);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-drawer[open] {
          transition: none;
        }
      }
    </style>
  </template>
}

export interface PopoverSignature {
  Args: OpenArgs &
    PlacementArgs & {
      placement?: PopupPlacement | string;
      distance?: number;
      label?: string;
      /** the uncontrolled half of the hybrid */
      defaultOpen?: boolean;
      /** fires on every open and close, controlled or not */
      onOpenChange?: (open: boolean) => void;
    };
  Blocks: {
    trigger: [open: boolean, toggle: () => void];
    default: [close: () => void];
  };
  Element: HTMLSpanElement;
}

// Anything that can hold focus inside the anchor. Used to hand focus back to
// the control the panel was opened from — the panel's trigger is a caller
// block, so the component cannot capture the button directly the way
// MorphingPopover does.
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Anchored floating panel: Popup positioning + the generalized backdrop-close
 * pattern (viewport-covering close target instead of a document listener).
 *
 * Escape closes it from anywhere — the trigger, the panel, or a control that
 * portalled its own DOM elsewhere. **Fixed 2026-08-13:** the listener used to
 * sit on the panel, so the ordinary path (open from the trigger, press
 * Escape without tabbing in) did nothing, and that bug rode into every
 * consumer — `DatePicker`, `DateRangePicker`, `ThemeFrame`. It now uses
 * `listenDocumentCapture` (focus.gts), installed on the panel so its lifetime
 * is exactly the open lifetime, in the CAPTURE phase with `stopPropagation`
 * so a host that also listens for Escape cannot make one keypress mean two
 * things. This is the 46f065-popover fork's rule — the overlay owns
 * dismissal, full stop — and the same idiom `MorphingPopover` already uses.
 *
 * Every dismissal path returns focus to the trigger.
 *
 * **Hybrid since 2026-08-13.** It was uncontrolled-only and emitted no event
 * at all: a parent could neither open it nor learn that it had opened, which
 * is the ship-blocking shape ("a control that mutates state without a
 * callback"). It now carries the kit's controlled/uncontrolled triple —
 * `@open` / `@defaultOpen` / `@onOpenChange` — and every existing caller,
 * all of which pass none of the three, keeps the exact behaviour it had.
 */
export class Popover extends Component<PopoverSignature> {
  @tracked internalOpen = this.args.defaultOpen ?? false;
  private anchorEl?: HTMLElement;
  captureAnchor = modifier((el: HTMLElement) => {
    this.anchorEl = el;
  });
  get controlled() {
    return resolveOpen(this.args);
  }
  get open() {
    return this.controlled ?? this.internalOpen;
  }
  /** side/align/position/direction fold into @placement before forwarding */
  get placement(): PopupPlacement {
    return resolvePlacement(this.args, 'bottom-start');
  }
  private setOpen(next: boolean) {
    if (this.controlled === undefined) {
      this.internalOpen = next;
    }
    emit([this.args.onOpenChange], next);
  }
  toggle = () => {
    this.setOpen(!this.open);
  };
  close = () => {
    if (!this.open) return;
    this.setOpen(false);
    this.restoreFocus();
  };
  // Focus RETURN. The native <dialog> gives this for free; an anchored panel
  // has to do it, and almost none of them do. The trigger is a caller block,
  // so the first focusable in the anchor that is not inside the floating
  // layer is the best available answer.
  private restoreFocus() {
    let root = this.anchorEl;
    if (!root) return;
    for (let el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (!el.closest('.pretui-popup')) {
        el.focus();
        return;
      }
    }
  }
  onKey = (e: Event) => {
    if (!this.open) return;
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    this.close();
  };
  <template>
    <span
      class='pretui-popover'
      data-test-pretui-popover
      {{this.captureAnchor}}
      ...attributes
    >
      <Popup
        @open={{this.open}}
        @placement={{this.placement}}
        @distance={{@distance}}
      >
        <:anchor>{{yield this.open this.toggle to='trigger'}}</:anchor>
        <:default>
          <button
            type='button'
            class='pretui-popover-backdrop'
            aria-label='Close'
            tabindex='-1'
            {{on 'click' this.close}}
          ></button>
          <div
            class='pretui-popover-panel'
            role='dialog'
            aria-label={{if @label @label 'Popover'}}
            tabindex='-1'
            {{listenDocumentCapture 'keydown' this.onKey}}
          >
            {{yield this.close}}
          </div>
        </:default>
      </Popup>
    </span>
    <style scoped>
      .pretui-popover {
        display: inline-block;
      }
      .pretui-popover-backdrop {
        /* wave-0 backdrop-close: viewport-covering close target instead of a
           document listener; fixed is intentional (lint warns, accepted) */
        position: fixed;
        inset: 0;
        background: transparent;
        border: 0;
        padding: 0;
        cursor: default;
      }
      .pretui-popover-panel {
        position: relative;
        background: var(--popover);
        color: var(--popover-foreground);
        border-radius: 10px;
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.16));
        padding: var(--space-4, 11px);
        /* component-owned knobs: consumers size the panel by setting these
           custom properties on any ancestor — no :deep() required */
        width: var(--pretui-popover-width, auto);
        min-width: var(--pretui-popover-min-width, 200px);
        max-width: var(--pretui-popover-max-width, min(360px, calc(100vw - 16px)));
        /* The documented exception to "never remove an outline without a
           :focus-visible replacement": the panel is tabindex='-1' and is only
           ever focused programmatically on open, so :focus-visible never
           matches it and a ring here would only be a stray box around a
           region the user did not tab to. Every focusable thing INSIDE the
           panel keeps its own ring. */
        outline: none;
        opacity: 1;
        transform: none;
        transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-popover-panel {
          opacity: 0;
          transform: translateY(4px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-popover-panel {
          transition: none;
        }
      }
    </style>
  </template>
}
