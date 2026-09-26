import { afterMotionPaint } from './after-motion-paint';
import { motionDurations } from './motion-timing';

import type { CardOpenOrigin } from './card-open-origin';
import type { HostCrossing } from '../services/host-motion';

export interface WorkspaceOpenOrigin extends CardOpenOrigin {
  realmURL: string;
  backgroundURL: string;
  zoom: number;
  favorite?: boolean;
}

export interface WorkspacePortal {
  token: number;
  origin: WorkspaceOpenOrigin;
  direction: 'opening' | 'closing';
  fade?: boolean;
}

// Capture the wallpaper, not the tile's icon, labels, or action buttons.
export function workspaceOpenOrigin(
  event: Event,
  realmURL: string,
  backgroundURL?: string | null,
): WorkspaceOpenOrigin | undefined {
  return workspaceOriginFromElement(
    event.currentTarget,
    realmURL,
    backgroundURL,
  );
}

export function workspaceOriginFromElement(
  button: EventTarget | null,
  realmURL: string,
  backgroundURL?: string | null,
): WorkspaceOpenOrigin | undefined {
  if (!(button instanceof HTMLElement) || !backgroundURL) return;
  let tile = button.querySelector<HTMLElement>('.tile-icon');
  if (!tile) return;
  let box = tile.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  let viewport = button
    .closest('.workspace-chooser__content')
    ?.getBoundingClientRect();
  if (
    box.right <= (viewport?.left ?? 0) ||
    box.left >= (viewport?.right ?? innerWidth) ||
    box.bottom <= (viewport?.top ?? 0) ||
    box.top >= (viewport?.bottom ?? innerHeight)
  )
    return;
  let background = getComputedStyle(tile, '::before');
  return {
    source: tile,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    radius: parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0,
    zoom: new DOMMatrixReadOnly(background.transform).a,
    realmURL,
    backgroundURL,
    favorite: !!button.closest('.workspace-card.is-enlarged'),
  };
}

// The tile's rounding belongs to its card container, which clips a square
// wallpaper image. For a crossing, give the image the container's radius on
// the corners they share so the bitmap's corners tween to and from the
// square realm background. Returns a restore.
export function adoptTileCorners(tile: HTMLElement): () => void {
  let card = tile.closest<HTMLElement>('[data-workspace-realm]');
  if (!card) return () => {};
  let outer = card.getBoundingClientRect();
  let inner = tile.getBoundingClientRect();
  let style = getComputedStyle(card);
  let near = (a: number, b: number) => Math.abs(a - b) < 1.5;
  let top = near(inner.top, outer.top);
  let bottom = near(inner.bottom, outer.bottom);
  let left = near(inner.left, outer.left);
  let right = near(inner.right, outer.right);
  let previous = tile.style.borderRadius;
  tile.style.borderRadius = [
    top && left ? style.borderTopLeftRadius : '0px',
    top && right ? style.borderTopRightRadius : '0px',
    bottom && right ? style.borderBottomRightRadius : '0px',
    bottom && left ? style.borderBottomLeftRadius : '0px',
  ].join(' ');
  return () => {
    tile.style.borderRadius = previous;
  };
}

// The dashboard tile a workspace returns to: the realm's tile that is on
// screen, preferring the favourite or catalogue copy it was opened from.
export function workspaceReturnTile(
  realmURL: string,
  favorite?: boolean,
): HTMLElement | undefined {
  let slashed = (url: string) => (url.endsWith('/') ? url : `${url}/`);
  let cards = Array.from(
    document.querySelectorAll<HTMLElement>('[data-workspace-realm]'),
  ).filter(
    (card) => slashed(card.dataset.workspaceRealm ?? '') === slashed(realmURL),
  );
  let onScreen = (card: HTMLElement) => {
    let tile = card.querySelector<HTMLElement>('.tile-icon');
    if (!tile?.checkVisibility()) return false;
    let box = tile.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.bottom > 0 &&
      box.top < innerHeight &&
      box.right > 0 &&
      box.left < innerWidth
    );
  };
  let preferred =
    favorite === undefined
      ? []
      : cards.filter(
          (card) => !!card.closest('.workspace-card.is-enlarged') === favorite,
        );
  let card = preferred.find(onScreen) ?? cards.find(onScreen);
  return card?.querySelector<HTMLElement>('.tile-icon') ?? undefined;
}

// The realm icon on a dashboard tile, which flies to the workspace header.
export function tileRealmIcon(tile: HTMLElement) {
  return tile.querySelector<HTMLElement>('.realm-icon-wrapper') ?? undefined;
}

// The realm icon in the header of the workspace's first card, where a tile's
// icon lands.
export function workspaceHeaderIcon() {
  return (
    document.querySelector<HTMLElement>(
      '.stacks .operator-mode-stack .stack-item-header .realm-icon',
    ) ?? undefined
  );
}

