---
name: realm-policy-authoring
description: 'Use when writing, linking, or debugging a realm policy — "let teachers read their own classrooms", "let anyone signed in create a ticket", "why does this grant admit nobody", "point this realm at a policy". The reference for a `RealmPolicy` card: the `policy` pointer on `realm.json`, the `rules` → `targetType` / `grants` → `operation` / `where` shape, what a grant admits and what it never can, the create lane, writing `where` in the `policy` BXL profile (membership, the refused partial-match builtins, parentheses), which `query` grants compile to a search filter, `snapshot: true` reads, every issue code and its effect, `validate`, and the refusals a caller sees. Activates on `RealmPolicy`, `PolicyRule`, `OperationGrant`, `"policy"` in `realm.json`, `where`, `actor()` in a grant, `nonGrantable`, `operation-not-permitted`, `policy-not-filterable`, `partial-match`, `unsnapshotted-policy-read`.'
boxel:
  kind: skill
---

# Authoring a realm policy

A realm's permissions say who may read it and who may write it, realm-wide. A
**policy** lets a caller those permissions turn away do particular things to
particular cards: a teacher with no permission on the school's realm may read
the classrooms that list them as a teacher, and rename those classrooms, and
nothing else.

A policy is a card. The realm's `realm.json` names it, and its rules grant
operations on card types, each grant optionally conditioned on a BXL predicate
over the card:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "rules": [
        {
          "targetType": {
            "module": "https://school.example/education/classroom",
            "name": "Classroom"
          },
          "grants": [
            { "operation": "read", "where": ".teacherIds | any(. == actor())" },
            { "operation": "rename", "where": ".teacherIds | any(. == actor())" },
            { "operation": "query", "where": ".teacherIds | any(. == actor())" }
          ]
        }
      ]
    },
    "meta": {
      "adoptsFrom": {
        "module": "@cardstack/catalog/realm-policy/realm-policy",
        "name": "RealmPolicy"
      }
    }
  }
}
```

Most of what goes wrong with a policy does not throw. A grant the realm cannot
apply is recorded as an issue and left out, and the rest of the policy applies
without it, so the symptom is a caller who is refused for no visible reason.
Check the policy's issues (§8) after every edit.

The operations a grant names are the ones `card-operations-authoring` covers:
the base operations every card carries and the named ones a card type
declares.

## 1. Linking a policy

The pointer is the `policy` string on the realm's `RealmConfig` card —
`realm.json`, `data.attributes.policy`:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "cardInfo": { "name": "Education" },
      "policy": "https://school.example/org/policies/education"
    },
    "meta": {
      "adoptsFrom": { "module": "@cardstack/base/realm-config", "name": "RealmConfig" }
    }
  }
}
```

| `policy` holds                                         | The realm                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Nothing, `null`, or a blank string                      | Names no policy. Its permissions alone decide every request                                 |
| An absolute `http(s)` card URL                          | Is governed by that card                                                                    |
| A prefix-form id (`@cardstack/catalog/policies/…`)      | Is governed by that card, for a prefix the server maps to a realm                           |
| A relative path, an unmapped prefix, a non-`http(s)` URL, or a non-string | **Names no policy.** The value is dropped with a `realm:policy` warning and the realm serves on its permissions alone |
| A well-formed id of a card that is missing, errored, or not a `RealmPolicy` | **Refuses every caller its permissions decline**, with a 500 (§8)       |

The last two rows are the trap. A typo in the *shape* of the pointer silently
removes the policy. A well-formed pointer to the wrong card fails closed.

- **The policy card may live in another realm**, including one nobody the
  governed realm serves can read. The realm reads it from the server's index
  on its own authority, so the card must be indexed on the same server, without
  error. A pointer into a realm the server doesn't serve reads as
  `policy-card-missing`.
- **Repointing takes effect at once.** The pointer is read from `realm.json` on
  disk. Settings a predicate reads with `realmConfig()` follow the index pass of
  `realm.json`, so they can trail a direct file edit briefly.
- **A published realm names no policy.** Publishing strips `policy` from the
  published copy of `realm.json`; the published realm answers on its own
  permissions. The source realm keeps its pointer.

