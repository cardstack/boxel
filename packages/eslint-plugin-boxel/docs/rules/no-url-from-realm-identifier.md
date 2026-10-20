# Disallow passing a realm identifier to a URL constructor or parse probe, which mishandles the canonical prefix form (`@cardstack/boxel/no-url-from-realm-identifier`)

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

## Three ways to ask "is this a URL"

All three mishandle the prefix form, so all three are checked:

|                                      | prefix-form behaviour                     |
| ------------------------------------ | ----------------------------------------- |
| `new URL(id)`                        | throws                                    |
| `new URL(path, id)`                  | throws — a prefix is not a valid base URL |
| `URL.canParse(id)` / `URL.parse(id)` | returns `false` / `null`                  |

The probe forms are the quietest and so the most dangerous: a caller reads
"not a URL" and carries on, usually classifying the identifier as a relative
path. Ask `virtualNetwork.isRegisteredPrefix(x)` before asking whether a value
parses.

A base argument does not make it safe. `new URL(identifier, base)` does not
throw, because the prefix form is a valid relative reference — it resolves to
`base` with `@cardstack/base/card-api` appended, a URL that points nowhere. The
silent version of the defect is the harder one to find.

## What propagates the brand

A branded string is a subtype of `string`, so TypeScript reduces
`RealmResourceIdentifier | string` to plain `string`. An identifier that has been
through a ternary, a concatenation, or a template literal therefore has no brand
left on it, while still being an identifier at runtime. The rule walks those
forms rather than only reading the argument's own type, and follows a `const`
binding to its initializer.

Only what fixes the _leading_ spelling counts. `` `${id}.gts` `` is still an
identifier, but `` `https://example.test/x/${id}` `` parses whatever `id` holds,
so an interpolation behind a literal prefix is not reported.

## Type information is required

The rule reads types, so it reports only where the ESLint config sets
`parserOptions.project`. Without a TypeScript program it reports nothing, so a
package that enables it must also give it one.

## Examples

Incorrect:

```ts
let url = new URL(identifier);
let url = new URL(card.id); // `id` is a RealmResourceIdentifier
```

Correct:

```ts
// A request — the VirtualNetwork resolves the identifier as it sends it.
let response = await virtualNetwork.fetch(identifier);

// Path work — RealmPaths accepts an identifier and stays in that form.
let paths = new RealmPaths(realmIdentifier);
```

`virtualNetwork.toURL(identifier)` resolves too, for the rare caller that needs
the URL for something other than a request.

Disable the rule on a line only where a guard on the same path admits nothing
but URL form, and name that guard in the reason. A `catch` around the parse is
not a guard: it hides the prefix-form failure instead of excluding it.
