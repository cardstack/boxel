# Disallow URL-form base-module import specifiers; use @cardstack/base/ with auto-fix (`@cardstack/boxel/no-url-form-base-imports`)

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Base-realm modules are addressed by the canonical `@cardstack/base/` prefix. The
URL spelling `https://cardstack.com/base/` still resolves at runtime, but code
should not reintroduce it in import positions — bulk renames and copy-paste
tend to bring it back.

This rule flags (and auto-fixes) the URL-form specifier in:

- static `import`/`export … from` declarations
- dynamic `import(…)` expressions
- loader-style dynamic imports (`loader.import(…)`, any `.import(…)` call)

It deliberately ignores the URL in other positions — fetch targets, alias
registration (e.g. `VirtualNetwork` mappings), and test assertions about served
content are legitimate uses of the URL form.

## Examples

Incorrect:

```js
import { CardDef } from 'https://cardstack.com/base/card-api';
let api = await loader.import('https://cardstack.com/base/card-api');
```

Correct:

```js
import { CardDef } from '@cardstack/base/card-api';
let api = await loader.import('@cardstack/base/card-api');
```
