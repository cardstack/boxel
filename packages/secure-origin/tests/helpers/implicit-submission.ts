// The browser submits a form on Enter in one of its fields when the form has
// a submit button; a synthetic key press doesn't, so a test pins what
// implicit submission needs: the button is the form's one submit button, and
// every field is in the form.
export function assertEnterSubmits(
  assert: Assert,
  formSelector: string,
  submitSelector: string,
) {
  let form = document.querySelector<HTMLFormElement>(formSelector)!;
  let submit = document.querySelector<HTMLButtonElement>(submitSelector)!;
  assert.strictEqual(submit.type, 'submit', 'the button submits');
  assert.strictEqual(submit.form, form, 'the button is in the form');
  assert.deepEqual(
    [...form.elements]
      .filter(
        (element) =>
          element instanceof HTMLButtonElement && element.type === 'submit',
      )
      .map((element) => element === submit),
    [true],
    'it is the form’s only submit button',
  );
  for (let input of form.querySelectorAll('input')) {
    assert.strictEqual(input.form, form, `${input.name} is in the form`);
  }
}
