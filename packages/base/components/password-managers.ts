// Base's copy of Pret UI's `ignoredByPasswordManagers`
// (`@cardstack/pretui/password-managers`): it marks a field so no password
// manager fills the saved Boxel login into it, or puts its icon there. Base's
// field templates use it, card-api's among them.
//
// Base keeps its own copy rather than importing Pret UI's, because card-api
// loads anywhere base and the host's shimmed packages do. That includes a
// loader that fetches base from its realm and maps no pretui realm, and
// `boxel parse`, which resolves base's imports but not Pret UI's. The host
// bundles this module (see BUNDLED_BASE_MODULES) as it bundles card-api.
// Keep the attributes the same as Pret UI's.
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
