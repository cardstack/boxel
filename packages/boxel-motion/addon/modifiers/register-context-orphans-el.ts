import AnimationContextComponent from '@cardstack/boxel-motion/components/animation-context';
import { modifier } from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [component: AnimationContextComponent];
  };
}

const registerContextOrphansEl = modifier<Signature>(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertOrphansEl(element);
  },
  { eager: false }
);

export default registerContextOrphansEl;
