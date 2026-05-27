import { modifier } from 'ember-modifier';

const autoFocus = modifier((element: HTMLElement) => {
  element.focus();
});

export default autoFocus;
