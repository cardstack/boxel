import { modifier } from 'ember-modifier';

import type AnimationContextComponent from '../components/animation-context.gts';

const registerContentModifier = modifier(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertEl(element);
  },
);

export default registerContentModifier;
