# Testing

Boxel has a comprehensive testing architecture with five separate test suites covering the full stack.

## Test Suites

| Suite | Framework | Package | Focus |
|-------|-----------|---------|-------|
| **Host Tests** | QUnit + Ember Test Helpers | `packages/host` | UI components, services, integration |
| **Realm Server Tests** | Node.js + QUnit | `packages/realm-server` | API endpoints, indexing, search |
| **Boxel UI Tests** | QUnit + Ember | `packages/boxel-ui/test-app` | Component library |
| **Matrix Tests** | Playwright | `packages/matrix` | E2E with Synapse integration |
| **Software Factory Tests** | Playwright | `packages/software-factory` | Factory workflow E2E |

## Running Tests

### Host Tests

```bash
cd packages/host

# Start test services
mise run test:host-services

# Run all tests
pnpm test

# Run specific test file
pnpm test --filter "card-rendering"

# Run in browser (interactive)
pnpm test:ember --server
# Then open http://localhost:4200/tests
```

### Realm Server Tests

```bash
cd packages/realm-server

# Start test services
mise run test:realm-services

# Run tests
pnpm test

# Run specific test
pnpm test --grep "search endpoint"
```

### Boxel UI Tests

```bash
cd packages/boxel-ui/test-app

# Run tests
pnpm test
```

### Matrix Tests

```bash
cd packages/matrix

# Start test infrastructure (Synapse, SMTP)
mise run test:matrix-services

# Run Playwright tests
pnpm test

# Run with UI
pnpm test --ui
```

### Other Package Tests

```bash
# Runtime common
cd packages/runtime-common && pnpm test

# Base
cd packages/base && pnpm test

# AI bot
cd packages/ai-bot && pnpm test

# Billing
cd packages/billing && pnpm test

# PostgreSQL
cd packages/postgres && pnpm test
```

## Type Checking

Boxel uses **Glint** (not `tsc`) for type checking:

```bash
# Type check a package
cd packages/host
pnpm glint
```

Glint understands Glimmer templates and can type-check template expressions.

## Test Patterns

### Card Tests

```typescript
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';

module('Integration | Card | BlogPost', function(hooks) {
  setupRenderingTest(hooks);

  test('renders title', async function(assert) {
    const card = new BlogPost();
    card.title = 'Hello World';

    await render(<template>
      <card.constructor.isolated @model={{card}} />
    </template>);

    assert.dom('h1').hasText('Hello World');
  });
});
```

### Realm Server Tests

```typescript
import { module, test } from 'qunit';

module('Realm Server | Search', function() {
  test('filters by card type', async function(assert) {
    const response = await fetch('/_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: {
          type: { module: './blog-post', name: 'BlogPost' }
        }
      })
    });

    assert.strictEqual(response.status, 200);
    const results = await response.json();
    assert.ok(results.data.length > 0);
  });
});
```

## Test Selectors

Use `data-test-*` attributes for test selectors:

```typescript
<template>
  <div data-test-card-title>{{@model.title}}</div>
  <button data-test-save-button {{on "click" this.save}}>Save</button>
</template>
```

```typescript
assert.dom('[data-test-card-title]').hasText('Hello');
await click('[data-test-save-button]');
```

> **Note:** `data-test-*` attributes are stripped in production builds. Never use them for runtime logic.

## Visual Regression Testing

The Host App uses **Percy** for visual regression testing:

```bash
# Run Percy snapshots
PERCY_TOKEN=... pnpm percy exec -- pnpm test
```

## CI/CD

GitHub Actions runs all test suites on every PR:

| Workflow | Tests |
|----------|-------|
| `ci.yaml` | Full test suite |
| `ci-host.yaml` | Host app tests |
| `ci-lint.yaml` | Linting and type checks |

### Debugging CI Failures

```bash
# Extract test failures from GitHub Actions
node scripts/ci-failures.js <run-id>

# Bisect CI failures
scripts/ci-bisect.sh <good-sha> <bad-sha>
```

## CSS Testing Guidelines

- Use `rem` units (not `px`)
- Use CSS variables from the Boxel design system
- Avoid `position: fixed` (ESLint rule enforces this)

## `.gts` File Gotcha

When writing tests for `.gts` files, be aware that regex literals can conflict with the GTS parser. Use `new RegExp()` instead:

```typescript
// ❌ May break GTS parser
const pattern = /something/;

// ✅ Safe in GTS
const pattern = new RegExp('something');
```

## Next Steps

- [Installation & Setup](/guide/installation) — Development environment
- [Project Structure](/guide/project-structure) — Monorepo layout
- [ESLint Plugin](/developer-tools/eslint-plugin) — Linting rules
