import { find } from '@ember/test-helpers';

import { HINTS } from '@cardstack/pretui/password-managers';

// Every control a person types into, leaving out checkboxes, radio buttons
// and file pickers, which no password manager fills.
const TYPED_INTO =
  'input:not([type="checkbox"], [type="radio"], [type="file"], [type="hidden"]), textarea';

// Asserts that the form says it is no login (Dashlane reads the form's own
// `data-form-type`), that each of `fields` is in it, that they are every
// control typed into in it, and that each carries every password manager's
// hint to leave it alone.
export function assertNoLoginForm(
  assert: Assert,
  formSelector: string,
  fields: string[],
) {
  let form = find(formSelector);
  if (!form) {
    assert.ok(false, `${formSelector} is drawn`);
    return;
  }
  assert
    .dom(form)
    .hasAttribute(
      'data-form-type',
      'other',
      `${formSelector} tells Dashlane it is no login`,
    );
  for (let field of fields) {
    assert.dom(field, form).exists(`${field} is in ${formSelector}`);
  }
  let controls = [...form.querySelectorAll(TYPED_INTO)];
  assert.strictEqual(
    controls.length,
    fields.length,
    `the fields named are every one typed into in ${formSelector}`,
  );
  for (let control of controls) {
    let name = control.getAttribute('name') ?? control.id;
    for (let [hint, value] of HINTS) {
      assert.dom(control).hasAttribute(hint, value, `${name} has ${hint}`);
    }
  }
}
