import { modifier } from 'ember-modifier';

// Sets CSS custom properties one by one and keeps them current as they
// change. Unlike a bound style attribute it never rewrites the element's
// inline style, so transforms Choreo writes during motion survive a
// re-render; unlike motion's style argument, it is not applied only once.
export default modifier(
  (
    element: HTMLElement,
    [variables]: [Record<string, string | null | undefined>],
  ) => {
    for (let [name, value] of Object.entries(variables)) {
      if (value == null) element.style.removeProperty(name);
      else element.style.setProperty(name, value);
    }
  },
);
