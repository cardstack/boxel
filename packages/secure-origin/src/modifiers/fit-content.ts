import { modifier } from './modifier.ts';

// Makes a textarea as tall as what it holds, lines it wraps included, where
// the browser doesn't already size it by its content (`field-sizing:
// content`). It fits again whenever the value it is given changes:
// `{{fitContent @value}}`. The height is set through the CSSOM, which the
// secure origin's style policy allows.
export const fitContent = modifier(
  (element: HTMLTextAreaElement, _value: string | null | undefined) => {
    if (
      getComputedStyle(element).getPropertyValue('field-sizing') === 'content'
    ) {
      element.style.removeProperty('height');
      return;
    }
    element.style.setProperty('height', 'auto');
    let borders = element.offsetHeight - element.clientHeight;
    element.style.setProperty('height', `${element.scrollHeight + borders}px`);
  },
);
