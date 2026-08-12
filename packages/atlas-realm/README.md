# The Atlas Slice

A working realm that exists to answer one question:

> **Can two apps, in one realm, run different versions of the same packages —
> at the same time, on the same page — without either one degrading?**

Everything below is the actual contents of this realm. Every number is measured
against it, not illustrative.

---

## 1. The layout

```
atlas-realm/
├── apps/                        FOUR APPS. Each owns its versions.
│   ├── rfq-to-payment/          importmap.json   index.gts    northwind 1.2.0
│   ├── legacy-collections/      importmap.json   index.gts    northwind 1.0.1
│   ├── next-gen/                importmap.json   index.gts    northwind 2.0.0
│   └── showcase/                importmap.json   showcase.gts
├── packages/                    SIX PUBLISHERS' working trees.
│   ├── acme/rfq-to-payment/     importmap.json   index.gts
│   ├── ledgerworks/billing-kit/ importmap.json   index.gts
│   ├── northwind/records/       importmap.json   index.gts
│   ├── cardstack/contracts/     importmap.json   index.gts
│   ├── iso/money-codes/         importmap.json   index.gts
│   └── openkit/controls/        importmap.json   index.gts
├── invoice-1.json … invoice-4.json      THE CARDS.
├── case-1.json  case-2.json  run-1.json
├── legacy-invoice-1.json  legacy-case-1.json
├── ng-invoice-1.json  ng-invoice-2.json   ← on records 2.x, a different shape
├── showcase-1.json
└── realm.json
```

**There is no `importmap.json` at the realm root.** That is deliberate and it
is the first thing to understand about this realm.

Three kinds of file, and the distinction matters:

|                      | What it is                                                                       | Who reads it                        |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| `*.json` at the root | **Instances.** Data.                                                             | Everyone                            |
| `apps/*/`            | **App surfaces.** One file naming the types an app offers, plus that app's pins. | Instances, via `adoptsFrom`         |
| `packages/*/*/`      | **Working trees.** The source of a package, before it is sealed.                 | The publisher, and the next publish |

---

## 2. `adoptsFrom` — how an instance finds its type

An instance names its type by module and export:

```json
// invoice-1.json
{ "data": { "attributes": { "invoiceNumber": "NW-2026-0417", … },
    "meta": { "adoptsFrom": {
      "module": "./apps/rfq-to-payment/index", "name": "Invoice" } } } }
```

```json
// legacy-invoice-1.json  — a different app, the same field names
{ "data": { "attributes": { "invoiceNumber": "LC-2024-0031", … },
    "meta": { "adoptsFrom": {
      "module": "./apps/legacy-collections/index", "name": "Invoice" } } } }
```

Two invoices. Same shape, same field names. **Different types**, because they
adopt from different app surfaces which resolve `Invoice` to different Versions.
§8 shows the index proving it.

### Why the indirection exists

`adoptsFrom.module` is resolved **without** the realm's import map — verified: a
bare specifier there fails with _"Cannot resolve bare package specifier … no
matching prefix mapping registered."_ So an instance can only carry a relative
path or an absolute pin.

If instances pinned versions directly, moving one package would mean rewriting
**every instance**. A realm with forty thousand invoices would need forty
thousand edits to take a patch. The app surface is one file of indirection that
turns that into one edit.

### Why per-app and not per-realm

```gts
// apps/rfq-to-payment/index.gts — the entire file, minus its comments
export { PaymentRun } from 'acme/rfq-to-payment';
export { CollectionCase } from 'ledgerworks/billing-kit';
export { Invoice, LineItem } from 'ledgerworks/billing-kit';
```

```gts
// apps/legacy-collections/index.gts
export { CollectionCase } from 'ledgerworks/billing-kit';
export { Invoice, LineItem } from 'ledgerworks/billing-kit';
```

Identical text. Different resolutions, because each sits next to its own map.
A single realm-wide adoption file would force every app onto one version of
every package, so upgrading one app would silently move all of them — the exact
failure this design exists to prevent, rebuilt one layer up.

