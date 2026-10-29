export interface Point {
  x: number;
  y: number;
}

// Whether the pointer, moving from `previous` to `current`, is heading into
// `target`, a flyout to the right of the rail: the move narrows the angle to
// both of the flyout's near corners. A pointer inside that triangle may cross
// other entries on its way to the flyout without the flyout switching to them.
export function isAimingAt(previous: Point, current: Point, target: DOMRect) {
  if (current.x >= target.left) {
    return false;
  }
  let slope = (from: Point, to: Point) =>
    (to.y - from.y) / Math.max(to.x - from.x, 1);
  let top = { x: target.left, y: target.top };
  let bottom = { x: target.left, y: target.bottom };
  return (
    slope(current, top) < slope(previous, top) &&
    slope(current, bottom) > slope(previous, bottom)
  );
}
