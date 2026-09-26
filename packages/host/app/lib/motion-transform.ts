import type { PropSource, Sprite } from 'glimmer-motion';

export function paintedTranslation(sprite: Sprite) {
  let matrix = new DOMMatrixReadOnly(
    getComputedStyle(sprite.element).transform,
  );
  return { x: matrix.m41, y: matrix.m42 };
}

// Full transform keyframes use Motion's native browser animation path. Separate
// x/y MotionValues require a JavaScript render on every frame in this version.
export const liftIn = ['translate(0px, 24px)', 'none'];
export const liftOut: PropSource = (sprite) => {
  let { x, y } = paintedTranslation(sprite);
  return [`translate(${x}px, ${y}px)`, `translate(${x}px, 18px)`];
};

export const centeredReflow: PropSource = (sprite, changeset) => {
  let from = sprite.initial?.page;
  let to = sprite.final?.page;
  if (!from || !to) return 'none';
  let current = paintedTranslation(sprite);
  let zoom = changeset.measureZoom || 1;
  let x = current.x + (from.x + from.width / 2 - to.x - to.width / 2) / zoom;
  let y = current.y + (from.y - to.y) / zoom;
  return [`translate(${x}px, ${y}px)`, 'none'];
};

// Empty decorative surfaces can scale independently of their live text. Their
// layout dimensions resolve once, and only the transform changes in playback.
export const surfaceTransform: PropSource = (sprite, changeset) => {
  let from = sprite.initial ?? sprite.counterpart?.initial;
  let to = sprite.final;
  if (!from || !to) return 'none';
  let a = from.parent;
  let b = to.parent;
  let current = paintedTranslation(sprite);
  let element = sprite.element as HTMLElement;
  let zoom = changeset.measureZoom || 1;
  return [
    `translate(${current.x + (a.x - b.x) / zoom}px, ${current.y + (a.y - b.y) / zoom}px) scaleX(${a.width / zoom / element.offsetWidth || 1}) scaleY(${a.height / zoom / element.offsetHeight || 1})`,
    'translate(0px, 0px) scaleX(1) scaleY(1)',
  ];
};

export const sheetSurfaceTransform: PropSource = (sprite, changeset) => {
  let a = sprite.initial?.page;
  let b = sprite.final?.page;
  if (!a || !b) return 'none';
  let current = paintedTranslation(sprite);
  let element = sprite.element as HTMLElement;
  let zoom = changeset.measureZoom || 1;
  return [
    `translate(${current.x + (a.x - b.x) / zoom}px, ${current.y + (a.y - b.y) / zoom}px) scaleX(${a.width / zoom / element.offsetWidth || 1}) scaleY(${a.height / zoom / element.offsetHeight || 1})`,
    'translate(0px, 0px) scaleX(1) scaleY(1)',
  ];
};