**Any writer of the realm can repoint it** — at another policy, at none, or at
a policy card in a realm they cannot read. The realm applies whatever it names
on the server's authority. So the policy constrains callers the realm's
permissions decline; it does not constrain the realm's own writers, and a
realm writer can learn whether a compiling policy sits at a URL (a 500 against
an ordinary refusal) and exercise its grants against cards they control. A
policy's rules are not secret from the writers of other realms on the server.
**Never put a value that must stay secret in a predicate.**

## 2. The card shape

The definitions live in the catalog realm:

```
RealmPolicy   (CardDef)   rules     = containsMany(PolicyRule)
PolicyRule    (FieldDef)  targetType = contains(CodeRefField)
                          grants    = containsMany(OperationGrant)
OperationGrant(FieldDef)  operation = contains(StringField)
                          where     = contains(PolicyPredicateField)
```

An instance adopts from `@cardstack/catalog/realm-policy/realm-policy`, name
`RealmPolicy`. Write it as JSON. A rule is a field holding a `containsMany` of
grants, and the card API renders no editor for a `containsMany` nested inside a
field, so the card's edit view can't reach a rule's grants.

**`targetType`** is a code ref, `{ "module", "name" }`. The module is an
absolute URL, a prefix form (`@cardstack/base/card-api`), or a path relative to
the policy card's own URL — `../classroom` for a policy card at
`policies/education` in the realm that holds `classroom.gts`. A module that
re-exports the type works too.

**`operation`** is the name a caller invokes — a base operation (`read`,
`update`, `query`, …) or a named operation the type declares (`rename`).

**`where`** takes three forms:

| `where`                                   | Means                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------- |
| absent or `null`                          | Unconditional — the grant admits every card the rule matches           |
| `".teacherIds \| any(. == actor())"`      | A BXL predicate over the card's stored values                         |
| `{ "bxl": ".headTeacher == actor()", "snapshot": true }` | A predicate that may read computed values and searchable links (§7) |

`""` (or whitespace) is not "no condition"; it records `invalid-predicate`.
Leave `where` out for an unconditional grant.

**Any other shape breaks the whole card, not just the grant.** An object with a
key besides `bxl` and `snapshot`, a `bxl` that isn't a string, or a `snapshot`
that isn't a boolean (`"yes"`) fails the card when it is indexed. The realm then
records `policy-card-unloadable` and the whole policy is out of force: every
caller the realm's permissions decline gets 500 (§8).

The card also carries two operations no grant can reach: `validate`, which
answers what the policy compiles to (§8), and `explain`, which answers what it
decides for one caller, card and operation. Its isolated view runs both.

## 3. What a grant admits

**A policy only widens access.** A request the realm's permissions allow never
reaches the policy — a realm writer's write and a realm reader's read evaluate
no predicate. The policy is consulted only for what the permissions declined:
everything, for a caller with no permission on the realm; writes, for a caller
who may read it.

**Grants union.** A request is admitted when any grant in any rule that
matches holds. Order changes nothing, and nothing in a policy denies. Two rules
on the same type are two sets of grants, either of which can admit.

**A rule covers its type and every subtype, never an ancestor.** A rule on
`Classroom` covers a `Homeroom extends Classroom`; a rule on `Homeroom` does not
cover a plain `Classroom`.

**Name the root type to mean everything:**

| You mean            | `targetType`                                                       |
| ------------------- | ------------------------------------------------------------------ |
| every card          | `{ "module": "@cardstack/base/card-api", "name": "CardDef" }`        |
| every file          | `{ "module": "@cardstack/base/file-api", "name": "FileDef" }`        |

