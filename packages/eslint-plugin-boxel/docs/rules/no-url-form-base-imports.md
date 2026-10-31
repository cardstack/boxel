# Disallow the https://cardstack.com/base/ alias outside the positions that define or recognize it; auto-fix import specifiers to @cardstack/base/ (`@cardstack/boxel/no-url-form-base-imports`)

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Base-realm modules are addressed by the canonical `@cardstack/base/` prefix. The
URL spelling `https://cardstack.com/base/` is the base realm's registered
identity and still resolves, but new code should not spell it: bulk renames and
copy-paste tend to bring it back.

## Import positions

This rule flags (and auto-fixes) the URL-form specifier in:

- static `import`/`export … from` declarations
- dynamic `import(…)` expressions
- loader-style dynamic imports (`loader.import(…)`, any `.import(…)` call)
- `importResource(this, () => …)`, whose thunk returns the specifier
- `typeof import(…)` in a type position

A specifier written as a template literal is flagged when its leading spelling is
the URL form: the text before the first interpolation, a string literal
interpolated first (`` `${'https://cardstack.com/base/'}card-api` ``), or
`baseRealm.url` interpolated first (`` `${baseRealm.url}card-api` ``).

A specifier built from `baseRealm.url` with `+` or `new URL(path, baseRealm.url)`
(or its `.href`) is flagged too, without a fix, since it has no spelling to
rewrite.

## Every other position

Anywhere else, a string or template literal that contains the alias is flagged,
as is a `<template>`'s text, attribute value or string argument that contains it.
So is the alias built from `baseRealm.url`, the constant that holds it: a
template that appends a path to it (`` `${baseRealm.url}cards/skill` ``),
`baseRealm.url + path`, and `new URL(path, baseRealm.url)` each spell an
alias-form resource. Reading `baseRealm.url` on its own is not flagged, nor is
embedding it whole in a larger string (`` `[data-test-realm-url="${baseRealm.url}"]` ``):
that is the base realm's registered URL, which the constant exists to name.
None of these is flagged where it sits in one of the positions that define the
alias or recognize data written in it:

- the initializer of `baseRealm`;
- the functions `equivalentURLForms`, `internalKeyFor` and
  `registeredRealmURL`;
- a test of alias tolerance, canonicalization or migration, which a package's
  ESLint config names and gives the `allowAliasOutsideImports` option.

Code that recognizes legacy alias data somewhere else disables the rule on that
line, and the reason says what it recognizes. The base realm's registration and
permission rows live in realm-server configuration, which this rule does not
lint, and tsconfig `paths` are JSON.

Where the base realm's registered URL is meant, read `baseRealm.url`. Where a
base-realm resource is named, write `@cardstack/base/…`, or build it with
`baseRRI(path)`.

Only one of these is auto-fixed: a string that is the whole `module` of a code
ref, which is rewritten to `@cardstack/base/…`. Anywhere else the alias may be a
URL something fetches or compares, so the rule leaves the rewrite to the author.

## Options

### `allowAliasOutsideImports`

`true` stops the rule from reporting the alias outside import positions in the
files it applies to. Import positions are still checked. It is meant for an
override that lists tests of alias tolerance, canonicalization or migration.

### `allowBaseRealmURLPaths`

`true` stops the rule from reporting the alias built from `baseRealm.url`
outside import positions: a template that appends a path to it,
`baseRealm.url + path`, and `new URL(path, baseRealm.url)`. The alias spelled
out is still reported, and import positions are still checked. It is meant for
an override that lists files a remediation entry names as building alias-form
resources this way, and keeps the spelled-out alias out of them.

## Examples

Incorrect:

```js
import { CardDef } from 'https://cardstack.com/base/card-api';
let api = await loader.import('https://cardstack.com/base/card-api');
let mod = await import(`https://cardstack.com/base/${name}`);
let ref = { module: 'https://cardstack.com/base/spec', name: 'Spec' };
let skillId = `${baseRealm.url}cards/skill`;
let canary = new URL('card-api', baseRealm.url).href;
```

Correct:

```js
import { CardDef } from '@cardstack/base/card-api';
let api = await loader.import('@cardstack/base/card-api');
let mod = await import(`@cardstack/base/${name}`);
let ref = { module: '@cardstack/base/spec', name: 'Spec' };
let skillId = baseRRI('cards/skill');
let isBase = realmURL === baseRealm.url;
```
