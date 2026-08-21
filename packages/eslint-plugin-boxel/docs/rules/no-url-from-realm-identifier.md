# Disallow constructing a URL from a realm identifier, which throws for the canonical prefix form (`@cardstack/boxel/no-url-from-realm-identifier`)

<!-- end auto-generated rule header -->

`RealmIdentifier` and `RealmResourceIdentifier` are branded strings:

```ts
type RealmResourceIdentifier = string & { __rriBrand: unknown };
```

Because the brand lives only in the type system, `new URL(identifier)`
typechecks. At runtime it succeeds for an identifier that happens to be spelled
as a URL and throws `TypeError: Invalid URL` for the canonical prefix form —
`@cardstack/base/card-api`. The compiler is structurally unable to tell those
apart, so the defect surfaces only in whichever realm happens to be
prefix-mapped at the time. This rule asks the question the compiler cannot: does
this value carry an identifier brand?

## Type information is required

The rule reads types, so it reports only where the ESLint config sets
`parserOptions.project`. Everywhere else it is inert rather than wrong, which is
why it can be enabled broadly and given type information one package at a time.

## Examples

Incorrect:

```ts
let url = new URL(identifier);
let url = new URL(card.id); // `id` is a RealmResourceIdentifier
```

Correct:

```ts
// Path work — RealmPaths accepts an identifier and stays in that form.
let paths = new RealmPaths(realmIdentifier);

// A genuine network boundary — resolve through the VirtualNetwork.
let url = virtualNetwork.toURL(identifier);
```

If a site really is the boundary where an identifier becomes a URL, disable the
rule on that line with a comment saying why.
