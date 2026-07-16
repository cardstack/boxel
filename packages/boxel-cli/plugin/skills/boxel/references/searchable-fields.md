# Searchable Fields

A card's **search doc** is the flattened JSON the index queries against. Every **contained** field is always in it. The `searchable` field option decides which **links** (`linksTo` / `linksToMany`) are followed into the doc — i.e. which linked cards get pulled in rather than left as a bare reference.

```ts
type Searchable = true | string | string[];
```

```gts
@field author = linksTo(Author, { searchable: true });
@field authors = linksToMany(Author, { searchable: 'address.country' });
```

## The one invariant: contained is always in, links are opt-in

- **Contained fields are always included** — for the card being indexed and for every card pulled into the doc. `searchable` never touches them; a `contains` / `containsMany` value is in the doc because its owner is.
- **A link is captured as a bare reference unless you make it searchable** — a `linksTo` as its target's `{ id }`, a `linksToMany` as an array of `{ id }` refs. Not annotated ⇒ just the reference(s). Annotated ⇒ the target card(s) are pulled in, and (being cards in the doc) all of *their* contained fields come along automatically.

This shallow-by-default behavior for links is the whole point: a search doc includes exactly the linked cards you name, nothing more.

## `true` vs a dotted path

There is no path segment that names "this link itself" — paths name the *next* link and beyond. So:

- **`searchable: true`** — make **this** link (the immediate, "self" link) searchable. Its target is pulled in; the target's own links stay `{ id }`.
- **a dotted path** — make a **deeper** (n+1) link searchable. The path routes *from this link's target* through its links, pulling in every card along the route. To reach a deeper link through a contained `FieldDef`, name the intermediate contained field(s) as segments.
- **an array** — combine multiple routes.
- **omitted** — the link stays `{ id }` only.

```gts
@field author = linksTo(Author);
// Not searchable → { id } only.

@field author = linksTo(Author, { searchable: true });
// Author is pulled in (with all Author's contained fields). Author's own links stay { id }.

@field author = linksTo(Author, { searchable: 'address' });
// Author AND Author's `address` link are pulled in. Author's other links stay { id }.

@field authors = linksToMany(Author, { searchable: 'address.country' });
// For each linked Author: pull in address, then country — every card on the route.

@field author = linksTo(Author, { searchable: ['address', 'employer.headquarters'] });
// Two routes from Author: its address, and its employer's headquarters.

@field citations = containsMany(Citation, { searchable: 'article.author' });
// Each Citation's contained fields are always in the doc; this additionally makes
// each citation's `article` link, then that article's `author` link, searchable.

@field signOff = contains(Signoff, { searchable: 'editor' });
// Signoff's contained fields are always in the doc; this additionally makes its
// `editor` link searchable.

@field dateLine = contains(DateField);
// Contained → always fully included. searchable does not apply.
```

## Firm rules

- **Links capture the declared type only.** `linksTo(X)` / `linksToMany(X)` pulls in exactly `X`'s declared fields. A polymorphic subtype's extra contained fields are *not* captured — they are unqueryable anyway (a filter path resolves against the declared type), so the search-doc shape is fully determined by the static field definitions.
- **Querying a non-searchable path errors.** A filter whose path resolves in the schema but crosses a `linksTo` / `linksToMany` hop that was never made `searchable` throws a distinct query-time error (separate from "nonexistent field") that names the field and the annotation to add. It surfaces a forgotten annotation at the point of use instead of returning silently-empty results.

  ```gts
  // Filtering on author.name requires the author link to be searchable:
  @field author = linksTo(Author, { searchable: true });   // now `eq: { 'author.name': … }` resolves
  ```

- **Query-backed relationships are never captured.** A `linksTo` / `linksToMany` with a `query` can't be invalidated when matching cards change, so it would go stale. `searchable` is accepted but **inert** on a query-backed relationship (a valid no-op), and a path cannot route deeper through it — routing a *filter* through a query-backed hop errors like any other non-searchable hop.
- **No wildcard.** There is deliberately no "make everything searchable" form; a cyclic or high-fan-out link graph could otherwise pull an unbounded slice of the realm into one doc.
- **Cycles clip to `{ id }`; broken or not-loaded links degrade to `{ id }`.**

## Routing through FieldDefs

A `FieldDef` may declare its own `linksTo` / `linksToMany`, so a `searchable` path can route through `contains` → `linksTo` chains. Name each intermediate contained field as a segment:

```gts
class Profile extends FieldDef {
  @field lead = linksTo(Person);
  @field members = linksToMany(Person);
}

class Team extends CardDef {
  @field profile = contains(Profile, { searchable: ['lead', 'members'] });
  // profile's contained fields are always in the doc; this additionally makes
  // profile.lead and profile.members searchable (each Person pulled in).
}
```

## Authoring-time validation

An annotation path that doesn't resolve — a typo, a removed field, or a segment that isn't a relationship/contained field — is **logged and recorded in the module's build diagnostics, never thrown**. Definition build is decoupled from the edit that introduced the bad path, so a throw would surface at a confusing, unrelated moment. The bad path is simply not followed; if anything actually queries that intended path, the query-time error above is the loud backstop.

## Key principles

- Contained fields are always in the search doc; `searchable` governs links only.
- A link is `{ id }` only until made searchable; then its target (and all the target's contained fields) is pulled in.
- `searchable: true` makes the immediate link searchable; a dotted path makes a deeper (n+1) link searchable; an array combines routes.
- Links capture the declared type only.
- Query-backed relationships are never captured — `searchable` is an inert no-op on them.
- Querying a resolvable-but-non-searchable path throws a distinct error naming the annotation to add.
- There is no wildcard; cycles and broken/not-loaded links clip to `{ id }`.
