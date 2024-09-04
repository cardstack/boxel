import AnimationContextComponent from '@cardstack/boxel-motion/components/animation-context';
import { modifier } from 'ember-modifier';

const registerContentModifier = modifier(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertEl(element);
  },
);

export default registerContentModifier;