const dashboard = '.workspace-chooser';
const platter = '.stacks';

type WorkspaceCrossing = Omit<HostCrossing, 'update'>;

// Dashboard to workspace, like a fitted card opening to isolated: the tile
// crosses into the realm background while the dashboard fades out, the
// realm icon flies to the first card's header, and the platter of cards
// scales and fades up behind it from the middle of the tile, starting at the
// icon's size. restore() once it lands.
export function workspaceEntry(tile: HTMLElement): {
  crossing: WorkspaceCrossing;
  restore: () => void;
} {
  let icon = tileRealmIcon(tile);
  let restoreCorners = adoptTileCorners(tile);
  let standIn: HTMLElement | undefined;
  return {
    restore: () => {
      restoreCorners();
      standIn?.remove();
    },
    crossing: {
      from: tile,
      to: () => document.querySelector<HTMLElement>('.workspace-wallpaper'),
      duration: motionDurations.workspace,
      chrome: 'crossfade',
      scenes: [
        { selector: dashboard, fade: 'out' },
        { selector: platter, fade: 'rise', seed: tileRealmIcon },
      ],
      companions: icon
        ? [
            {
              from: icon,
              to: () =>
                workspaceHeaderIcon() ?? (standIn = headerIconStandIn(icon)),
            },
          ]
        : [],
    },
  };
}

// Somewhere for the flying icon to land when the header has no realm icon.
// A cold realm's index card is still loading, so a copy of the tile's icon
// image stands where the header's icon will sit: top left of the card,
// centred in the header's height, sized by the header's own variables. A
// header whose realm has no icon URL renders an empty icon slot: an empty
// stand-in there lets the icon dissolve into the slot, since no icon comes.
// Removed when the crossing ends.
function headerIconStandIn(tileIcon?: HTMLElement): HTMLElement | undefined {
  let card = document.querySelector<HTMLElement>(
    '.stacks .operator-mode-stack .stack-item-card',
  );
  let image = tileIcon?.querySelector<HTMLElement>('.realm-icon');
  if (!card) return undefined;
  let slot = card.querySelector<HTMLElement>(
    '.stack-item-header .realm-icon-container',
  );
  let standIn = document.createElement('div');
  let size = 'var(--boxel-card-header-realm-icon-size, var(--boxel-icon-sm))';
  standIn.setAttribute('aria-hidden', 'true');
  Object.assign(standIn.style, {
    width: size,
    height: size,
    flexShrink: '0',
    pointerEvents: 'none',
  });
  if (slot) {
    slot.append(standIn);
    return standIn;
  }
  let inset = `calc((var(--stack-item-header-height) - ${size}) / 2)`;
  Object.assign(standIn.style, {
    position: 'absolute',
    top: inset,
    left: inset,
    borderRadius: 'var(--realm-icon-border-radius, 4px)',
    backgroundImage: image ? getComputedStyle(image).backgroundImage : 'none',
    backgroundSize: 'cover',
  });
  card.append(standIn);
  return standIn;
}

// The mirror: the realm background crosses back into the tile `findTile`
// finds once the dashboard renders, the header's realm icon flies back to
// it as the platter scales and fades down, and the dashboard fades in. With no tile
// on screen the background simply fades. restore() once it lands.
export function workspaceExit(
  wallpaper: HTMLElement,
  findTile: () => HTMLElement | undefined,
): { crossing: WorkspaceCrossing; restore: () => void } {
  // A realm without an icon URL has an empty header slot; the tile's icon
  // then fades in from it, and is kept out of the landing tile's bitmap.
  let standIn = workspaceHeaderIcon() ? undefined : headerIconStandIn();
  let icon = workspaceHeaderIcon() ?? standIn;
  let restore = () => {};
  return {
    restore: () => {
      restore();
      standIn?.remove();
    },
    crossing: {
      from: wallpaper,
      to: () => {
        let tile = findTile();
        if (tile) restore = adoptTileCorners(tile);
        return tile;
      },
      duration: motionDurations.workspace,
      chrome: 'crossfade',
      scenes: [
        { selector: platter, fade: 'fall', seed: tileRealmIcon },
        { selector: dashboard, fade: 'in' },
      ],
      companions: icon
        ? [{ from: icon, to: (tile) => tile && tileRealmIcon(tile) }]
        : [],
    },
  };
}

// The index card's header can still be rendering when the crossing
// captures. Give it a few frames so the icon lands on the real header; after
// `timeout` ms the crossing plays anyway and the icon lands on a stand-in.
export async function workspaceHeaderRendered(timeout = 150) {
  let deadline = performance.now() + timeout;
  while (!workspaceHeaderIcon() && performance.now() < deadline) {
    await new Promise<void>((resolve) => afterMotionPaint(resolve));
  }
}
