/**
 * The coordinate contract (docs/planes-and-cameras.md).
 *
 * A plane's camera is pure arithmetic over frozen numbers: with
 * transform-origin pinned at 0 0, the applied transform is
 * `translate(x + (1−z)·P) scale(z)` for aim point P (§6.3). Because it
 * is arithmetic, it is invertible WITHOUT reading the DOM — and these
 * two inverses are the whole compositor ⇄ plane-local ⇄ viewport
 * conversion: cross-plane flights, cross-plane hit testing, and
 * eventually cross-plane drag all reduce to them.
 *
 * A plane that scrolls adds its scroll offset to the same arithmetic —
 * the one place a DOM read (the scroll position) legitimately enters,
 * read once per conversion, never per frame.
 */
import type { CameraState, Rect } from './types.ts';

export interface PlanePoint {
  x: number;
  y: number;
}

const ORIGIN: PlanePoint = { x: 0, y: 0 };

/**
 * The translate the camera actually applies at aim point `aim` — the
 * same algebra `applyCamera` paints with. At z = 1 the aim term
 * vanishes: an unpanned camera is exactly the identity.
 */
export function appliedCamera(
  cam: CameraState,
  aim: PlanePoint = ORIGIN,
): PlanePoint {
  return {
    x: cam.x + (1 - cam.zoom) * aim.x,
    y: cam.y + (1 - cam.zoom) * aim.y,
  };
}

/** plane-local box → page space, through the plane's camera and scroll */
export function toPage(
  local: Rect,
  cam: CameraState,
  aim: PlanePoint = ORIGIN,
  scroll: PlanePoint = ORIGIN,
): Rect {
  const applied = appliedCamera(cam, aim);
  return {
    height: local.height * cam.zoom,
    width: local.width * cam.zoom,
    x: (local.x - scroll.x) * cam.zoom + applied.x,
    y: (local.y - scroll.y) * cam.zoom + applied.y,
  };
}

/** page-space box → the plane's local space: `(page − applied)/z + scroll` */
export function toLocal(
  page: Rect,
  cam: CameraState,
  aim: PlanePoint = ORIGIN,
  scroll: PlanePoint = ORIGIN,
): Rect {
  const applied = appliedCamera(cam, aim);
  return {
    height: page.height / cam.zoom,
    width: page.width / cam.zoom,
    x: (page.x - applied.x) / cam.zoom + scroll.x,
    y: (page.y - applied.y) / cam.zoom + scroll.y,
  };
}
