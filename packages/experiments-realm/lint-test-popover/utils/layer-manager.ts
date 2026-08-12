/**
 * SurfaceLayerManager — dynamic z-index allocator for surface layers.
 *
 * Static z-index tokens declare where each layer tier sits, but they do not
 * order multiple active surfaces inside one tier. A fresh allocation on mount
 * gives nested popovers, cell lifts, modals, drag ghosts, and future top-layer
 * bridges deterministic stacking without every host inventing its own ladder.
 */

export type SurfaceLayerTier =
  | 'selection'
  | 'cell-lift'
  | 'popover'
  | 'modal'
  | 'toast';

export interface SurfaceLayerRect {
  id?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  radius?: SurfaceLayerCornerRadii;
}

export interface SurfaceLayerCornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface SurfaceLayerBox {
  ids: string[];
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  radius?: SurfaceLayerCornerRadii;
}

export interface SurfaceLayerClipBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SurfaceLayerBoxCollapseOptions {
  /** Pixel tolerance for adjacent DOM rects that differ by subpixel rounding. */
  tolerance?: number;
}

// The whole ladder lives in the z-index window (700, 900): ABOVE the host's
// persistent top-bar chrome (--host-top-bar-z-index = 700) but BELOW the host
// popups/modals that can co-occur with an open card — the AI-panel popover
// (--host-ai-panel-popover-z-index = 900), the profile popover
// (--boxel-layer-floating-button + 1 = 1001), and boxel-ui modals / the
// card-chooser (1500 / 2000).
//
// Why above the top bar (not below all host chrome): the top bar is persistent
// chrome, not a dismissable popup. Sitting BELOW it (as an earlier, more
// aggressive compression did) means a tall popover slides UP under the bar and
// gets visually CROPPED. Sitting just ABOVE it makes that crop structurally
// impossible — the popover simply paints over the bar, the same way the host's
// own AI-chat popover (anchored into the top bar) already does — while still
// staying under every real popup/modal.
//
// (This z ordering only holds because the popover portals into the SAME
// stacking context as that host chrome — see Popover#portalTarget; a z-index
// is meaningless across stacking contexts.) Ordering within the ladder is
// preserved (selection < cell-lift < popover < modal < toast) for catalog
// surfaces that stack among themselves.
const TIER_BASE: Record<SurfaceLayerTier, number> = {
  selection: 705,
  'cell-lift': 715,
  popover: 740,
  modal: 800,
  toast: 860,
};

const TIER_CEILING: Record<SurfaceLayerTier, number> = {
  selection: 714,
  'cell-lift': 739,
  popover: 799,
  modal: 859,
  toast: 899,
};

export class SurfaceLayerManager {
  private active = new Map<number, SurfaceLayerTier>();

  allocate(tier: SurfaceLayerTier): number {
    const base = TIER_BASE[tier];
    const ceiling = TIER_CEILING[tier];
    let z = base;
    while (this.active.has(z) && z < ceiling) z++;
    if (z >= ceiling) {
      console.warn(
        `[SurfaceLayerManager] Tier '${tier}' exhausted ` +
          `(${ceiling - base} active). Returning ceiling.`,
      );
    }
    this.active.set(z, tier);
    return z;
  }

  release(z: number): void {
    this.active.delete(z);
  }

  get top(): number {
    if (this.active.size === 0) return 0;
    return Math.max(...this.active.keys());
  }

  get snapshot(): ReadonlyMap<number, SurfaceLayerTier> {
    return new Map(this.active);
  }

  countByTier(): Record<SurfaceLayerTier, number> {
    const out: Record<SurfaceLayerTier, number> = {
      selection: 0,
      'cell-lift': 0,
      popover: 0,
      modal: 0,
      toast: 0,
    };
    for (const tier of this.active.values()) out[tier]++;
    return out;
  }

  _resetForTests(): void {
    this.active.clear();
  }

  collapseSelectionBoxes(
    rects: readonly SurfaceLayerRect[],
    options: SurfaceLayerBoxCollapseOptions = {},
  ): SurfaceLayerBox[] {
    return collapseSurfaceLayerBoxes(rects, options);
  }
}

export const SURFACE_LAYERS = new SurfaceLayerManager();

// Back-compat names for code that adopted the grid POC vocabulary.
export const LAYERS = SURFACE_LAYERS;
export { SurfaceLayerManager as LayerManager };
export type { SurfaceLayerTier as PopoverTier };

