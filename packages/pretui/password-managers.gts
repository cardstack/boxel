// Pretui — telling password managers to leave a field alone.
//
// A password manager guesses which fields on a page take a username or a
// password, and a plain text field with no name looks like a username to it:
// it fills the saved login in, or puts its icon in the field. No login belongs
// in a field the app draws outside the secure origin, so a text field drawn
// there takes this modifier, which sets the hint every password manager reads.
// Each field opts in, and nothing checks for one that doesn't.
// `autocomplete="off"` is no substitute: LastPass fills a field that says it
// regardless.
//
// The secure origin's sign-in, sign-up and password fields must never carry
// these hints, so this is something a caller adds, never a default of an
// input component.
//
// Two copies of this list set the same hints where this module can't be
// imported. Base's field templates use base's own copy
// (`packages/base/components/password-managers.ts`), because card-api must
// load without Pret UI. boxel-ui's Picker writes the list into its search field
// (`packages/boxel-ui/src/components/picker/before-options-with-search.gts`),
// because boxel-ui can't import Pret UI. Keep the attributes the same in all
// three.
import { modifier } from 'ember-modifier';

// Each password manager's own attribute for skipping a field.
const HINTS: [name: string, value: string][] = [
  // 1Password
  ['data-1p-ignore', ''],
  // LastPass
  ['data-lpignore', 'true'],
  // Dashlane
  ['data-form-type', 'other'],
  // Bitwarden, which honors it once its user turns that setting on.
  ['data-bwignore', ''],
];

const CONTROLS = 'input, textarea, select';

/** Marks the element as a field no password manager fills or decorates. On
 * an element that isn't a form control, such as the wrapper an input group
 * puts a caller's modifiers on, it marks the form controls inside it once,
 * when it is installed. A control drawn inside that element later carries
 * no hint, so a control that comes and goes takes the modifier itself. */
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
