# QUnit Card Testing

How to write `.test.gts` files for card definitions, runnable with `boxel test`.

## Where files live

- **Test files** (`.test.gts`) are co-located with the card definitions they test (e.g., `sticky-note.gts` and `sticky-note.test.gts`)
- **Card definitions** (`.gts`) and **Catalog Spec cards** (`Spec/*.json`) live in the same realm — tests reference them but don't modify them

## Writing a test file

Every test file must:

1. Import `module` and `test` from `'qunit'`
2. Import `setupCardTest` from `'@cardstack/host/tests/helpers'`
3. Import `renderCard` from `'@cardstack/host/tests/helpers/render-component'`
4. Import `getService` from `'@universal-ember/test-support'`
5. Use `import.meta.url` to resolve the co-located card definition — never hardcode realm URLs
6. Export a `runTests()` function that registers QUnit modules and tests
7. Keep all test data in browser memory — no external realm writes during tests
8. Use `data-test-*` attributes for DOM assertions (not CSS classes)

### Complete example

```typescript
// sticky-note.test.gts — co-located with sticky-note.gts
import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./sticky-note', import.meta.url).href;

export function runTests() {
  module('StickyNote', function (hooks) {
    setupCardTest(hooks);

    test('renders heading in fitted view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<string, any>;
      let note = new StickyNote({ heading: 'Test Note', body: 'Hello' });
      await renderCard(loader, note, 'fitted');
      assert.dom('[data-test-heading]').hasText('Test Note');
    });

    test('renders body in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<string, any>;
      let note = new StickyNote({ heading: 'Test Note', body: 'Hello World' });
      await renderCard(loader, note, 'isolated');
      assert.dom('[data-test-body]').hasText('Hello World');
    });
  });
}
```

## Available shimmed modules

The following modules are available in the `boxel test` environment:

- `qunit` — `module`, `test`, `skip`, `todo`, `only`
- `@cardstack/host/tests/helpers` — General test helpers including `setupCardTest(hooks)`
- `@cardstack/host/tests/helpers/setup` — `setupRenderingTest(hooks)`, `setupApplicationTest(hooks)`
- `@cardstack/host/tests/helpers/render-component` — `renderCard(loader, card, format)`
- `@cardstack/host/tests/helpers/mock-matrix` — Mock Matrix service helpers
- `@cardstack/host/tests/helpers/adapter` — Test adapter utilities
- `@cardstack/host/tests/helpers/base-realm` — Base realm helpers
- `@universal-ember/test-support` — `getService`, `settled`, etc.
- `@ember/owner` — Ember owner lookup
- `@cardstack/runtime-common` — `baseRealm` and other runtime utilities

## Key patterns

### Resolving card definitions with `import.meta.url`

Always use `import.meta.url` to resolve co-located card definitions. This makes tests portable across realms:

```typescript
let cardModuleUrl = new URL('./sticky-note', import.meta.url).href;

// Then in the test:
let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<string, any>;
```

### Typing the dynamic import

`loader.import()` returns `{}` by default, so destructuring a named export fails type-checking with "Property does not exist on type '{}'":

```typescript
// ❌ WRONG — "Property 'StickyNote' does not exist on type '{}'"
let { StickyNote } = await loader.import(cardModuleUrl);

// ✅ CORRECT — cast the import result
let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<string, any>;
```

### `setupCardTest(hooks)`

Call this in every module to set up the card runtime environment:

```typescript
module('MyCard', function (hooks) {
  setupCardTest(hooks);
  // tests go here
});
```

This sets up rendering, local indexing, mock Matrix, card logs, and an in-memory realm.

### `renderCard(loader, card, format)`

Render a card in a specific format for DOM assertions:

```typescript
let loader = getService('loader-service').loader;
let { MyCard } = (await loader.import(cardModuleUrl)) as Record<string, any>;
let card = new MyCard({ heading: 'Test' });
await renderCard(loader, card, 'fitted');
```

Supported formats: `'fitted'`, `'isolated'`, `'embedded'`, `'edit'`

### QUnit assertions

- `assert.dom('[data-test-*]').hasText('...')` — Check element text
- `assert.dom('[data-test-*]').exists()` — Check element presence
- `assert.dom('[data-test-*]').hasClass('...')` — Check CSS class
- `assert.strictEqual(actual, expected, message)` — Strict equality
- `assert.ok(value, message)` — Truthiness check
- `assert.deepEqual(actual, expected, message)` — Deep equality

### `data-test-*` attribute conventions

Add `data-test-*` attributes to card templates for stable test selectors:

```gts
<template>
  <div data-test-sticky-note>
    <h2 data-test-heading>{{@model.heading}}</h2>
    <p data-test-body>{{@model.body}}</p>
  </div>
</template>
```

## Rules

- **All test data lives in browser memory only** — never write to external realms during tests.
- **Use `import.meta.url`** to resolve card definitions — never hardcode realm URLs.
- **Use `data-test-*` attributes** for stable test selectors, not CSS classes.
- **Name test files `{card-name}.test.gts`**, co-located with the card definition they test.
