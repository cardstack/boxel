// Pretui — overlay plumbing shared by Popup, Dialog, Drawer and Popover:
// placement aliases, the measuring anchor modifier, the open-arg aliases and
// the native <dialog> modal behaviour. Not a component.
import { modifier } from 'ember-modifier';
import { firstDefined } from '../pretui-primitives';

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
export type PlacementArgs = {
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

// Keeps the native <dialog>'s modal state in sync with the controlled @open
// arg, and owns its 'cancel' (Escape) and 'click' (backdrop) listeners —
// attached here rather than with {{on}} because the lint rule
// no-invalid-interactive rejects template listeners on <dialog>. showModal()
// promotes to the top layer: focus trap, Escape, ::backdrop, and stacking
// all come from the platform.
export const modalBehavior = modifier(
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
