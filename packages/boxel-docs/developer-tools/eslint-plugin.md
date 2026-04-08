# ESLint Plugin

`eslint-plugin-boxel` provides custom ESLint rules specific to Boxel card development. These rules enforce best practices and prevent common mistakes.

## Installation

The plugin is included in the Boxel monorepo. For external projects:

```bash
npm install @cardstack/eslint-plugin-boxel --save-dev
```

## Configuration

```javascript
// .eslintrc.js
module.exports = {
  plugins: ['@cardstack/eslint-plugin-boxel'],
  rules: {
    '@cardstack/boxel/no-css-position-fixed': 'error',
    '@cardstack/boxel/no-literal-realm-urls': 'error',
    '@cardstack/boxel/no-forbidden-head-tags': 'warn',
    '@cardstack/boxel/template-missing-invokable': 'error',
    '@cardstack/boxel/missing-card-api-import': 'error',
    '@cardstack/boxel/no-duplicate-imports': 'error',
  },
};
```

## Rules

### `no-css-position-fixed`

**Severity:** error | **Fixable:** no

Prevents use of `position: fixed` in card CSS. Cards must stay within their bounding box — fixed positioning would break the card containment model.

```css
/* ❌ Error */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
}

/* ✅ OK */
.overlay {
  position: absolute;
  top: 0;
  left: 0;
}
```

### `no-literal-realm-urls`

**Severity:** error | **Fixable:** yes

Prevents hardcoded realm URLs in card code. Use portable prefixes instead:

```typescript
// ❌ Error — hardcoded URL
import StringField from 'http://localhost:4201/base/string';

// ✅ OK — portable URL
import StringField from 'https://cardstack.com/base/string';
```

The auto-fix replaces known hardcoded URLs with their portable equivalents.

### `no-forbidden-head-tags`

**Severity:** warning | **Fixable:** no

Restricts tags in `<static head>` blocks to only: `<title>`, `<meta>`, `<link>`.

```typescript
// ❌ Warning — script not allowed
<static head>
  <script src="..."></script>
</static>

// ✅ OK
<static head>
  <title>My Card</title>
  <meta name="description" content="..." />
</static>
```

### `template-missing-invokable`

**Severity:** error | **Fixable:** yes

Auto-fixes missing imports for template helpers, modifiers, and components:

```typescript
// Before fix — `on` modifier not imported
<template>
  <button {{on "click" this.handleClick}}>Click</button>
</template>

// After fix — import added automatically
import { on } from '@ember/modifier';
```

### `missing-card-api-import`

**Severity:** error | **Fixable:** yes

Detects and auto-fixes missing imports from the card API:

```typescript
// Before fix
export class MyCard extends CardDef {
  @field name = contains(StringField);
}

// After fix — missing imports added
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
```

Configurable via `importMappings` option for custom import sources.

### `no-duplicate-imports`

**Severity:** error | **Fixable:** yes

Prevents multiple import declarations from the same module:

```typescript
// ❌ Error — duplicate imports
import { CardDef } from 'https://cardstack.com/base/card-api';
import { field } from 'https://cardstack.com/base/card-api';

// ✅ OK — combined
import { CardDef, field } from 'https://cardstack.com/base/card-api';
```

## Summary

| Rule | Auto-fix | Recommended | Purpose |
|------|----------|-------------|---------|
| `no-css-position-fixed` | No | Yes | Card containment |
| `no-literal-realm-urls` | Yes | Yes | Portability |
| `no-forbidden-head-tags` | No | Yes | Security |
| `template-missing-invokable` | Yes | Yes | DX |
| `missing-card-api-import` | Yes | Yes | DX |
| `no-duplicate-imports` | Yes | Yes | Code quality |

## Next Steps

- [Styling Cards](/card-development/styling) — CSS guidelines
- [Boxel CLI](/developer-tools/cli) — CLI tools
- [Testing](/developer-tools/testing) — Test setup