### The one non-obvious line

`Invoice` is re-exported **from the kit**, not imported from `northwind/records`
directly. Importing it directly is a bug that produces this:

```
field validation error: tried set Invoice as field 'invoice'
but it is not an instance of Invoice
```

which reads like nonsense until you see there were two `Invoice` classes. The
kit sealed `northwind/records` on the day it was published; the app's own map
may resolve to a different Version. Both resolutions are correct. The instances
they produce are still different types, and `linksTo` checks by identity.

**A kit that links to a type owes its consumers a way to obtain that exact
type.** Taking it from the kit makes the two the same class by construction
rather than by two maps happening to agree.

---

## 3. Import maps — where the pins live

Ten maps in this realm, none at the root.

```
apps/rfq-to-payment/importmap.json                   2 pins
apps/legacy-collections/importmap.json               1 pin
apps/next-gen/importmap.json                         1 pin
apps/showcase/importmap.json                         6 pins
packages/acme/rfq-to-payment/importmap.json          9 pins
packages/ledgerworks/billing-kit/importmap.json      9 pins
packages/northwind/records/importmap.json            6 pins
packages/cardstack/contracts/importmap.json          0 pins   (no dependencies)
packages/iso/money-codes/importmap.json              0 pins
packages/openkit/controls/importmap.json             0 pins
```

An app map is small because it pins only what the app **directly imports**:

```json
// apps/rfq-to-payment/importmap.json — the whole file
{
  "imports": {
    "acme/rfq-to-payment": "/atlas/_packages/acme/rfq-to-payment@1.2.0/index.js",
    "ledgerworks/billing-kit": "/atlas/_packages/ledgerworks/billing-kit@1.3.0/index.js"
  },
  "boxel": {
    "dependencies": {
      "acme/rfq-to-payment": "^1.2.0",
      "ledgerworks/billing-kit": "^1.3.0"
    }
  }
}
```

`northwind/records`, `iso/money-codes` and `cardstack/contracts` are **absent**.
They arrive through the packs' own seals. A root map had to list all of them
because it served every app at once; per-app, the list collapses to what was
actually asked for. `legacy-collections` is down to a single pin.

**Ranges and pins are both kept, side by side.** `^1.2.0` is what the author
would accept; `@1.2.0` is what that meant on the day it was written. A range
alone cannot answer _"what was this tested against"_; a pin alone cannot answer
_"what else was acceptable"_.

### The format is the web standard

`imports` and `scopes`, exactly as a browser import map — plus one vendor key
(`boxel`, or `deck`) for everything added on top, so future spec members can
never collide. It is **not a card**: module resolution must not depend on the
index or on card compute, and a broken card definition must not be able to stop
a realm resolving its modules.

---

## 4. Resolution — the walk

Resolving a bare specifier inside a module goes through four layers, most
specific first:

1. **The pack's own sealed map.** A module served from
   `/atlas/_packages/…@1.3.0/` resolves through the manifest sealed _with that
   Version_ — never through whatever its realm resolves today. That is what
   "sealed" means.
2. **The directory's map, as a scope.** Each `apps/*/` and `packages/*/*/` map
   becomes a scope over its own directory. Longest match wins — the import-map
   rule, no new precedence invented.
3. **The realm-wide `imports`.** This realm has none.
4. **Nothing.** The specifier is rewritten to `https://packages/<name>`, which
   404s with _"Nothing resolves the bare specifier."_ A sentinel, not a real
   host — it means every layer above declined.

The maps are **discovered**, not declared: the realm lists `apps/` and
`packages/`, descending only into directories that do not themselves hold a
map. That is the same rule Deck's store walk uses to find scoped and unscoped
packages without assuming a depth. Adding an app is creating a directory — it
never means editing a file another app also depends on.

---

## 5. Publishing — ranges in, pins out

