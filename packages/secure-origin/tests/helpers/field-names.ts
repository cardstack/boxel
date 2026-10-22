// The name each of the rendered page's inputs is announced by: the text of the element
// its `aria-labelledby` names. It must be the field's label alone, never with
// the field's error message, which a wrapping <label> would add to it.
export function fieldNames(): Record<string, string | undefined> {
  return Object.fromEntries(
    [
      ...document.querySelectorAll<HTMLInputElement>(
        '#ember-testing input[name]',
      ),
    ].map((input) => {
      let ids = input.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
      let names = ids
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      return [input.name, names.length ? names.join(' ') : undefined];
    }),
  );
}
