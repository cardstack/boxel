// Pretui — alsoDescribedBy: a caller's description ids on a control whose own
// `aria-describedby` boxel-ui writes.
//
// BoxelInput names its error and helper rows in `aria-describedby` itself, so
// a caller's attribute passed through `...attributes` would replace them. This
// modifier puts the caller's ids ahead of the ones the control wrote. The
// modifier's other positional values are what the control's own ids depend on
// (whether it is invalid, its error and helper text): when one changes, the
// control writes its attribute again and the modifier runs again after it.
import { modifier } from 'ember-modifier';

function idsOf(value: string | null | undefined): string[] {
  return (value ?? '').split(/\s+/).filter(Boolean);
}

export const alsoDescribedBy = modifier(
  (element: Element, [ids]: [string | undefined, ...unknown[]]) => {
    let extra = idsOf(ids);
    if (extra.length === 0) {
      return;
    }
    let own = idsOf(element.getAttribute('aria-describedby')).filter(
      (id) => !extra.includes(id),
    );
    element.setAttribute('aria-describedby', [...extra, ...own].join(' '));
    return () => {
      let rest = idsOf(element.getAttribute('aria-describedby')).filter(
        (id) => !extra.includes(id),
      );
      if (rest.length > 0) {
        element.setAttribute('aria-describedby', rest.join(' '));
      } else {
        element.removeAttribute('aria-describedby');
      }
    };
  },
);
