import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// Which pages tell password managers to leave their fields alone, read from
// the source so every state a page can draw is covered, not only those the
// component tests render. The component tests check the attributes reach the
// controls themselves (tests/helpers/password-managers.ts).

const SRC = new URL('../src/', import.meta.url);
const KEYS = new URL('shell/keys/', SRC);

function sources(dir: URL): [name: string, source: string][] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(gts|ts|js)$/.test(name))
    .map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]);
}

test('every field and form on a key page tells password managers to skip it', () => {
  let fields = 0;
  let forms = 0;
  for (let [name, source] of sources(KEYS)) {
    for (let [field] of source.matchAll(/<(?:Input|Textarea)\b[\s\S]*?\/>/g)) {
      fields++;
      assert.match(
        field,
        /\{\{ignoredByPasswordManagers\}\}/,
        `${name}: a field with no {{ignoredByPasswordManagers}}:\n${field}`,
      );
    }
    for (let [form] of source.matchAll(/<form\b[\s\S]*?>/g)) {
      forms++;
      assert.match(
        form,
        /\bdata-form-type='other'/,
        `${name}: a form with no data-form-type='other':\n${form}`,
      );
    }
  }
  assert.ok(fields > 0, 'the key pages have fields');
  assert.ok(forms > 0, 'the key pages have forms');
});

// A password manager must keep filling and saving the Boxel login on the
// sign-in, sign-up and password-reset screens and in the credential fields.
test('no page but the key pages carries a password-manager hint', () => {
  for (let [name, source] of sources(SRC)) {
    if (name.startsWith('shell/keys/')) {
      continue;
    }
    assert.doesNotMatch(
      source,
      /ignoredByPasswordManagers|data-1p-ignore|data-lpignore|data-bwignore|data-form-type/,
      `${name} carries a password-manager hint`,
    );
  }
});