`packages/acme/rfq-to-payment/` is a working tree. Publishing it seals a
**Version**: the authored source, the compiled output, and a manifest in which
every declared range has been resolved to an exact pin.

```
acme/rfq-to-payment@1.2.0  sealed  [ledgerworks/billing-kit@1.3.0,
                                    cardstack/contracts@1.1.0,
                                    openkit/controls@1.0.0]
```

The working tree also carries those pins, written back after the publish. That
is a **lockfile**: the ranges say what the author would accept, the pins say
what this tree currently develops against.

A Version is immutable by construction — the store is content-addressed and the
registry refuses to republish one with different bytes.

---

## 6. Deployment — two doors, one store

```
GET  <realm>/_packages/<publisher>/<name>@<version>/<path>     the MODULE door
GET  <realm>/_source/<publisher>/<name>@<version>/<path>       the SOURCE door
```

The module door compiles through — ask for `index.gts` and receive the
`index.js` sealed beside it, because a consumer at that address is about to
evaluate what it receives. The source door hands back exactly the authored
bytes, for view-source, diffs and editors.

**Two addresses, not one negotiated URL.** A negotiated response needs
`Vary: Accept`, `Accept` is unbounded and normalised by nobody, so the hottest
URLs in the system would cache worst — and omitting the header lets a shared
cache hand an editor's TypeScript to a browser about to run it.

### The realm is in the URL, and that is the point

`/atlas/_packages/…`, never `/_packages/…`. A server-rooted address makes the
realm server the arbiter of a global publisher namespace: whoever publishes
`cardstack/contracts` first owns that name for everyone on the box. Qualifying
by realm gives _"who decides what this name means"_ an answer that already
exists, with an owner and an ACL.

Measured consequences:

```
/atlas/_packages/northwind/records@1.2.0/index.js         200
/experiments/_packages/lib/palette@4.1.0/index.js         401   private realm
/atlas/_packages/lib/palette@4.1.0/index.js               404   "no package named lib/palette"
/_packages/northwind/records@1.2.0/index.js               404   names no namespace
```

The third line is the whole argument: `lib/palette` exists on this server and is
**not** in atlas's namespace. Structural, not policed — each realm has its own
store root, so collision is impossible rather than prevented by a rule.

Authorization falls out for free: the bytes sit under the realm's prefix and
inherit its read permission. There is no sidecar recording who published what.

### Caching

An exact version can never answer differently, so the correct cache is the one
already built into HTTP:

```
cache-control: public, max-age=31536000, immutable
etag:          "<treeHash>:<path>[:<encoding>]"     ← read, not computed
accept-ranges: bytes
vary:          Accept-Encoding
```

The ETag comes from the content digest the store already holds, so two mirrors
serving the same Version emit the **same** ETag — which is what lets a shared
cache dedupe across them. Measured on `northwind/records@1.1.1/index.js`:

```
identity  41,767 bytes      br  9,465 bytes  (77% off, brotli quality 11)
bytes=-12 → 206, content-range: bytes 41755-41766/41767
```

Compressed variants are a **cache, never part of the seal**: compression is not
reproducible across zlib versions, and a content-addressed digest may not depend
on which library the publishing machine linked.

---

## 7. Version management — what this realm actually holds

Twenty-seven Versions across six publishers, published in order, each sealed
against whatever its ranges resolved to _at that point in the timeline_.

The interesting rows:

| Package                   | Version                 | Why it matters                                                 |
| ------------------------- | ----------------------- | -------------------------------------------------------------- |
| `openkit/controls`        | 0.1.0, 0.2.0, **1.0.0** | Two majors live simultaneously                                 |
| `ledgerworks/billing-kit` | 1.3.0                   | Declares `openkit/controls: ^0.2.0` — which **excludes** 1.0.0 |
| `northwind/records`       | 1.2.0 and **1.0.1**     | A feature line and a maintenance line                          |
| `northwind/records`       | **2.0.0**               | A real shape change — see §8                                   |
| `ledgerworks/billing-kit` | **1.0.1**               | Backport, published _after_ 1.3.0                              |

