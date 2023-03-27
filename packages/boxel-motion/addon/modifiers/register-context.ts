import AnimationContextComponent from '@cardstack/boxel-motion/components/animation-context';
import { modifier } from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [component: AnimationContextComponent];
  };
}

const registerContentModifier = modifier<Signature>(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertEl(element);
  },
  { eager: false }
);

export default registerContentModifier;
