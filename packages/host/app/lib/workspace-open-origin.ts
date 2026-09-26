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