### The `^0.2.0` that is not a mistake

`billing-kit` declares `openkit/controls: ^0.2.0`. Under the 0.x rule the
leftmost non-zero digit is the compatibility boundary, so `^0.2.0` admits
nothing above `0.2.x` — openkit 1.0.0 is excluded.

That is what actually happens: an ISV qualifies against a UI library, ships to
regulated customers, and does not re-qualify on someone else's release schedule.
On `run-1` both majors render side by side — the 0.2.0 select clipped by its
container, the 1.0.0 select portalled to `<body>` and escaping. **Neither is
degraded. Each is doing exactly what its own seal says.**

### Backports, and the mistake worth keeping

`northwind/records@1.0.1` was published _after_ 1.2.0, carrying one fix and no
features, for the app still qualified against the 1.0 line. Its dependencies are
declared `~` rather than `^`, because a maintenance release that drags its
upstreams forward has not maintained anything.

The first attempt declared `~1.0.0` for `iso/money-codes`. That looked like the
conservative choice and was a **downgrade**: the 1.0 line had always sealed
`iso@1.1.0`, and `iso@1.0.0` has no `isActive`, which the module calls. It
published cleanly and threw at render.

> **A backport reproduces the line's existing resolutions.** It does not
> re-derive them from a tighter range — "tighter" is measured from the bottom of
> the range, and the line is sitting somewhere above it.

Nothing caught it. The publish gate checks that every range resolves to
_something_; it does not check that the something still satisfies the imports
the code makes. A sealed pin can be internally consistent and still wrong.

### The stack, read from the seals

`run-1` renders its dependency table by fetching its own pack manifest — located
from `import.meta.url`, so it cannot name the wrong version — and walking its
dependencies transitively:

```
acme/rfq-to-payment      1.2.0   this card
cardstack/contracts      1.1.0   ^1.0.0 in acme/rfq-to-payment@1.2.0
iso/money-codes          1.2.0   ^1.0.0 in northwind/records@1.2.0
ledgerworks/billing-kit  1.3.0   ^1.3.0 in acme/rfq-to-payment@1.2.0
northwind/records        1.2.0   ^1.2.0 in ledgerworks/billing-kit@1.3.0
openkit/controls         1.0.0   ^1.0.0 in acme/rfq-to-payment@1.2.0
openkit/controls         0.2.0   ^0.2.0 in ledgerworks/billing-kit@1.3.0
```

It **discovers** both majors rather than asserting them. An earlier
hand-written version of this table went stale one release after shipping with a
footnote predicting exactly that.

---

## 8. Search — type identity is versioned

The index knows that the two apps' invoices are different types. Real results
from this realm:

```jsonc
// every card
{"filter":{"item.on":{"module":"https://cardstack.com/base/card-api","name":"CardDef"}}}
→ 14
```

```jsonc
// Invoice, as northwind/records@1.2.0 defines it
{"filter":{"item.on":{"module":"…/atlas/_packages/northwind/records@1.2.0/index",
                      "name":"Invoice"}}}
→ 4    invoice-1, invoice-2, invoice-3, invoice-4
```

```jsonc
// Invoice, as the 1.0.1 backport defines it
{"filter":{"item.on":{"module":"…/atlas/_packages/northwind/records@1.0.1/index",
                      "name":"Invoice"}}}
→ 1    legacy-invoice-1
```

Same class name. Same field names. **Disjoint result sets.** Searching for
"Invoice" requires naming _which_ Invoice — the version is part of the type's
identity, all the way into the query engine.

The same holds one layer up:

```
CollectionCase @ billing-kit 1.3.0  →  case-1, case-2
CollectionCase @ billing-kit 1.0.1  →  legacy-case-1
```

### Range search — asking across versions

Exact-version queries give you disjoint sets. The complement is asking by
**range**, and it composes them back:

