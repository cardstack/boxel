# isPrefixForm() and the base alias's allowed positions

## Goal

Give code one way to test an identifier's form, and make
`no-url-form-base-imports` allow the `https://cardstack.com/base/` alias only
where the alias is defined or recognized.

## Steps

1. Add `isPrefixForm()` to `runtime-common/realm-identifiers.ts`, exported
   through `@cardstack/runtime-common` to host, base and card code. Point the
   `no-url-from-realm-identifier` probe message at it.
2. Convert the `startsWith('@')` form tests on identifiers in base, host/app and
   runtime-common. `isUrlLike` and base's `httpURL` answer different questions
   (relative-or-URL, and "is this an absolute http(s) URL"), so they stay.
3. `no-url-form-base-imports` reports a string or template literal containing
   the alias in any non-import position, without a fix, except:
   - the initializer of `baseRealm`;
   - the functions `equivalentURLForms`, `internalKeyFor`, `registeredRealmURL`;
   - files a package config gives `allowAliasOutsideImports` (tests of alias
     tolerance, canonicalization or migration).
     Other legacy-alias recognizers carry a line disable that names what they
     recognize. It also reads `typeof import('…')` as an import position.
4. Convert the host test hits: card JSON module refs and card source imports to
   `@cardstack/base/…`, and rendered/served ids to `baseRealm.url`.
5. Convert pretui theme-frame's Theme query ref to prefix form, which the index
   matches under either spelling.

## Testing

- Plugin tests; lint and types in runtime-common, base, pretui, host.
- Host test runs for the modules whose fixtures changed, and a unit test for
  `isPrefixForm`.
