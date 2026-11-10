// Pretui — telling password managers to leave a field alone.
//
// A password manager guesses which fields on a page take a username or a
// password, and a plain text field with no name looks like a username to it:
// it fills the saved login in, or puts its icon in the field. Every field the
// app draws outside the secure origin is one no login belongs in, so each
// carries the hint every password manager reads. `autocomplete="off"` is no
// substitute: LastPass fills a field that says it regardless.
//
// The secure origin's sign-in, sign-up and password fields must never carry
// these hints, so this is something a caller adds, never a default of an
// input component.
import { modifier } from 'ember-modifier';

// Each password manager's own attribute for skipping a field.
const HINTS: [name: string, value: string][] = [
  // 1Password
  ['data-1p-ignore', ''],
  // LastPass
  ['data-lpignore', 'true'],
  // Dashlane
  ['data-form-type', 'other'],
  // Bitwarden, which honours it once its user turns that setting on.
  ['data-bwignore', ''],
];

const CONTROLS = 'input, textarea, select';

/** Marks the element as a field no password manager fills or decorates. On
 * an element that isn't a form control, such as the wrapper an input group
 * puts a caller's modifiers on, it marks each form control inside it as it
 * is drawn. */
export const ignoredByPasswordManagers = modifier((el: Element) => {
  let controls = el.matches(CONTROLS)
    ? [el]
    : Array.from(el.querySelectorAll(CONTROLS));
  for (let control of controls) {
    for (let [name, value] of HINTS) {
      control.setAttribute(name, value);
    }
  }
});
