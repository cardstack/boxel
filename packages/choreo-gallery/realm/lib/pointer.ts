import { modifier } from 'ember-modifier';

export function preventSelect(event: Event) {
  event.preventDefault();
}

/**
 * Keeps clicks inside the element. The host opens an embedded card on a click
 * anywhere inside it, so a live demo embedded in a document marks its own
 * controls with this, and their clicks stay with the demo.
 */
export const ownClicks = modifier((element: HTMLElement) => {
  let stop = (event: Event) => event.stopPropagation();
  element.addEventListener('click', stop);
  return () => element.removeEventListener('click', stop);
});

/**
 * What a press inside a live stage can land on that is the stage's own: a
 * control, or a surface the stage marks `data-stage-press` because a plain
 * tap or hold on it does something (advancing a slide, steering a car).
 */
const CONTROL =
  'a[href], button, input, select, textarea, label, summary, [contenteditable], [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="tab"], [tabindex], [data-stage-press]';

/** how far a press travels before it is a drag rather than a click */
const DRAG_PX = 4;

/**
 * Keeps the clicks a live stage uses for itself, and lets every other click
 * through. The host opens a fitted card on a click anywhere inside it, so a
 * tile whose stage is mostly picture stays a link: a click on the picture
 * opens the demo, while a press on one of the stage's controls, or one that
 * ends a drag, stays with the stage.
 */
export const ownControlClicks = modifier((element: HTMLElement) => {
  let from: { x: number; y: number } | null = null;
  let down = (event: PointerEvent) => {
    from = { x: event.clientX, y: event.clientY };
  };
  let click = (event: MouseEvent) => {
    let target = event.target instanceof Element ? event.target : null;
    let control = target?.closest(CONTROL);
    let dragged =
      from !== null &&
      Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_PX;
    from = null;
    if ((control && element.contains(control)) || dragged) {
      event.stopPropagation();
    }
  };
  // the press is read on the way down, so a stage that keeps its own
  // pointerdown from bubbling still leaves the drag check its start
  element.addEventListener('pointerdown', down, { capture: true });
  element.addEventListener('click', click);
  return () => {
    element.removeEventListener('pointerdown', down, { capture: true });
    element.removeEventListener('click', click);
  };
});

/**
 * The click handler for a link to the card it sits in, where the host opens
 * the card. A plain click is the host's: the link's own navigation is
 * stopped and the click goes on to the host (its overlay in interact mode,
 * the gallery's grid on a published site). A modified click (new tab, new
 * window) is the browser's, and the host never hears of it.
 */
export function openThroughHost(event: Event): void {
  if (
    event instanceof MouseEvent &&
    (event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey)
  ) {
    event.stopPropagation();
    return;
  }
  event.preventDefault();
}