```
Invoice @ 1.2.0     →  4   invoice-1..4
Invoice @ 1.0.1     →  1   legacy-invoice-1
Invoice @ ^1.0.0    →  5   invoice-1..4 AND legacy-invoice-1
Invoice @ ^1.2.0    →  4   invoice-1..4
Invoice @ ~1.0.0    →  1   legacy-invoice-1
Invoice @ 1.x       →  5   everything on the 1 line
```

The same one layer up, where the range crosses **both apps at once**:

```
CollectionCase @ ^1.0.0   →  3   case-1, case-2, legacy-case-1
CollectionCase @ ^1.3.0   →  2   case-1, case-2
CollectionCase @ ~1.0.0   →  1   legacy-case-1
CollectionCase @ ^2.0.0   →  0   nothing satisfies it
```

`^1.0.0` is how you ask _"every collection case in this realm, whichever app
owns it"_ — the question an operator actually has — while `^1.3.0` and `~1.0.0`
address the two apps separately without either needing to know the other exists.

#### It expands, it does not pattern-match

This is worth understanding because the naive implementation is impossible.
Type identity is computed from the **resolved** module, so the index always
stores an exact point:

```
…/_packages/northwind/records@1.2.0/index/Invoice
```

That is the right thing to store — three instances spelled `^1.0.0`, `~1.2` and
`1.2.0` collapse to one key, which is what makes "find every instance of this
type" answerable at all. But the index holds **points** and a range is an
**interval**. `@1.2.0` is not a substring of `@^1.0.0`, and no amount of SQL
cleverness makes it one.

So the range is resolved _before_ the query is compiled: ask which versions
exist, keep the ones the range admits, and rewrite the filter into an `any`
over exact keys.

```jsonc
{ "item.on": { "module": "…/northwind/records@^1.0.0/index", "name": "Invoice" } }

// becomes, before compilation:
{ "any": [ { "item.on": { "module": "…/records@1.0.0/index", "name": "Invoice" } },
           { "item.on": { "module": "…/records@1.0.1/index", "name": "Invoice" } },
           { "item.on": { "module": "…/records@1.1.0/index", "name": "Invoice" } },
           { "item.on": { "module": "…/records@1.1.1/index", "name": "Invoice" } },
           { "item.on": { "module": "…/records@1.2.0/index", "name": "Invoice" } } ] }
```

Every branch is then an ordinary exact-key predicate served by the containment
index that already exists. The query engine learns nothing new — the entire
feature is a filter-to-filter rewrite.

Two consequences fall out:

- **`^2.0.0` needs no special case.** Left un-rewritten it matches no stored
  row, which is the correct answer, so an empty `any` never has to mean
  anything.
