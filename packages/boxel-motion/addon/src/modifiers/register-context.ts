import type AnimationContextComponent from '../components/animation-context.gts';
import { modifier } from 'ember-modifier';

const registerContentModifier = modifier(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertEl(element);
  },
);

export default registerContentModifier;
