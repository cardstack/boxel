import AnimationContextComponent from 'animations-experiment/components/animation-context';
import { modifier } from 'ember-modifier';

export default modifier(
  (element: HTMLElement, [component]: [AnimationContextComponent]) => {
    component.didInsertOrphansEl(element);
  }
);