- **The database never interprets a range.** Both the loader's question
  (_"which one Version does this mean"_ — max-satisfying, used by the serve
  door and the packer's lock) and the search question (_"which versions does
  this admit"_ — a set) are answered by the same `semver` library over the same
  version list. They cannot disagree about what `^1.0.0` means. Interpreting a
  range inside SQL is the thing to refuse, because then a disagreement becomes
  expressible.

### A range is an ordinary predicate — it composes

The rewrite happens before compilation, so a range-spelled type sits alongside
every other operator with no special handling. Four real queries against this
realm.

**Range + numeric predicate, crossing both apps.** The operational question —
_every overdue case in this realm, whichever app owns it_:

```jsonc
{ "filter": {
    "item.on": { "module": "…/ledgerworks/billing-kit@^1.0.0/index",
                 "name": "CollectionCase" },
    "range":   { "item.daysOverdue": { "gt": 45 } } } }

→ 2   case-2 (8974 days, current app), legacy-case-1 (61 days, legacy app)
```

`case-1` is excluded on the data (0 days), not the version. One query reaches
across two apps that share no import map and disagree about their kit's major.

**Range + traversal across a `linksTo`.** Add a condition on the _linked
invoice's_ currency, two hops out:

```jsonc
{ "filter": {
    "item.on": { "module": "…/billing-kit@^1.0.0/index", "name": "CollectionCase" },
    "every": [ { "range": { "item.daysOverdue": { "gt": 45 } } },
               { "eq":    { "item.invoice.currency.code": "DEM" } } ] } }

→ 1   case-2
```

The traversal works only because the field is declared searchable — see below.

**Range + disjunction:**

```jsonc
{ "filter": {
    "item.on": { "module": "…/billing-kit@^1.0.0/index", "name": "CollectionCase" },
    "any": [ { "eq":    { "item.invoice.currency.code": "DEM" } },
             { "range": { "item.amountRecovered.value": { "gt": 0 } } } ] } }

→ 2   case-2 (DEM), legacy-case-1 (recovered 2,400)
```

### Full-text search, and what the version range does to it

`matches` runs over the whole document, with no field path to address:

```jsonc
{ "filter": { "item.on": { "module": "https://cardstack.com/base/card-api",
                           "name": "CardDef" },
              "matches": "Onboarding" } }

→ 2   invoice-1, legacy-invoice-1
```

Both invoices carry a line item called _"Onboarding workshop"_ — the same words,
in two invoices belonging to two different apps, on two different Versions of
the record type.

Now combine it with a range, and the version is what discriminates:

```jsonc
{ …"item.on": { "module": "…/northwind/records@^1.2.0/index", "name": "Invoice" },
  "matches": "Onboarding" }                          → 1   invoice-1

{ …"item.on": { "module": "…/northwind/records@~1.0.0/index", "name": "Invoice" },
  "matches": "Onboarding" }                          → 1   legacy-invoice-1
```

**Identical search text. Disjoint answers.** The text matched both documents in
each case; the semver range chose which app's records were in scope. That is the
whole design in one query — a version range and a full-text term are just two
predicates, and neither knows the other exists.

Another, to show it reaches into `containsMany` field content:

```jsonc
{ …"matches": "datacentre" }    → 1   invoice-3  ("Tokyo datacentre egress")
```

### Across a MAJOR boundary — where unification stops

Everything above ranges over versions that share a shape. `northwind/records`
also has a **2.0.0** that does not, published specifically so this question has
an answer with rows behind it. It breaks in all four ways a major can:

|                          | 1.x                                                       | 2.0.0                       |
| ------------------------ | --------------------------------------------------------- | --------------------------- |
| kept                     | `invoiceNumber`, `issuedOn`, `dueOn`                      | same                        |
| **same name, new shape** | `currency` → `CurrencyCodeField`, read as `currency.code` | `currency` → a plain string |
| **renamed**              | `lines[].description`                                     | `items[].label`             |
| **added**                | —                                                         | `billTo`                    |

Seven invoices now: five on 1.x across two apps, two on 2.x in a third.

**A range spans the boundary without complaint:**

```
Invoice @ ^1.0.0    →  5    the 1.x invoices
Invoice @ ^2.0.0    →  2    ng-invoice-1, ng-invoice-2
Invoice @ >=1.0.0   →  7    all of them
Invoice @ *         →  7    all of them
```

**Fields that survived unify across it.** This is real cross-major unification —
one query, one field path, rows from both shapes:

```jsonc
{ "item.on": { "module": "…/northwind/records@*/index", "name": "Invoice" },
  "range":   { "item.dueOn": { "gt": "2026-08-01" } } }

→ 3   invoice-4 (1.2.0)   ng-invoice-1, ng-invoice-2 (2.0.0)
```

**Fields that moved do not unify. The query throws.**

```jsonc
{ …"module": "…/records@*/index",  "eq": { "item.currency.code": "DEM" } }

→ Error: Your filter refers to a nonexistent field "currency.code"
  on type { module: "…/northwind/records@2.0.0/index", name: "Invoice" }
```

```
eq item.lines.description  across *   →  throws: `lines` missing on @2.0.0
eq item.items.label        across *   →  throws: `items` missing on @1.0.1
eq item.currency.code      across ^1.0.0  →  1   invoice-2      ✓ scoped, fine
eq item.currency           across ^2.0.0  →  1   ng-invoice-2   ✓ scoped, fine
```

**This is the right failure and worth defending.** The expansion produces one
branch per admitted version, and a branch whose type lacks the field is not a
branch that should quietly match nothing — silently dropping it would answer
_"no invoices are in DEM"_ when two of them are. The error names the exact
version and the exact field, which is enough to fix it without guessing.

The rough edge, stated: it surfaces as **HTTP 500** _("unexpected exception in
realm")_, not a 400. It is a malformed query, and the status should say so.

#### Two ways to unify anyway

**Full text ignores shape entirely**, because it has no field path to be wrong
about:

```jsonc
{ "item.on": { "module": "…/records@*/index", "name": "Invoice" },
  "matches": "Onboarding" }

→ 3   invoice-1 (1.2.0)  legacy-invoice-1 (1.0.1)  ng-invoice-1 (2.0.0)
```

Three invoices, three Versions, two majors, two different field names holding
the matched text — `lines[].description` in two of them and `items[].label` in
the third. It just works.

**Or write the union explicitly**, one branch per shape, each scoped to a range
that admits only that shape:

```jsonc
{ "any": [
    { "item.on": { "module": "…/records@^1.0.0/index", "name": "Invoice" },
      "eq": { "item.lines.description": "Onboarding workshop" } },
    { "item.on": { "module": "…/records@^2.0.0/index", "name": "Invoice" },
      "eq": { "item.items.label":       "Onboarding workshop" } } ] }

→ 3   invoice-1, legacy-invoice-1, ng-invoice-1     (identical result)
```

Both routes return the same three rows. So:

> **A version range unifies a type across versions. It does not migrate a
> schema across them** — and it should not pretend to. Where the shape survived,
> one field path is enough; where it moved, the caller states the correspondence,
> because only the caller knows that `lines[].description` and `items[].label`
> are the same idea.

Full text is the exception that proves it: it unifies across any shape change
precisely because it never names a field.

### Filtering across a link

```jsonc
{"filter":{"item.on":{"module":"…/billing-kit@1.3.0/index","name":"CollectionCase"},
           "eq":{"item.invoice.invoiceNumber":"NW-2001-0088"}}}
→ 1    case-2
```

This works only because the field is declared `searchable`:

```gts
@field invoice = linksTo(Invoice, { searchable: true });
```

A `linksTo` is **not** queryable without it, and a filter across a
non-searchable link does not return nothing — it errors at query time.

---

## 9. The one rule the slice discriminates

> **Two versions of a COMPONENT can coexist on one page.**
> **Two versions of a TYPE cannot**, wherever instances of one are assigned to
> fields typed by the other.

`run-1` proves the first half on purpose: two majors of `openkit/controls`,
side by side, neither degraded. The `linksTo` failure in §2 is the second half.

The difference is not a quirk of the implementation. **A component is called,
and the caller never asks what it is. A card type is assigned, and assignment is
checked by identity.** Per-pack sealing is right for code and needs a
dedup rule for types — which, in this realm, is the line
`export { Invoice } from 'ledgerworks/billing-kit'`.

---

## 10. Where to look

| Card                       | What it shows                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `run-1`                    | Two majors of one component on one page, and the resolved stack read from the seals       |
| `showcase-1`               | Three Versions of `cardstack/contracts` and three of `openkit/controls`, all live at once |
| `invoice-1`                | The current record type: document layout, status, tabular money                           |
| `legacy-invoice-1`         | The 1.0 line — visibly plainer, and correct                                               |
| `ng-invoice-1`             | The 2.x shape: `items` not `lines`, a `billTo`, currency as a bare string                 |
| `case-1` / `legacy-case-1` | The same card from two kits, two Versions apart                                           |

Start with `run-1`. It is the page where the claim at the top either holds or
does not.
