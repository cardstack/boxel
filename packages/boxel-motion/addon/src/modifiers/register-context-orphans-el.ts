import { modifier } from 'ember-modifier';

import type AnimationContextComponent from '../components/animation-context.gts';

const registerContextOrphansEl = modifier(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertOrphansEl(element);
  },
);

export default registerContextOrphansEl;
