import AnimationContextComponent from '@cardstack/boxel-motion/components/animation-context';
import { modifier } from 'ember-modifier';

const registerContextOrphansEl = modifier(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertOrphansEl(element);
  },
  { eager: false }
);

export default registerContextOrphansEl;