**Never `BaseDef`.** A rule on `BaseDef`, or on any field definition, compiles
to no grants: the realm records each grant on it as `unknown-operation` ("BaseDef
has no `read` operation…"), whatever operation it names. The message blames the
operation; the cause is the type.

**A named operation is grantable only on the type that declares it, or a
subtype.** A rule on `CardDef` naming `rename` records `unknown-operation` even
though `Classroom` declares `rename`, and that grant is inactive. Put the grant
on a rule for `Classroom`.

**A grant on a named operation never grants its base.** Granting `rename` (a
`transform`) does not grant `transform`; granting `appendActivity` (a `create`)
does not grant a plain `create` of the card type it mints. That is the point of
a named operation: the grant admits the one narrow write the declaration
expresses.

**What each target carries.** A card carries `read`, `readSource`, `create`,
`update`, `delete`, `query`, `transform` and `appendContainsMany`, plus its
named operations. On a **file**, a grant only ever admits `readSource`. `explain`
and `validate` are never granted (§9).

**A `query` grant only scopes search.** It never admits a direct read of a
card, and a `read` grant never puts a card in anyone's search results. To let a
teacher both open and list their classrooms, grant both (§6).

**The card+json verbs reach the built-in behavior only.** A granted `update`,
`delete` or `create` admits `PATCH`, `DELETE` and `POST` on the card+json
routes — unless the type redeclares that operation, in which case the verb is
refused to a caller the permissions declined, and the grant is used only
through `_operations`. A card+json write that side-loads cards in `included` is
refused to such a caller too, whatever the grants say.

**A granted `read` serves the card's whole representation**, as the type's own
`read` declaration shapes it for every caller: under the default `links:
'full'`, the linked cards and the results of query-backed fields arrive in
`included`, even when the caller holds no grant on those cards' types and a
direct read of one would be refused. Under `links: 'ids'` the relationships name
their targets and nothing is assembled. The realm records
`grant-reaches-ungranted-type` against such a grant as a warning (§8).

## 4. The create lane

A create has no stored card to test, so it is matched and judged differently.

- **It is judged by the resolved type**, never by the type the payload claims.
  A payload whose `adoptsFrom` names a module that re-exports `Bulletin` is a
  `Bulletin` create; one whose class is *called* `Bulletin` but resolves to
  `Classroom` is a `Classroom` create.
- **A `CardDef` rule granting `create` covers every create.** A rule on a type
  covers creates of its subtypes.
- **Only a `create` grant admits a create.** `read`, `update` and `delete` grants
  never do, on any type.
- **A `where` on a create reads the card being minted** — its attributes as the
  payload leaves them after staging. A named create anchored on an existing
  card (`appendActivity` invoked on a classroom) is judged by that card instead.
- **A create grant cannot use a snapshot read.** The new card is not in the
  index yet; a `create` grant with a `snapshot` predicate that reads a computed
  or linked value records `unsnapshotted-policy-read` (§7).
- **`adoptsFrom` must name an absolute or prefix-form module.** A create whose
  type is `{ "module": "./bulletin" }` is refused with 400 `invalid-params`
  through `_operations` for every caller, realm owner included, and through a
  card+json `POST` for every caller the realm's permissions decline: a card
  that isn't stored yet has no location for a relative module to resolve
  against.
- **For a caller who cannot read the realm, the realm chooses the new card's
  id.** It lands under the type's directory (`…/Bulletin/<minted>`). A `lid`
  still links the cards of one batch to each other, but names no file. Their
  card+json `POST` targets the realm root; a `POST` to a subdirectory answers
  404.

## 5. Writing `where`

A predicate is BXL validated against the **`policy` profile**. It must evaluate
to exactly `true`; anything else — `false`, `null`, a string — does not hold.
`bxl-authoring` covers the language; this section covers what the profile
changes.

### What `.` is

`.` is the card's **stored** values, projected the way a card operation sees
them:

| Read                                   | Gets                                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| `.title`, `.address.city`              | Stored scalars and contained values                               |
| `.id`                                  | The card's own URL                                                |
| `.lead.id`                             | The absolute URL a `linksTo` names (relative links are resolved)  |
| `.lead == null`                        | An unset `linksTo`                                                |
| `.teachers \| any(.id == "https://…")` | A `linksToMany`, as a list of `{ id }`                            |

There is no `.attributes` or `.relationships`. A computed field's value and a
linked card's fields are **not** in `.` — reading one needs `snapshot: true`
(§7).

### The calls

| Call                 | Gives                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| `actor()`            | The caller's Matrix user id, `"@teacher:school.example"` — only that          |
| `instance("key")`    | One of the card's raw stored attributes; `instance("id")` is its URL          |
| `realmConfig("key")` | A setting from the governed realm's `config` object on `realm.json`            |

`params()` is refused (`invalid-predicate`): a grant decides whether a caller
may invoke, never what they sent. `NOW()`, `TODAY()` and the random functions
are refused too — a predicate gives one answer for one card and one caller.

```json
{ "operation": "approve", "where": "realmConfig(\"approver\") == actor()" }
```

with the governed realm's `realm.json` holding
`"config": { "approver": "@principal:school.example" }`.

### Membership: `any(. == actor())`

Spell "the caller is in this list" as:

```
.teacherIds | any(. == actor())
```

- `actor() in .teacherIds` compiles and **throws** on every card.
- `contains` is a **substring** match: `.teacherIds | contains([actor()])` holds
  for `@bob:school.example` against a list holding `@bob:school.example.org`. The
  realm refuses it — see below.

### Partial-match builtins are refused

Any call that can hold for a value it matches only in part records
`partial-match`, and the grant is inactive. The call is refused wherever it
appears in the predicate, not only next to `actor()`:

| Kind                         | Refused                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Substring                    | `contains`, `inside`, `index`, `rindex`, `indices`, `FIND`, `SEARCH`, `isIn`  |
| Pattern                      | `test`, `match`, `capture`, `scan`, `matches`, `like`                          |
| Nearest-value lookup         | `MATCH`, `LOOKUP`, `LOOKUP_BY`, `VLOOKUP`, `VLOOKUP_BY`, `HLOOKUP`, `XLOOKUP`, `bsearch` |
| Internal helpers             | any call whose name starts with `_`                                            |
| Anchored at a variable value | `startswith`, `endswith`, `ltrimstr`, `rtrimstr`, `trimstr` — unless their one argument is a fixed string literal |

Compare strings with `==`. A fixed prefix or suffix is allowed, and the realm
cannot check where the literal ends, so end a prefix at a delimiter and start a
suffix at one:

```
actor() | endswith(":school.example")
```

`":school.example"` cannot be satisfied by `@eve:evilschool.example`;
`"school.example"` can.

### Parenthesize every membership test in a compound predicate

`|` binds more loosely than `or` and `and`, so an unwrapped second test joins
the first pipeline and the predicate throws:

```
(.teacherIds | any(. == actor())) or (.leadTeacherIds | any(. == actor()))
```

### Other refusals

All of these record `invalid-predicate`, whose message names the rule broken:

- **Single quotes.** `.status == 'open'` doesn't tokenize. Use double quotes —
  escaped inside JSON: `".status == \"open\""`.
- **Aggregates** — `SUM`, `COUNT`, `MAX`, jq `max`/`min`, and the rest.
- **Error masking** — `try`, `IFERROR`, `ISERROR` and kin. A predicate that
  fails must fail visibly.
- **Structure** — `def`, `reduce`/`foreach`, `..`, assignment, `label`/`break`,
  `@base64` and the other formats.

Bindings (`. as $c`), `IF(…)`, `has(…)`, `length`, `tonumber`, case folding and
`split` are fine.

### A predicate that throws

A predicate that throws on a card — `(.title | tonumber) > 0` on a title that
isn't a number — **denies**, unless another grant holds. When none does, the
caller gets 500 `policy-predicate-failed` if they may read the realm, and the
same 404 as any refusal if not; the fault is logged on `realm:policy`. A throw
is a bug in the policy, not a refusal: guard the value (`.title != null and
…`) rather than relying on it.

## 6. `query` grants and search

A `query` grant is never evaluated card by card. Its predicate is compiled into
a search filter, and every ad-hoc search by a caller the realm's permissions
decline — the realm's `_search` and `_federated-search` — is narrowed by it.

**A grant on a named query is a different grant.** A grant whose `operation`
names a `query` operation the type declares (`listMySchedules`) compiles its
`where` the same way, and its filter narrows only that saved search, invoked by
name. It never admits an ad-hoc search, and a grant on `query` never admits the
saved one: granting a saved search is not granting the freedom to write any
filter over its type. Prefer the named form when the type's `query`
declaration narrows what each row carries (its `links`), since an ad-hoc search
serves every row with its whole link closure. A predicate the filter compiler can't express records
`policy-not-filterable`, and the grant admits nothing.

What compiles:

| Predicate reads                       | Compiles when                                                          |
| ------------------------------------- | ---------------------------------------------------------------------- |
| A text field                          | `==` / `!=` against a string or `actor()`, on a field whose type is exactly `StringField`, `TextAreaField`, `MarkdownField` or `ReadOnlyField` |
| A number field                        | `==`, `!=`, `<`, `<=`, `>`, `>=` against a number literal, on exactly `NumberField` |
| A `containsMany` of text              | Membership only: `.teacherIds \| any(. == actor())`                     |
| A `linksTo`                           | `.lead.id == "<absolute URL>"`                                           |
| A `linksToMany`                       | `.teachers \| any(.id == "<absolute URL>")`                              |
| A computed field                      | Only with `snapshot: true`, under the same rules as a stored field      |
| No condition                          | Always — every card of the type and its subtypes                        |

Combine with `and`, `or` and `not` — except that a membership test or an id
comparison can't sit under `not` or `!=`.

What doesn't compile, and records `policy-not-filterable`:

- `realmConfig()`, and string functions — `startswith`, `ascii_downcase`, even
  where the gate would accept them.
- A link's id compared with `actor()`, a relative URL, or a prefix-form id. A
  link is a card, never a person; compare `actor()` with a text field that holds
  user ids.
- A link compared as a whole, `.lead == null` included — only its `.id` is
  comparable. The gate accepts `.lead == null`; a search filter doesn't.
- Any field of a linked card (`.lead.name`), even with `snapshot: true`.
- A query-backed field, in any form.
- Bindings (`. as $c`) and variables, though the gate accepts them.
- `true`/`false` literals, fields of any other type (`BooleanField`, `DateField`,
  custom fields), a whole list (`.teacherIds == […]`), a list position
  (`.teacherIds[0]`), lists of numbers, arithmetic, `//`, `if`, and one field
  compared with another.

How a filter and its predicate can differ:

- **The filter can be narrower.** A comparison BXL holds for an unset value
  doesn't list a card that has none: `.roomNumber < 200` holds in BXL for a
  classroom with no room number (`null < 200`), and `.providerId != actor()`
  for one with no provider, and the filter lists neither. Say `== null` when
  you mean those cards — `.providerId == null` compiles.
- **A subtype that redeclares a field the filter compares is kept out of that
  comparison**, so its cards aren't judged by a field that means something else
  there. If the realm can't name such a subtype in a filter, the grant records
  `policy-not-filterable`.
- **A caller's own condition on the same list field the grant reads must be
  satisfied by the same element.** With the grant
  `.teacherIds | any(. == actor())`, a teacher's search for "classrooms whose
  `teacherIds` include my colleague" returns nothing, even for classrooms that
  list both. Filter such a search on another field.

A `query` grant compiles only on a card type, so a caller a grant reaches never
searches file rows. The config card and every policy card are left out of
every policy-scoped search, so even an unconditional `query` grant on `CardDef`
does not list them.

## 7. `snapshot: true`

A predicate reads the card's stored source by default. Stored source holds a
link as a reference and holds no computed value at all, so a grant that needs
either opts into a **snapshot**: the realm lays the card's indexed values under
its stored ones before evaluating.

| Predicate reads                                         | Needs                                              |
| ------------------------------------------------------- | -------------------------------------------------- |
| Stored fields, `.lead.id`, `.teachers \| any(.id == …)` | Nothing                                            |
| A computed field (`.headTeacher`)                       | `snapshot: true`                                   |
| A field of a `linksTo` marked `searchable` (`.lead.handle`) | `snapshot: true`                               |
| Fields behind a `linksToMany`, a non-`searchable` link, a link inside a contained value or a linked card, a computed value inside a list, a query-backed field, or `instance()` of a computed field | **Unreadable** — no snapshot holds them |

```json
{ "operation": "read", "where": { "bxl": ".headTeacher == actor()", "snapshot": true } }
```

A predicate that reads a value from the second or third row without the
annotation, or a value from the last row in any form, records
`unsnapshotted-policy-read`, and the grant is inactive in both lanes. An
annotated predicate that reads only stored values compiles as an ordinary one.

What a snapshot read costs:

- **It is as fresh as the index.** The indexed values trail a write until that
  write is indexed. A card that is not indexed, or whose index row is an error,
  admits nothing through a snapshot grant.
- **Computed values always come from the index**, even when the stored JSON holds
  a value under the same key.
- **A linked card's fields count only while the stored link still names the
  card the index expanded.**
- **No create** — §4.

Whether a given grant may rest on index-time values is a judgment about how
stale a decision may be; make it per grant.

## 8. When a policy is wrong

**The policy fails closed.** A policy the realm can't compile refuses every
caller its permissions decline. There is no fallback to an earlier version.

**An issue takes out the part it names.** A grant with an issue is inactive and
the rest of its rule applies; a rule with an issue is dropped and the other
rules apply. Each issue has a `code`, a `path` at the author's position
(`rules[1].grants[0].where`, or `""` for the whole card), a plain-language
`message`, and a `severity`:

| Code                                  | Severity | Part     | Means                                                                 |
| ------------------------------------- | -------- | -------- | --------------------------------------------------------------------- |
| `policy-card-missing`                 | inactive | card     | The index holds no card at the pointer                                 |
| `policy-card-unloadable`              | inactive | card     | The card's index row is an error, or its last visit failed            |
| `not-a-policy`                        | inactive | card     | The card isn't a `RealmPolicy`                                         |
| `invalid-rule` (at `rules`)           | inactive | card     | `rules` isn't a list                                                   |
| `invalid-rule`                        | inactive | rule     | `targetType` lacks `module`/`name`, or `grants` isn't a list           |
| `unresolved-type`                     | inactive | rule     | The `targetType` resolves to no exported type                          |
| `grants-module-source`                | inactive | rule     | The rule names a module-source file type (`.gts`, `.ts`)               |
| `invalid-grant`                       | inactive | grant    | The grant names no `operation`                                         |
| `unknown-operation`                   | inactive | grant    | The type has no such operation (and every grant on `BaseDef`)          |
| `grants-invalid-operation`            | inactive | grant    | The operation is declared but failed to lower                          |
| `grants-authorization-infrastructure` | inactive | grant    | The operation is `nonGrantable`, or the rule's type is a `RealmPolicy` (§9) |
| `unresolved-type` (at `.operation`)   | inactive | grant    | An ancestor of the type has no readable definition, so whether it marks the operation `nonGrantable` can't be told |
| `invalid-predicate`                   | inactive | grant    | `where` is empty, doesn't parse, or breaks the `policy` profile (§5)   |
| `partial-match`                       | inactive | grant    | `where` calls a partial-match builtin (§5)                             |
| `unsnapshotted-policy-read`           | inactive | grant    | `where` reads a value its form can't (§7)                              |
| `policy-not-filterable`               | inactive | grant    | A `query` grant's `where` can't compile to a search filter (§6)        |
| `grant-reaches-ungranted-type`        | warning  | grant    | A `read` or `query` answer carries cards of a type no rule grants a read of (§3) |
| `render-reaches-ungranted-type`       | warning  | grant    | A `query` grant's rendered rows draw on such a type                    |

A card-level issue makes the whole policy uncompilable, and every caller the
realm's permissions decline gets 500 (§10). The two warnings keep their grant
live; every other code takes its part out.

### Seeing the issues

- **The policy card's isolated view** validates the policy as the realm compiles
  it: a "not in force" alert when it won't compile, an "inactive" mark on each
  rule and grant an issue takes out, a warning mark on a grant that stays live,
  and an issues list. It re-checks after each index pass of the realms the
  policy reads. Embedded and fitted views don't.
- **The realm's config card** shows whether the policy its pointer names is in
  force, beside the `policy` field. It is the only place the pointer problems
  (`policy-card-missing`, `not-a-policy`) appear for a card that isn't there.
- **`validate`**, invoked on the policy card (or `validatePolicy` on the realm's
  config card), answers the same thing as data:

  ```json
  POST <policy card's realm>/_operations
  X-HTTP-Method-Override: QUERY
  Content-Type: application/vnd.api+json;ext="https://boxel.ai/ext/operations"
  Accept: application/vnd.api+json;ext="https://boxel.ai/ext/operations"

  { "boxel:operations": [
      { "op": "invoke", "boxel:name": "validate", "href": "https://school.example/org/policies/education" }
  ] }
  ```

  Its result lists `issues`, and `rules` — the rules and grants in force, each a
  `path`. A rule or grant missing from `rules` is inactive; a grant carrying
  `admitsNothing: "unfilterable"` is kept but admits nothing. Only a caller who
  can read the policy card's realm, and every realm the compile read, may ask.
- **The log**: each compile writes one `realm:policy` warning listing the
  inactive issues, and an info line for the warnings.

**An edit reaches the gate within seconds.** The compiled policy is
revalidated when the index of the policy card, or of a type its rules read,
moves, and at least every 5 s. Validate after each edit, then exercise the
grant as a caller it should admit and one it shouldn't.

## 9. Authorization infrastructure

Some cards decide who may do what. No grant reaches them:

- **The realm's config card** (`realm.json`) and **the card its `policy` names**:
  no grant reads, writes, or source-reads them, under any operation name.
- **Every `RealmPolicy` card, and every subtype's**, whether or not any realm
  names it: no grant reads, writes or creates one. Every grant on a rule whose
  type is `RealmPolicy` (or a subtype), `query` included, records
  `grants-authorization-infrastructure`.
- **Every policy-scoped search** leaves out the config card and every policy
  card.
- **An operation declared `nonGrantable`** — on the type or anywhere up its
  chain — can't be granted; a grant naming it records
  `grants-authorization-infrastructure`. A subtype that redeclares it without
  the flag doesn't make it grantable. `explain` and `validate` are always
  `nonGrantable`. Mark a card's own operation this way when the card holds
  authorization — a field a predicate reads to decide access:

  ```ts
  @operation static addTeacher = {
    base: 'transform',
    params: { teacherId: StringField },
    append: { to: 'teacherIds', value: params('teacherId') },
    nonGrantable: true,
  } satisfies OperationDeclaration;
  ```

**These refusals cover an operation invoked on one of these cards, not a card
carried inside another's answer.** A granted `read`, or a row a `query` grant
admits, is served with its whole link closure. If a granted type links to the
config card or a policy card, every caller the grant admits receives that card
— the policy's whole rule list — in `included`. The realm records
`grant-reaches-ungranted-type` against such a grant (§8). Don't link to these
cards from a granted type, or declare a narrower `links` on the read or the
named query that serves it.

Only the realm's own writers can change these cards. **Keep the field a
predicate reads out of reach of the grant it authorizes**: a grant that lets a
teacher `update` a classroom whose `teacherIds` admits them lets them add
anyone to it. Grant a named operation that writes only what the caller should
change, and mark the authorization-bearing write `nonGrantable`.

## 10. Refusals a caller sees

How the realm refuses depends on whether the caller may read the realm:

| Situation                                   | Caller who may read the realm                     | Caller who may not                     |
| ------------------------------------------- | ------------------------------------------------- | -------------------------------------- |
| No grant holds                              | 403 `operation-not-permitted`                     | 404, identical to "not found"           |
| The type doesn't carry the operation        | 405 `operation-not-allowed`                       | 404, identical to "not found"           |
| A predicate threw and no other grant held   | 500 `policy-predicate-failed`                     | 404, identical to "not found"           |
| The policy won't compile                    | 500 `internal-error`, "Policy unavailable" (on writes) | 500 `internal-error`, "Policy unavailable" |
| Nobody signed in, on a gated route          | —                                                 | 401 `actor-required`                    |

The codes are the `code` on an `_operations` error. A card+json route answers
with the same status and a title, and its body carries no `code`, so over those
routes the status is the whole answer.

A caller who may not read the realm learns nothing about what exists: a card
that isn't there and a card a grant refuses answer the same bytes. A realm with
no policy answers with its permissions' own 401 and 403. For the rest of an
operation's refusals, see `card-operations-authoring` §5.

## 11. Before calling a policy done

- The policy card's issues list is empty, or holds only warnings you mean to keep.
- Every membership test is `any(. == actor())`, parenthesized inside `or`/`and`.
- Every grant that needs a computed or linked value says `snapshot: true`, and
  no `create` grant does.
- Every `query` grant compiled a filter (no `policy-not-filterable`), and every
  card a teacher should open also has a `read` grant.
- No grant can write the field its own predicate reads.
- You exercised each grant as a caller it should admit and one it shouldn't.
