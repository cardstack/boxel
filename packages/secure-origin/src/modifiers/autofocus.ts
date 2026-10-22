import { modifier } from './modifier.ts';

// Focuses its element once it is drawn: `{{autofocus}}`, or
// `{{autofocus this.condition}}` to focus only when the condition holds.
export const autofocus = modifier(
  (element: HTMLElement, focus: boolean = true) => {
    if (focus) {
      element.focus();
    }
  },
);