export function collapseSurfaceLayerBoxes(
  rects: readonly SurfaceLayerRect[],
  options: SurfaceLayerBoxCollapseOptions = {},
): SurfaceLayerBox[] {
  const tolerance = options.tolerance ?? 1;
  const normalized = rects
    .map((rect, index) => {
      const left = rect.left;
      const top = rect.top;
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      return {
        ids: [rect.id ?? String(index)],
        left,
        top,
        right,
        bottom,
        width: rect.width,
        height: rect.height,
        ...(rect.radius
          ? {
              radius: clampSurfaceLayerRadii(
                rect.radius,
                rect.width,
                rect.height,
              ),
            }
          : {}),
      };
    })
    .filter(
      (box) =>
        Number.isFinite(box.left) &&
        Number.isFinite(box.top) &&
        box.width > 0 &&
        box.height > 0,
    )
    .sort((a, b) => a.top - b.top || a.left - b.left);

  if (normalized.length <= 1) return normalized;

  const rowBands: SurfaceLayerBox[][] = [];
  for (const box of normalized) {
    const row = rowBands.find((band) =>
      overlapsVertically(band[0]!, box, tolerance),
    );
    if (row) row.push(box);
    else rowBands.push([box]);
  }

  const rowBoxes: SurfaceLayerBox[] = [];
  for (const band of rowBands) {
    band.sort((a, b) => a.left - b.left);
    let current: SurfaceLayerBox | null = null;
    for (const box of band) {
      if (!current) {
        current = cloneBox(box);
      } else if (box.left <= current.right + tolerance) {
        current = unionBoxes(current, box);
      } else {
        rowBoxes.push(current);
        current = cloneBox(box);
      }
    }
    if (current) rowBoxes.push(current);
  }

  rowBoxes.sort((a, b) => a.left - b.left || a.top - b.top);
  const collapsed: SurfaceLayerBox[] = [];
  for (const box of rowBoxes) {
    const match = collapsed.find(
      (candidate) =>
        nearlyEqual(candidate.left, box.left, tolerance) &&
        nearlyEqual(candidate.right, box.right, tolerance) &&
        box.top <= candidate.bottom + tolerance,
    );
    if (match) {
      const next = unionBoxes(match, box);
      Object.assign(match, next);
    } else {
      collapsed.push(cloneBox(box));
    }
  }

  return collapsed.sort((a, b) => a.top - b.top || a.left - b.left);
}

export function clipSurfaceLayerRect(
  rect: SurfaceLayerRect,
  clip: SurfaceLayerClipBounds,
): SurfaceLayerRect | null {
  const rectRight = rect.left + rect.width;
  const rectBottom = rect.top + rect.height;
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rectRight, clip.right);
  const bottom = Math.min(rectBottom, clip.bottom);

  if (right <= left || bottom <= top) return null;

  const clippedLeft = left > rect.left;
  const clippedTop = top > rect.top;
  const clippedRight = right < rectRight;
  const clippedBottom = bottom < rectBottom;
  const width = right - left;
  const height = bottom - top;

  return {
    ...rect,
    left,
    top,
    width,
    height,
    ...(rect.radius
      ? {
          radius: clampSurfaceLayerRadii(
            {
              topLeft: clippedLeft || clippedTop ? 0 : rect.radius.topLeft,
              topRight: clippedRight || clippedTop ? 0 : rect.radius.topRight,
              bottomRight:
                clippedRight || clippedBottom ? 0 : rect.radius.bottomRight,
              bottomLeft:
                clippedLeft || clippedBottom ? 0 : rect.radius.bottomLeft,
            },
            width,
            height,
          ),
        }
      : {}),
  };
}

function overlapsVertically(
  a: SurfaceLayerBox,
  b: SurfaceLayerBox,
  tolerance: number,
): boolean {
  if (nearlyEqual(a.top, b.top, tolerance)) return true;
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap > Math.min(a.height, b.height) / 2;
}

function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function cloneBox(box: SurfaceLayerBox): SurfaceLayerBox {
  return {
    ids: [...box.ids],
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    width: box.width,
    height: box.height,
    ...(box.radius ? { radius: { ...box.radius } } : {}),
  };
}

function unionBoxes(a: SurfaceLayerBox, b: SurfaceLayerBox): SurfaceLayerBox {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return {
    ids: [...a.ids, ...b.ids],
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    ...mergedSurfaceLayerRadius(a.radius, b.radius, right - left, bottom - top),
  };
}

function mergedSurfaceLayerRadius(
  a: SurfaceLayerCornerRadii | undefined,
  b: SurfaceLayerCornerRadii | undefined,
  width: number,
  height: number,
): { radius?: SurfaceLayerCornerRadii } {
  if (!a || !b) return {};

  return {
    radius: clampSurfaceLayerRadii(
      {
        topLeft: Math.min(a.topLeft, b.topLeft),
        topRight: Math.min(a.topRight, b.topRight),
        bottomRight: Math.min(a.bottomRight, b.bottomRight),
        bottomLeft: Math.min(a.bottomLeft, b.bottomLeft),
      },
      width,
      height,
    ),
  };
}

function clampSurfaceLayerRadii(
  radius: SurfaceLayerCornerRadii,
  width: number,
  height: number,
): SurfaceLayerCornerRadii {
  const max = Math.max(0, Math.min(width, height) / 2);
  return {
    topLeft: clampRadius(radius.topLeft, max),
    topRight: clampRadius(radius.topRight, max),
    bottomRight: clampRadius(radius.bottomRight, max),
    bottomLeft: clampRadius(radius.bottomLeft, max),
  };
}

function clampRadius(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, max));
}
