import { modifier } from 'ember-modifier';
import { MotionNode } from 'glimmer-motion';

// Adapt the existing shared CardHeader without giving boxel-ui a dependency on
// Choreo. These are ordinary participants in the enclosing region, not a second
// animation scheduler. Only the empty surface can change shape.
export default modifier((element: HTMLElement, [id]: [string]) => {
  let style = getComputedStyle(element);
  let surface = document.createElement('div');
  surface.className = 'header-motion-surface';
  surface.setAttribute('aria-hidden', 'true');
  surface.dataset.motionRadii = JSON.stringify([
    parseFloat(style.borderTopLeftRadius),
    parseFloat(style.borderBottomLeftRadius),
  ]);
  surface.style.borderRadius = style.borderRadius;
  surface.style.setProperty(
    '--header-surface-background',
    style.backgroundColor,
  );
  surface.style.outline = style.outline;
  // The shape may tween radius; its shadow paint must not. Keep the shadow
  // on a separate, fixed paint whose transform is budgeted with the header.
  let shadow = document.createElement('div');
  shadow.className = 'header-motion-shadow';
  shadow.setAttribute('aria-hidden', 'true');
  shadow.style.borderRadius = style.borderRadius;
  shadow.style.boxShadow = style.boxShadow;
  element.prepend(shadow);
  element.prepend(surface);
  element.classList.add('header-motion-parts');
  let nodes: MotionNode[] = [];
  for (let [part, target] of [
    ['surface', surface],
    ['shadow', shadow],
    ['icon', element.querySelector<HTMLElement>('.realm-icon-container')],
    ['title', element.querySelector<HTMLElement>('.card-type-display-name')],
    ['actions', element.querySelector<HTMLElement>('.actions')],
  ] as const) {
    if (!target) continue;
    let node = new MotionNode();
    node.update(target, {
      id: `${id}:${part}`,
      role:
        part === 'surface'
          ? 'header-surface'
          : part === 'shadow'
            ? 'header-shadow'
            : 'header-content',
      pack: part === 'title' ? 'content' : 'box',
    });
    nodes.push(node);
  }
  return () => {
    for (let node of nodes) node.destroy();
    // The enclosing header may be retained by Choreo as a counterpart. Its
    // decoration stays with it until Choreo releases that retained element.
  };
});
