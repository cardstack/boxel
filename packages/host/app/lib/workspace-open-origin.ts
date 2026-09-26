import type { CardOpenOrigin } from './card-open-origin';

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

// The realm icon on a dashboard tile: the seed a workspace grows out of.
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
