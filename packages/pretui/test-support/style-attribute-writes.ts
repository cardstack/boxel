// Test support for Pret UI's component tests. Listed in `.boxelignore`, so the
// realm doesn't serve it.
//
// Every `style` attribute written while `work` runs. Glimmer binds `style`
// with `setAttribute`, which a strict Content Security Policy (the secure
// origin's) refuses; a CSSOM write (`element.style.setProperty`) doesn't go
// through it and is allowed.
export async function styleAttributeWrites(work: () => Promise<void>): Promise<string[]> {
  let writes: string[] = [];
  let setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (name.toLowerCase() === 'style') {
      writes.push(value);
    }
    return setAttribute.call(this, name, value);
  };
  try {
    await work();
  } finally {
    Element.prototype.setAttribute = setAttribute;
  }
  return writes;
}
