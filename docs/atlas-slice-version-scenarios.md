# The Atlas Slice: a versioned vertical, and the ways it should break

A sample realm built to answer one question with pixels instead of prose:
**when the same card exists at eight versions across six layers of somebody
else's templates, what actually happens?**

Written before building, so the predictions below are predictions and not
descriptions of whatever came out.

§7 is a design problem the build surfaced before the build started, and it is
the most important section here.

---

## 0. What the slice is, and why this one

The source is `ctse/software-layer-matrix` on staging — the _Integrated
Software Layer Matrix_, a curated map of Boxel's own artifact taxonomy. Its
structure is a grid: seven **dependency layers** (06 Solutions → 01 Kernel)
crossed with four **artifact lanes** (Cards & Models, Fields & Types,
Components & Views, Tools & Commands). Each layer's mandate is stated in the
card, and the ordering claim is explicit: _"specific solutions descend toward
stable platform primitives."_

That descent is exactly a dependency graph, which is why this matrix is the
right thing to slice. We take **one vertical column** — the money/party/invoice
column — through six of the seven layers, and make each layer one or more
**published packages** that depend on the layers below.

Layer 01 stays unpackaged on purpose: it is the runtime, and a slice that
tried to version the kernel would be testing a different thing.

### Six publishers, not one

The first draft of this document gave all six packages to a single publisher.
That was wrong in the way that hides requirements: **a real dependency graph
crosses organizational boundaries at every layer**, and almost every hard
question in a version system is a question about _who decided_. One publisher
owning the whole column can never ask "may they do that to me?", because the
answer is always yes.

Realistically these come from different realms, or from a catalog realm with
many publishers in it. This slice keeps them in one realm as a simplification,
but **keeps the publisher boundaries real**, because those boundaries are where
the requirements live.

| Publisher     | Who they are                               | Layer | Packages                                                                                                                 |
| ------------- | ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `cardstack`   | the platform vendor                        | 02    | `cardstack/contracts` — `MoneyField`, `PercentField`<br>`cardstack/render-kit` — format primitives                       |
| `openkit`     | a third-party UI library, used by everyone | 03    | `openkit/structures` — `StatusChip`, `AddressField`<br>`openkit/controls` — **the dropdown**<br>`openkit/theme` — tokens |
| `iso`         | a standards body                           | 04    | `iso/party` — `PartyField`<br>`iso/money-codes` — currency codes                                                         |
| `northwind`   | a domain-record vendor                     | 05    | `northwind/records` — `Invoice`, `Contact`<br>`northwind/catalog-records` — `Product`, `PriceList`                       |
| `ledgerworks` | a vertical ISV                             | 05.5  | `ledgerworks/billing-kit` — `BillingKit`<br>`ledgerworks/collections-kit` — `DunningRun`                                 |
| `acme`        | the customer's own org                     | 06    | `acme/rfq-to-payment` — the app<br>`acme/house-style` — a `live` theme                                                   |

Twelve packages, six publishers, two or three each. `openkit/controls` is
deliberately the user's own example: **a dropdown field, sitting under
everything**. If publishing a patch to it is not free, the system does not work
at Boxel scale. §7 is about exactly that.

**Why a vertical and not a horizontal.** A horizontal slice (all of layer 05)
gives you packages that never see each other, and every version question stays
one hop deep. The vertical gives **delegated rendering five levels deep** — an
app renders a kit renders a record renders a party renders a chip renders a
money value — so a template change at layer 02 has to travel through four other
organizations' packages to reach the screen. Every interesting failure in a
version system lives in that travel.

### The dependency graph

```
                acme/rfq-to-payment ── L06 ── acme/house-style (live)
                      │        │
              ┌───────┘        └────────────┐
              ▼                             ▼
   ledgerworks/billing-kit ── L05.5    northwind/records ── L05
              │      │                      │        │
              │      └───────────┐   ┌──────┘        │
              ▼                  ▼   ▼               ▼
    northwind/records      openkit/structures ── L03 ─── iso/party ── L04
              │                  ▲   │                    │
              └──────────────────┘   ├──► openkit/controls│
                                     ▼                    ▼
                          cardstack/contracts ── L02 ◄─── iso/money-codes
```

Not a tree. `openkit/structures` is reached four ways and
`cardstack/contracts` five, at different declared ranges, **from four different
organizations**. A tree would prove nothing.

---

## 1. The visual language

The user-facing requirement: _various versions of the same card must be
visually obvious when they coexist._ So every published Version changes
something a person can name across a room, and every card prints its own
resolved coordinates.

**The three markers, on every package, every version:**

1. **A version stamp.** Bottom-right, monospace, `openkit/structures 2.1.0`. Non-negotiable — it is the ground truth for every screenshot in this document, and with six publishers the _publisher_ has to be in the stamp too.
2. **A colour.** Each minor gets a distinct accent. Not a tasteful gradient: obviously different hues, so a row of instances reads as a bar chart of versions.
3. **One structural or typographic change per version.** A rule appears, a font goes serif, a monogram circle shows up, numbers become tabular. Something that survives a greyscale print.

| Package                   | Version       | The improvement                                                           | What you see                                      |
| ------------------------- | ------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| `cardstack/contracts`     | 0.1.0         | first cut: `value` + `currency`                                           | `1200 USD`, grey monospace                        |
|                           | 0.2.0         | add `PercentField`                                                        | unchanged money, new field type                   |
|                           | 1.0.0         | commit to the shape                                                       | grey monospace, boxed                             |
|                           | 1.1.0         | render the symbol, not the code                                           | `$1,200.00`                                       |
|                           | 1.2.0         | negatives in red                                                          | `-$400.00` red                                    |
|                           | **2.0.0**     | **breaking**: `value` → `amount` (collided with the field API's own word) | green pill, tabular numerals                      |
|                           | 2.1.0         | right-align, currency as superscript                                      | column edges line up                              |
|                           | 2.2.0         | trend marker when `delta` is set                                          | ▲ / ▼ glyph                                       |
|                           | 3.0.0-beta.1  | `amount` becomes a string, to survive big integers                        | orange "beta" corner flag                         |
| `openkit/structures`      | 1.0.0         | `StatusChip`                                                              | grey square label                                 |
|                           | 1.1.0         | add `AddressField`                                                        | two-line address block                            |
|                           | **2.0.0**     | **breaking**: `label` → `status`, palette by status                       | coloured rounded pill                             |
|                           | 2.1.0         | leading dot, small-caps                                                   | `● OVERDUE`                                       |
| `openkit/controls`        | 1.0.0 … 1.4.1 | five releases of a dropdown, the last a one-line patch                    | the §7 blast-radius subject                       |
| `iso/party`               | 1.0.0         | `PartyField`, name only                                                   | plain name                                        |
|                           | 1.1.0         | monogram avatar                                                           | coloured circle, initials                         |
|                           | **2.0.0**     | **breaking**: `party` → `counterparty`; renders address                   | name + address, chip palette                      |
| `northwind/records`       | 1.0.0         | `Invoice`, `Contact`, single column                                       | sans, one column                                  |
|                           | **2.0.0**     | **breaking**: two-column with a rule                                      | serif headline                                    |
|                           | 2.1.0         | slate accent + line-item count                                            | slate                                             |
|                           | 2.2.0         | teal accent + due-date badge                                              | teal                                              |
|                           | 2.3.0         | amber accent + party avatar in header                                     | amber                                             |
|                           | 2.4.0         | violet accent + totals footer                                             | violet                                            |
|                           | 2.5.0         | rose accent + status chip in header                                       | rose                                              |
|                           | 2.6.0         | _"tidy up the template"_ — silently drops `dueDate`                       | rose, **missing the badge**                       |
| `ledgerworks/billing-kit` | 1.0.0         | stacked list                                                              | plain stack                                       |
|                           | 1.1.0         | total row                                                                 | bold total                                        |
|                           | **2.0.0**     | grouped by status, on `openkit/structures@^1`                             | grey square chips, deliberately                   |
| `acme/rfq-to-payment`     | 1.0.0         | indigo                                                                    | indigo header                                     |
|                           | 1.1.0         | **the resolved-stack footer**                                             | prints every layer's publisher + resolved version |
|                           | 2.0.0         | on `billing-kit@^2`, plus the `live` house style                          | emerald header                                    |

The `acme/rfq-to-payment@1.1.0` footer is the most load-bearing thing in the
build. It turns resolution — normally invisible, normally only knowable from a
database — into something printed on the card. Every scenario below is read off
it.

Two throwaway packages exist only for §3: `acme/ping` and `acme/pong`, which pin
each other; and `rival/controls`, a same-named package under a seventh
publisher.

---

## 2. Family A — scenarios that show the real utility

These should work. If one does not, it is a bug in the backport, not a
scenario finding.

### A1 · One range, many resolutions

~40 `Invoice` instances authored against `northwind/records@^2.0.0`, spelled
every way an author might spell it — `^2.0.0`, `~2.3.0`, `2.x`,
`>=2.1.0 <2.5.0`, and exact pins at each of 2.0.0–2.5.0.

**What you see:** one query, forty cards, six accent colours.
**What it proves:** the file holds a _range_, the index holds a _resolution_,
and the range query bridges points to intervals by expansion.

### A2 · A patch travels five layers of delegation, across four organizations

Publish `cardstack/contracts@2.2.0` (the trend marker). Change no other file.

**What you see:** every Invoice, Kit and App **that has adopted it** grows ▲/▼
glyphs — five templates deep, through `openkit`, `iso`, `northwind` and
`ledgerworks`, none of whom were consulted.
**What it proves:** propagation reaches through sealed scopes. **And it is
exactly the behaviour §7 says must not be automatic** — this scenario is both
the feature and the problem, which is why it is written twice.

### A3 · The sealed pin holds

`ledgerworks/billing-kit@1.0.0` was sealed against `northwind/records@2.0.0`
**exactly**. `1.1.0` was sealed against `^2.0.0`, which on its publish day
resolved to 2.3.0.

**What you see:** two `BillingKit` instances side by side. The first is
permanently the original two-column serif; the second is amber. Publishing
`records@2.5.0` moves neither.
**What it proves:** a seal is a fact about a day, not a subscription — and
`ledgerworks` cannot be moved by `northwind` without doing something about it.

### A4 · Two majors of the same export, from one publisher, on one page

`ledgerworks/billing-kit@2.0.0` pins `openkit/structures@^1.0.0`;
`northwind/records@2.5.0` pins `openkit/structures@^2.0.0`. A `BillingKit`
renders `Invoice`s.

**What you see:** grey square chips in the kit's grouping headers, coloured
pills inside the invoices it contains. Same export name, two classes, one
screen — because two _customers_ of `openkit` upgraded on different schedules.
**What it proves:** `resolveSealedScopes` answers "which StatusChip" per
consumer rather than globally. Also B4, because this is the scenario most
likely to collapse.

### A5 · `live` means live, on purpose

`acme/rfq-to-payment@2.0.0` declares `"acme/house-style": "live"`. Not pinned;
it follows the working tree. **`acme` is doing this to their own package** —
which is the only case where it is obviously reasonable.

**What you see:** edit `house-style/index.gts` in code mode; the app re-renders
immediately. Every third-party dependency stays frozen.
**What it proves:** volatility is a per-dependency choice made in writing.

### A6 · Upgrade an app by editing one line

Change the realm's declared range for `acme/rfq-to-payment` from `^1.0.0` to
`^2.0.0`.

**What you see:** every app instance goes indigo → emerald. Not one instance
file was touched.

### A7 · A field predicate over a range

`{ on: northwind/records@^2.0.0, eq: { status: 'overdue' } }` — hits drawn from
five different exact modules, all overdue.

### A8 · Version skew inside one linked graph

One `RfqToPaymentApp` `linksTo` three Invoices resolved at 2.0.0, 2.3.0 and
2.5.0.

**What you see:** one app, three visibly different invoice cards stacked in it.
**What it proves:** delegated rendering does not require the delegate to be one
version. This is what a real realm looks like after two years.

### A9 · A publisher cannot move another publisher's realm

`openkit` publishes `controls@1.4.1`. `acme`'s realm does not change until
somebody at `acme` says so.

**What it proves:** the §7 property, stated as a permission rather than a
performance concern — which is what it actually is.

---

## 3. Family B — scenarios designed to break it

Each carries a **prediction**. A prediction that turns out wrong is the most
valuable output of this build; a scenario with no prediction is a demo.

### B1 · The prerelease boundary

Publish `cardstack/contracts@3.0.0-beta.1`.

**Prediction: `^2.0.0` correctly excludes it, and `>=3.0.0` _also_ excludes
it** — `versionsSatisfying` calls `semver.satisfies` without
`includePrerelease`, matching npm. An author who publishes only a prerelease
and queries `3.x` gets zero rows and no explanation.
**The decision it forces:** npm's prerelease rule protects _installs_. A
_search_ arguably wants the opposite default.

### B2 · A dist-tag that moves backwards

Point `latest` at `2.2.0` while `2.5.0` exists — a rollback, the normal reason
a tag moves.

**Prediction: the redirect follows the tag immediately, and nothing
invalidates.** Invalidation keys on a _publish_, and a tag move publishes
nothing. **Failure looks like:** the serve door and the index disagreeing — a
card that renders 2.2.0 and answers queries as 2.5.0. **The gap I most expect
to find.** Note §7 changes what "correct" means here: under a lock, a tag move
_should_ change nothing until adopted.

### B3 · Authored against a version that does not exist

An instance whose `adoptsFrom` names `northwind/records@^4.0.0`.

**Prediction: an error card, and zero query rows _with a logged reason_**.
**Failure looks like:** zero rows and silence — the failure mode that cost most
of the previous session — or the un-rewritten range matching _everything_.

### B4 · The cross-publisher diamond

A4 viewed as an attack. `StatusChip` at 1.x and 2.x in one render tree, one
export name, two consuming organizations.

**Prediction: both survive, because field identity is keyed by resolved module
URL.**
**Failure looks like:** one definition winning globally, or a field-adoption
error naming neither version.

### B5 · A dependency cycle between two Versions

`acme/ping@1.0.0` pins `acme/pong@1.0.0`, which pins `acme/ping@1.0.0`.

**Prediction: the scope walk terminates and reads each Version once** —
`sealed-scopes-test.ts` asserts this against a fixture. Open question: whether
two _cards_ that render each other terminate, which the scope walk says nothing
about.

### B6 · The dishonest minor, from a third party

`northwind/records@2.6.0` drops `dueDate`. The number promises compatibility;
the bytes do not keep the promise. **`northwind` is not you** — you cannot fix
their release, only refuse it.

**Prediction: every consumer on `^2.0.0` silently loses the badge, and nothing
warns.** Semver is a claim by an author, not a property the system can check.
**What it really tests:** whether the structural pass at proposal time catches a
removed field, and whether §7's UPDATE step is where a human would have caught
it. The honest answer may be "the resolver cannot catch this, and the review
step is the only defence" — which is itself the finding.

### B7 · `0.x` caret semantics

`^0.1.0` must **not** admit `0.2.0`.

**Prediction: correct**, since one `semver` library answers both the resolver's
question and the query's. In the corpus so it stays correct.

### B8 · Percent-encoding round-trip

`^2.0.0` → `%5E2.0.0`. `>=2.1.0 <2.4.0` contains a **space**, plus two
characters with URL meaning.

**Prediction: the caret round-trips; the interval with a space is the risk.**
It must survive authored file → module URL → index `deps` key → filter →
expansion → exact key.
**Failure looks like:** an interval that passes a unit test and returns zero
against a live index, because one leg encoded the space as `+` and another as
`%20`.

### B9 · Invalidation blast radius at depth six

Publish `cardstack/contracts@2.2.0` — the bottom of the stack, under six
layers and five other organizations — and **count the invalidated rows**.

**Prediction: far fewer than the transitive consumer set**, because most
consumers hold _sealed pins_ and a sealed pin does not move. Only ranges that
_now resolve to_ 2.2.0 should invalidate.
**Failure looks like:** the whole realm reindexing on every patch.
**This scenario now sizes §7.** If sealed pins already contain the blast, the
locking feature is a smaller job than it looks; if they do not, §7 is urgent.
**Run this before building §7.**

### B10 · Two publishers, one bare name

`openkit/controls` and `rival/controls`, both wanting the specifier `controls`.

**Prediction: a realm map forces a choice, because two identical JSON keys
cannot coexist.** The real risk is a _scope leak_ — a package that sealed
`"controls"` meaning `openkit`, rendered inside a realm that means `rival`.
**Failure looks like:** a card resolving `controls` to the wrong publisher
entirely. With six publishers this stops being hypothetical.

### B11 · Extensionless resolution under a range

A type key is `…/records@2.4.0/index` — the extension trimmed by
`internalKeyFor`. Under a range that becomes `…/records@%5E2.0.0/index`, which
must resolve, redirect and serve extensionlessly.

**Prediction: works** — the chain fixed last session. In the corpus as a
permanent regression case.

### B12 · Who may publish under a namespace

Propose a Version of `openkit/structures` using `acme`'s token.

**Prediction: unknown, and that is the finding.** The proposal flow takes
`proposedBy`/`acceptedBy` from the token rather than the body, which is the
right foundation — but whether anything _checks that the actor owns the
publisher namespace_ is exactly what six publishers makes askable.
**Failure looks like:** `acme` shipping a Version of `openkit/structures` that
every other consumer picks up.

---

## 4. The runnable surface

Four cards, each editable in the realm. The dashboard is pinned to the realm's
`Workspace` index card via `entryPoints`, so it is the first door on Home.

1. **Atlas Slice Board** _(the pinned dashboard)_ — a grid of app / kit / record
   instances rendered live at their real resolved versions, each with the
   resolved-stack footer. Filter chips: _"everything on `records@^2`"_,
   _"everything `contracts@2.2.0` reaches"_, _"group by publisher"_. This is
   what makes coexistence a picture instead of a claim.
2. **Version Query Console** _(exists)_ — extended with the Atlas samples,
   including the ones predicted to return zero. A sample that returns nothing
   is only useful when the card says _why_, so each carries its prediction.
3. **Publish Timeline** — the ~35 Versions in publish order, by publisher, with
   the improvement note and the pins each sealed. Reading down it is reading the
   history of a supply chain.
4. **Update Inbox** _(§7)_ — what _would_ move if you adopted it, per realm, per
   dependency, with the blast radius as a number next to the button.

---

## 5. Build order

Each step verifiable before the next, so a failure has one candidate cause.

1. `packages/atlas-realm/` — realm scaffold, `atlas_realm` matrix user, one
   stanza in `mise-tasks/services/realm-server`. **Done.**
2. `cardstack/contracts` through all nine Versions, bottom-up. Nothing depends
   on it yet, so a failure here is about the package, not the graph.
3. `openkit/*`, `iso/*`, `northwind/*` — each published against the
   _then-current_ store, so sealed pins record real history rather than a
   backfilled fiction. **This ordering is the "organic" requirement.**
4. `ledgerworks/*`, `acme/*`. The resolved-stack footer lands here; from this
   point every step is visually self-verifying.
5. The instance corpus, ~70 instances, skewed toward awkward spellings.
6. **B9 — measure the blast radius.** Before building §7, find out how big the
   problem actually is.
7. The cards, dashboard first and pinned.
8. Family A verified in a browser, one screenshot each. Family B run,
   predictions scored, a **Results** section written back here — including the
   ones I got wrong.

---

## 6. Decisions taken, and their costs

**A dedicated realm.** Two lines of dev-stack wiring. Buys a realm whose entire
contents are the scenario, so a query returning 40 rows returns 40 _relevant_
rows.

**Six publishers in one realm.** A simplification — realistically they would be
different realms or a multi-publisher catalog — but the _publisher boundaries_
are kept real, because that is where the requirements are. What this
simplification cannot test: cross-realm trust, and a publisher whose realm is
offline.

**Layer 01 is not packaged.** It is the runtime.

**Real order, real dates.** Versions are published in sequence against the store
as it existed. A pin saying `records@2.3.0` must be there because 2.3.0 was the
answer that day. Backfilling would make every §3 prediction untestable.

**The `2.6.0` dishonest minor ships.** A bad version on purpose, permanently in
the corpus. A version system that has never been lied to has not been tested.

---

## 7. Publishing must not reindex the world

**The feature note.** Raised while building, and more important than the build.

### The problem

`openkit/controls` is a dropdown field. It sits under every card in every
realm. Today, publishing `controls@1.4.1` — a one-line patch — changes the
answer to every `^1.0.0` range that names it, everywhere, at once. Three costs,
and the second is worse than the first:

1. **An indexing storm.** Every consumer row invalidates on one publisher's
   Tuesday afternoon.
2. **An unreviewed change to what every card renders.** Nobody at `acme` asked
   for it, saw it, or could have stopped it.
3. **Non-determinism.** The same instance renders differently on two days with
   no edit in between and no record of why.

At Boxel scale this is not a performance problem. It is a **control problem**:
a third party can change your application without your involvement.

### The diagnosis

Resolution happens **at index time, against the store's newest**. So a range's
_acceptability_ silently becomes its _adoption_.

Those are different facts, and conflating them is the bug:

> A range says what the author **would accept**.
> It does not say what they **have adopted**.

`^2.0.0` is a standing permission — "a later 2.x is fine by me" — that we
currently execute as a standing instruction: "give me the latest 2.x, always,
immediately, without telling me."

### The fix

**Store the adoption.**

- A realm holds a **resolution lock**: for each declared range, the exact
  version in force.
- **Indexing resolves against the lock, never against the store.**
- Publishing therefore **invalidates nothing**. Zero rows. Publishing becomes
  free, which is what makes a registry usable by strangers.
- Publishing instead writes an **update-available** row: _"`northwind/records@^2.0.0`
  in realm `acme` would move 2.5.0 → 2.6.0."_ Cheap, and it is a fact rather
  than an action.
- The **UPDATE** action rewrites the lock. _That_ write invalidates — exactly
  the rows whose lock entry changed, a set the operator chose and saw the size
  of before clicking.

This is `package.json` + `package-lock.json`, and the precedent is the argument:
npm has the same graph, the same range semantics and the same scale, and it
separates these two facts for exactly this reason.

### Why this makes the rest coherent

**It rescues `live`.** `live` already exists as the explicit "always newest"
opt-in. Today every range is effectively `live`, so `live` is an escape hatch
from nothing. Under a lock, `live` becomes what it reads like: a deliberate
choice of volatility, taken per dependency, in writing.

**It is the same shape as the demo.** A lock is per-realm, so realm A on 2.5.0
and realm B on 2.6.0 are both correct simultaneously — which is precisely the
coexistence §2 exists to show. The feature and the showcase are one mechanism.

**Almost nothing already built is wasted.** `selectInvalidations` — the
resolves-to-versus-satisfies selection — is _exactly_ the query that finds
update-available rows. Same SQL, same semver call, same subtle correctness
argument. It stops being wired to an invalidation and starts being wired to a
notification. That is a re-target, not a rewrite.

### What still needs deciding

1. **Where the lock lives.** A `deck.resolved` block inside `importmap.json` is
   the obvious home, but that file is _authored_, and a generated block inside
   an authored file is a merge-conflict generator. A sibling
   `importmap.lock.json` is cleaner and matches the precedent.
2. **Do instance-level ranges participate?** An instance whose `adoptsFrom`
   names `records@^2.0.0` bypasses the realm map entirely. Either instances are
   locked too, or instance ranges are a second unlocked channel — **which would
   defeat the whole feature**. This is the sharpest open question, and the
   corpus is full of exactly these instances, so the slice will answer it.
3. **Scope of one click.** One dependency in one realm / one dependency
   everywhere admissible / everything in one realm. Blast radius shown as a
   count _before_ the click, from the same query.
4. **Policy per dependency, not global.** Trust is not uniform:
   `"cardstack/contracts": { "range": "^1.2.0", "adopt": "patch" }` (your
   platform vendor) alongside
   `"openkit/controls": { "range": "^1.0.0", "adopt": "manual" }` (a third
   party). Publisher identity is the natural unit for this, which is a second
   reason §0 has six of them.
5. **Who may press it.** The realm owner. A publisher must never move another
   realm's lock — that is the entire point, and B12 asks whether namespace
   ownership is even checked today.
6. **Security patches.** A publisher wants to say "adopt this one". A consumer
   has excellent reasons not to take that claim on faith. Needs a channel and a
   default, and the default should probably still be a click — with a loud one.
7. **Staleness is the cost.** The counterpart of "no surprise upgrades" is
   realms quietly running two-year-old code. Whatever ships must make drift
   _visible_ — how far behind each lock is, per dependency — or we will have
   traded a loud problem for a silent one.

### Sequencing

**Run B9 first.** A pack already seals its own pins, so packages are already
locked; the gap may be only at the realm and instance level. B9 measures
exactly how much of the blast radius sealed pins already contain. If the number
is small, §7 is a smaller job than it looks. If it is large, §7 comes before
anything else in the backport.

The measurement decides the priority, so it is worth having before the argument.

---

## 8. Results — first pass, verified in a browser

Recorded as they happened, including the one that was a real bug rather than a
scenario.

### 8.1 Published and serving

| Package               | Versions              | Kind of step                                                              |
| --------------------- | --------------------- | ------------------------------------------------------------------------- |
| `cardstack/contracts` | 0.1.0 → 0.2.0 → 1.0.0 | 0.2.0 is INCOMPATIBLE under the 0.x rule; 1.0.0 compatible in field shape |
| `openkit/controls`    | 0.1.0 → 0.2.0 → 1.0.0 | 0.2.0 compatible (both features opt-in); 1.0.0 INCOMPATIBLE               |

Both arcs contain a compatible and an incompatible step, which was the point of
running two packages rather than one.

### 8.2 CONFIRMED — three versions of one field render side by side

`showcase-1` holds three `MoneyField`s from three sealed Versions on one card
and they disagree on screen, from identical stored values (`1200 USD`):

- 0.1.0 → `1200 USD`
- 0.2.0 → `$1,200.00`
- 1.0.0 → `$1,200.00`, themed, with a `PercentField` sibling at `8.25%`

Three modules at three URLs, three classes, three templates. Loading one does
not disturb another. This is the property everything else rests on and it now
has a picture rather than an assertion.

### 8.3 CONFIRMED — the portal, and why it is a major

Verified in the running app:

- 0.1.0's listbox, opened inside an `overflow: hidden` box, is **cut off**.
- 1.0.0's escapes the card _and_ the operator-mode chrome entirely.
- floating-ui's `flip` opened the popup upward when there was no room below,
  then flipped back down as the filtered list shrank.
- `autoUpdate` kept the popup on its trigger through a scroll — the popup moved
  with the trigger rather than floating away.

### 8.4 CONFIRMED — ranked search, marked matches, folded diacritics

- `us` → **US** dollar above Belar**us**ian ruble. Prefix outranks substring.
- `mexico`, typed with no accent, found `Peso mexicano (M`**éxi**`co)`, and the
  mark landed **on the accented characters** — which is the load-bearing detail:
  the fold is length-preserving for precomposed text, so indices found in the
  folded string still slice the original correctly.
- Escape cleared the query and left the popup open; a second Escape closed it.

### 8.5 THE REAL BUG — a field def in a package could not be adopted at all

Not a predicted scenario. Found by trying to render one.

**Symptom.** `showcase-1` returned HTTP 500:
`FilterRefersToNonexistentTypeError: … import { MoneyField } from
".../_packages/cardstack/contracts@1.0.0/index"`.

**Cause.** The `modules` row carried
`error: Unexpected token (56:12)` — the colon in `const COMMON: {…}[]`. The
indexer had fetched `…/index.gts` and been handed **raw TypeScript**. A realm
transpiles `.gts` on serve; `handle-package-serve.ts` did not, so it returned
authored source to a consumer about to evaluate it as a module.

**Why it hid.** The _extensionless_ form already worked, because
`executableExtensions` lists `.js` first — so `/index` resolved to compiled JS
and every probe of that shape passed. Only an explicit `.gts` request failed,
and only the indexer makes one. The one existing package in the corpus
(`lib/palette`) exports helpers, not definitions, so nothing had ever asked a
package for a _card type_.

**Fix.** `handle-package-serve.ts` now draws the line a realm already draws: a
`.gts`/`.gjs`/`.ts` request serves the compiled `.js` sibling unless
`Accept: application/vnd.card+source` asks for source. It costs nothing — the
compiled artefact is already in the pack, because the transform runs before the
seal — and view-source, diffs and the editor are unaffected.

**Worth keeping.** The failure mode was the bad one. A type that cannot be
resolved does not report "unknown type" to the author; it makes every `eq`
against that type match nothing, silently. §3's B-family assumed breakage would
surface at _query_ time. This surfaced at _serve_ time and was invisible until
something tried to render.

### 8.6 Finding — the realm import map IS the resolution lock of §7

`packages/atlas-realm/importmap.json` already holds exactly what §7 proposed
building: bare specifier → exact sealed Version, with the authored range kept
beside it under `boxel.dependencies`. So the UPDATE button does not need a new
store; it needs a writer for this file, and invalidation scoped to the entries
it changed. §7's design survives contact with the code.

### 8.7 Finding — `ember-power-select` is unreachable from card code

`packages/host/app/lib/externals.ts` is an explicit allowlist. It shims
`ember-modifier`, `ember-animated`, `@floating-ui/dom` and
`@cardstack/boxel-ui/*` — but not `ember-power-select` or
`ember-basic-dropdown`. So "rebuild openkit's Select on power-select" was not
available, and floating-ui (what power-select would have wrapped) was. The
component owns its API, ARIA, keyboard and visuals; the collision maths is
borrowed.

Standing caveat, accepted: everything in that allowlist resolves through the
HOST, so for a published pack it is a `live` dependency — it can change under a
sealed Version when the host deploys. Vendoring these into the package store is
the eventual answer; not a blocker now.

### 8.8 The whole chain seals — 11 Versions, 6 publishers

```
cardstack/contracts   0.1.0 → 0.2.0 → 1.0.0
openkit/controls      0.1.0 → 0.2.0 → 1.0.0
iso/money-codes       1.0.0 → 1.1.0
northwind/records     1.0.0   [contracts@1.0.0, money-codes@1.1.0]
ledgerworks/billing   1.0.0   [records@1.0.0, contracts@1.0.0, controls@0.2.0]
acme/rfq-to-payment   1.0.0   [billing-kit@1.0.0, contracts@1.0.0, controls@1.0.0]
```

CONFIRMED: `northwind/records` declared `iso/money-codes: ^1.0.0` and sealed to
**1.1.0** — the version that existed on publish day. The pack manifest keeps
both, `imports` holding the pin and `deck.dependencies` holding the range, so
"what was this tested against" and "what else was acceptable" are both
answerable from the artefact. That was the design; it is now observed.

CONFIRMED at the seal: `ledgerworks/billing-kit` pins `openkit/controls@0.2.0`
while `acme/rfq-to-payment` pins `@1.0.0`, from ranges alone, with no manual
intervention.

### 8.9 CONFIRMED — the sealed scope is produced by the resolver

The load-bearing claim, checked at the layer that decides it. Run through the
PRODUCTION `resolveImportMap` (not a re-implementation — checking a claim
against a copy of the logic proves only that the copy agrees with itself),
against the live store:

```
top level
  openkit/controls  ->  .../openkit/controls@1.0.0/index.js

scope .../_packages/ledgerworks/billing-kit@1.0.0/
  openkit/controls  ->  .../openkit/controls@0.2.0/index.js

scope .../_packages/acme/rfq-to-payment@1.0.0/
  openkit/controls  ->  .../openkit/controls@1.0.0/index.js
```

So when `billing-kit`'s module imports the bare specifier `openkit/controls`,
the scope keyed by its own URL prefix wins and it gets **0.2.0** — while
everything else in the realm, including `acme` one layer above it, gets 1.0.0.
Two majors of one component, resolved from ranges, with no manual intervention
anywhere. The walk fetched all ten pack manifests transitively to build it.

**The empty `"scopes": {}` in the pack manifest was not a bug.** Scopes are
computed at RESOLUTION time from the pins the realm's map holds, rather than
baked into each pack — which is the better design and the reason it is correct:
a pack cannot know which other packages will sit beside it in a realm, so it
has no business asserting the scope table. It asserts its own pins and the
resolver composes them. §8.8's suspicion was aimed at the wrong artefact.

Remaining, and small: this is the resolver's output, which is what feeds the
loader. Watching the browser evaluate `billing-kit` and land on the 0.2.0
module closes the last step, and the acme card is built to make that visible —
its two Selects sit in identical `overflow: hidden` boxes, so the sealed one
clips and the 1.0.0 one escapes.

### 8.10 CONFIRMED — instances do NOT resolve through the realm import map

§7 listed this as its sharpest open question: _"instance-level `adoptsFrom`
ranges bypass the realm map entirely."_ They do. Verified, with the error text:

```
adoptsFrom.module: "northwind/records"
  → 500  Cannot resolve bare package specifier "northwind/records"
         — no matching prefix mapping registered
```

An instance names its type in `meta.adoptsFrom.module`, and that string is
resolved WITHOUT the realm's import map. So an instance has two options and
both are bad alone: a bare specifier is rejected outright, and an absolute pin
(`/_packages/northwind/records@1.0.0/index`) is accepted but writes the version
into EVERY INSTANCE — a realm with forty thousand invoices would need forty
thousand rewrites to move one package, and the realm lock would govern nothing
that mattered.

**The fix is one line of indirection, and it is now `packages/atlas-realm/adopt.gts`:**
a realm module that re-exports the package's classes. Instances adopt from
`./adopt` — realm-relative, always resolvable — and that module's OWN imports
do go through the realm import map. The version then lives in exactly one
place, `importmap.json`, which is precisely what makes an UPDATE button
possible: rewrite one file and every instance adopts the new Version without
any instance being touched.

This should be written into §7 as a REQUIREMENT rather than a convention. If
instances may carry package pins directly, the realm lock is advisory and the
UPDATE button cannot work.

### 8.11 FIXED — package modules were given no pins at all

The blocker, and the diagnosis in §8.11's first draft was aimed at the wrong
thing. `https://packages/…` is not a mangled URL: it is `PACKAGES_FAKE_ORIGIN`,
the sentinel a bare specifier is rewritten to when NOTHING resolved it. The
error was not "this URL is malformed", it was "this specifier had no map".

**Root cause**, `packages/host/app/routes/module.ts`:

```js
// Shimmed modules have no realm and no pins; everything else gets its
// realm's decklist installed before a single specifier is resolved.
let realmURL = response.headers.get('x-boxel-realm-url');
if (realmURL) {
  await context.realm.ensureRealmMeta(realmURL);
}
```

That comment names TWO kinds of module. There are three. A module served from
`/_packages/` is neither realm-hosted nor shimmed — the package store is
server-wide, so `handle-package-serve.ts` sets `content-type`, `last-modified`
and `cache-control` but no `x-boxel-realm-url`. No realm, therefore no pins,
therefore every bare specifier inside it fell through to the packages origin.

**Why it hid until now.** Only a package that imports ANOTHER package ever
needs a specifier resolved. `cardstack/contracts` and `openkit/controls` have
no dependencies of their own and indexed perfectly. `northwind/records` was the
first pack in the slice with any, and it failed immediately.

**Fix.** `RealmService.ensurePackageDecklist(moduleURL)` — installs the pins of
the Version a module belongs to, read from that Version's own sealed manifest.
Three properties make this the right shape rather than a patch:

- **Realm-independent.** The pins were fixed at publish, so they mean the same
  thing in every realm that installs the pack. There is no realm-specific
  answer to go hunting for, which is why the missing realm header does not
  actually matter.
- **Reuses `setRealmDecklist` exactly.** That function already turns a
  decklist's `imports` into a scope over the URL it is keyed by — which is
  precisely "these are the pins for modules living here" — and longest-scope-
  wins then keeps a realm's own override on top.
- **Transitive**, via `resolveImportMap`. Loading acme's module pulls
  ledgerworks', which needs ITS pins to resolve northwind. Installing one level
  would have moved the failure rather than fixed it.

Fails open, like `resolveSealedScopes`: an unreachable manifest costs that
Version's imports, which fail loudly at their own import, rather than taking
down a render over a package the card may not even touch.

Verified: all seven package modules now hold clean definition rows, including
the full transitive chain `acme → ledgerworks → northwind → contracts/iso`.

### 8.12 CONFIRMED IN THE BROWSER — two majors, one page, neither degraded

The claim the whole slice exists to test, rendered:

- `case-1`, reached through `ledgerworks/billing-kit` (sealed `^0.2.0`), opens
  a Select with **no search field** — because 0.2.0's search is opt-in and the
  kit never asks for it — and a popup that is a plain DOM descendant.
- `run-1` renders that same case beside a Select imported at `^1.0.0`, with
  search, groups, multiple selection and a portal.

Same component, same publisher, one page, two behaviours. The realm's top-level
map says `openkit/controls` means 1.0.0; the kit gets 0.2.0 anyway, because the
scope keyed by its own URL prefix wins. Nothing about acme's card can reach up
and change that — the absence of an escape hatch is the feature.

### 8.13 The corpus, and what building it exposed

Eight instances, all indexing: `showcase-1`, four invoices (USD, DEM-withdrawn,
JPY zero-minor-unit, KWD three-minor-unit), two collection cases, one payment
run. Every one adopts from `adopt.gts` rather than a package URL, per §8.10.

Building it forced three genuine passes that a plan drawn in advance would not
have contained, which is the argument for building corpora at all:

| Pass                            | Why                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ledgerworks/billing-kit@1.1.0` | 1.0.0 had only `isolated`, so a linked case rendered as a bare title chip — unusable in the one position consumers put it in. Additive, hence a minor.                                                                   |
| `acme/rfq-to-payment@1.0.1`     | **The source did not change.** ledgerworks shipped 1.1.0, acme's range admitted it, and acme still did not get it until acme republished — because a seal does not drift. §7's UPDATE button, from the top of the stack. |
| `acme/rfq-to-payment@1.0.2`     | Two defects visible only on screen: `<@fields.x />` renders a link FITTED not embedded, so the new row never appeared; and the resolved-stack footer was hardcoded text that went stale on the very next release.        |

That last one is worth keeping. A hand-maintained copy of a fact the seal
already holds is a second source of truth, and it went wrong one release after
being written. The footer is corrected but still hand-written, and the source
says so: the honest version reads the pack manifest at render time. Owed.

---

## 9. Ruling: module resolution belongs on the wire, not in a table

Three separate failures in one session, all the same failure:

| Symptom                                         | What was actually stale                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| §8.5 — a field def could not be adopted         | a poisoned `modules` row that survived the serve-layer fix; had to be `DELETE`d by hand                    |
| §8.11 — package modules got no pins             | definitions cached with a resolution computed before the pins existed                                      |
| §9 below — an app kept its neighbour's versions | the app module cached against a map read before the app scope was added; survived a **full stack restart** |

Each time the code was right and the _cache_ was lying. That is not three bugs.
It is one design flaw with three faces.

### The flaw, stated precisely

`modules` stores `deps` and `definitions` keyed by **URL** (plus cache scope
and user). But a module's resolution is a function of **(URL, effective import
map)** — and the map is not in the key. So when the map changes, every row
derived from the old map remains valid-looking and is served forever. Nothing
detects it, because nothing can: the key cannot express the thing that changed.

That is why "edit the lock, get the other version" needed a restart AND a
manual `DELETE` to work. An UPDATE button built on this would appear to do
nothing, which is the worst possible behaviour for a button whose entire
purpose is to make a change happen.

### The rule

**Resolution is a pure function evaluated at fetch time, and immutability is
the only cache.**

- A pinned URL — `/_packages/name@1.2.3/index.js` — is immutable by
  construction (Deck L4: the registry refuses to republish one with different
  bytes). It is already served `cache-control: public, max-age=31536000,
immutable`. **The wire cache is correct and free.**
- An import map is small, and resolving a specifier against one is a string
  operation. `resolveSpecifier` already does it, and §8.9 confirmed it produces
  the right answer against the live store in milliseconds.
- Therefore: no derived resolution state needs to be stored at all. The
  browser's own module graph is the cache; HTTP is the transport; the map is
  the input.

### What that changes here

The honest fix is not "add invalidation". Invalidation is the thing you build
when the key is wrong, and it fails the same way every time — someone forgets a
path. Two options, in order of preference:

1. **Do not store it.** Serve the resolved map to the client, let the module
   loader resolve and fetch. Immutable URLs mean a warm client re-fetches
   nothing. This is the shape the user asked for and it is the smaller system.
2. **If a cache must exist, make it content-addressed.** Put a digest of the
   effective decklist into the cache key. Then changing the lock MISSES rather
   than returning stale — no invalidation logic at all, and the failure mode
   flips from "silently wrong" to "slightly slower once".

Either way the invalidation code goes away rather than growing. The current
arrangement is the only one that requires a human to remember to `DELETE`.

### 9.1 App surfaces, and why a realm-wide one was wrong

An earlier pass put a single `adopt.gts` at the realm root and had every
instance adopt from it. That was a design error: **a realm can host competing
apps**, and one shared adoption surface forces every app in the realm onto one
version of every package — so upgrading one app silently moves all of them.
That is exactly the failure §7 exists to prevent, rebuilt one layer up.

Replaced with **per-app surfaces** plus per-app scopes in the realm map:

```
apps/rfq-to-payment/index.gts     → northwind@1.1.1, contracts@1.1.0
apps/legacy-collections/index.gts → northwind@1.0.0, contracts@1.0.0
```

```json
"scopes": {
  "./apps/legacy-collections/": {
    "northwind/records": "/_packages/northwind/records@1.0.0/index.js"
  }
}
```

Longest matching scope wins — the import-maps rule, no new precedence invented.
CONFIRMED in the browser: `legacy-invoice-1` renders 1.0.0's raw layout with
unformatted totals (`8100`) while `invoice-1` renders 1.1.1's document layout
(`$8,100.00`), in one realm, at the same time.

The remaining constraint is the one from §8.10: an instance still cannot name
its own version, because `adoptsFrom.module` is resolved without the import
map. The app surface is what buys instances a stable realm-relative address
whose own imports DO go through the map. If `adoptsFrom` ever accepts a
specifier the map can resolve, the surface becomes optional rather than
required — worth doing, and it would delete a file per app.

---

## 10. The serving path, leaning on Deck's no-database property

Deck serves from a content-addressed store on a plain filesystem. Nothing on
the read path consults a database, and the point of this pass is to keep that
true all the way to the browser — so the only cache is the one HTTP already
has, and there is nothing to invalidate because nothing can change.

### What now goes out on the wire

| Header                                               | Why it is the right one here                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cache-control: public, max-age=31536000, immutable` | A year is the ceiling any cache honours, and it is honest: an exact version can never answer differently, so a shorter max-age buys only round trips whose outcome is known in advance.                                                                                                                |
| `etag: "<treeHash>:<path>"`                          | **Read, not computed.** The store is content-addressed, so the digest is already on the version record — no hashing on the request path. Two mirrors serving the same Version emit the SAME validator, which is what lets a shared cache dedupe across them; an mtime- or inode-derived tag could not. |
| `vary: Accept`                                       | Correctness, and a bug this session introduced.                                                                                                                                                                                                                                                        |
| `accept-ranges: bytes`                               | A package store holds `.wasm`, fonts and textures beside the modules. Advertised even though whole objects are served: it tells a **proxy** it may serve ranges from its cached copy, which is where the win is.                                                                                       |
| `cross-origin-resource-policy: cross-origin`         | Host and realm server are different origins; without it the module is blocked outright under cross-origin isolation. Declared here rather than delegated, because the store is meant to be servable from a bare filesystem or an S3 bucket with nothing clever in front.                               |
| `last-modified` from `publishedAt`                   | The seal's clock, identical on every mirror — an mtime records when THIS disk received the bytes.                                                                                                                                                                                                      |

`If-None-Match` now answers `304`, verified. Worth having even under
`immutable`: a cold proxy revalidating a year-old object, and every client that
ignores `immutable` on a forced reload, both land there.

### The bug this pass fixed, which this pass also caused

Making the same URL answer two ways — `.gts` as source under
`Accept: application/vnd.card+source`, compiled `.js` otherwise (§8.5) — is
content negotiation, and **content negotiation without `Vary` poisons shared
caches**. An editor's source fetch would be stored and then served to a browser
about to evaluate it as a module: raw TypeScript, `Unexpected token`, and it
only reproduces once a proxy is in front, which is exactly when it is hardest
to find.

Fixed with `Vary: Accept` and per-representation ETags (`…:index.js` vs
`…:index.gts`), so a cache keeps them apart by validator as well as by key.

**Better still would be two URLs and no negotiation at all** — `Vary` fragments
a cache entry per distinct `Accept` string, and clients send wildly different
ones. The source door wants its own address. Noted as owed; the current
behaviour is correct in the meantime.

Content types are answered here rather than left to `mime-types`, which has
never heard of `.gts`/`.gjs` and returns `application/octet-stream` on a miss —
a browser downloads that instead of showing it, and a module loader will not
evaluate it. Verified: module → `application/javascript` (by `.js`, by `.gts`
with no Accept, and extensionless), source → `application/vnd.card+source`.

### Still owed, in order

1. **Two URLs instead of `Vary`.** Removes the cache-fragmentation hazard
   entirely and deletes the negotiation branch.
2. **Serve the precompressed sibling.** K9 already derives minified + gzipped
   Versions; serving them under `content-encoding` with `Vary: Accept-Encoding`
   is pure win on an immutable object, since the compression can be done once
   at publish rather than per request.
3. **Stream instead of buffering.** `readStoredFile` returns a `Buffer`, so a
   large asset is fully resident before a byte goes out. The per-file tree
   store could stream straight from disk, and an S3 backend wants that shape
   anyway. This one lives in `packages/deck`, which is **vendored verbatim** —
   it has to be fixed in `~/Projects/deck` first and pulled through, not
   patched here.
4. **Real `206` responses.** `accept-ranges` currently tells the truth for a
   proxy but this handler still answers whole objects.

HTTP/3 needs nothing from this layer beyond what is here: it makes many small
requests cheap, which suits per-module fetching, and everything above is
transport-agnostic. The work is in the proxy, not the store.

### 10.1 Two doors, and `Vary` deleted

`/_packages/…` is the MODULE door: ask for `index.gts` (or `index`) and you get
the compiled `index.js` the pack sealed beside it, because a consumer at that
address is about to evaluate what it receives. `/_source/…` is the SOURCE door:
exactly the bytes at exactly the path.

`Accept` now decides nothing. Verified on one path, `northwind/records@1.1.1/index.gts`:

| Door          | content-type                  | etag              | body     |
| ------------- | ----------------------------- | ----------------- | -------- |
| `/_packages/` | `application/javascript`      | `…c444:index.js`  | compiled |
| `/_source/`   | `application/vnd.card+source` | `…c444:index.gts` | authored |

Same request with `Accept: application/vnd.card+source` on the module door
returns compiled JS — the header is inert, which is the point.

**Why this beats one negotiated URL.** `Vary: Accept` fragments a cache entry
per distinct `Accept` string, and clients send wildly different ones — so the
hottest URLs in the system would cache worst. And omitting `Vary`, which the
first version did, lets a shared cache hand an editor's TypeScript to a browser
about to run it as a module: silent, and only reproducible once a proxy is in
front. Two addresses have neither problem and need no header to explain them.

(`Vary: Origin` remains on responses. That is the CORS middleware's, it is
correct, and it is not this handler's.)

### 10.2 Authorization: published bytes inherit their realm's read permission

The doors were world-readable, which is fine while every realm is public and
wrong the moment one is not — silently, which is the bad kind.

**The store could not answer the question.** It is server-wide, and a version
record carries `treeHash`, `publishedAt` and `upstream` but no owner. So
`lib/package-origins.ts` records the publishing realm at accept time —
`proposal.origin.realm`, which the proposal already carried.

A sidecar beside the store rather than a field on the record, for three
reasons. The store format lives in `packages/deck`, which is **vendored
verbatim** here. Origin is also not Deck's business — Deck is a
content-addressed store that knows nothing about realms, and teaching it would
push an authorization concept into the one layer whose value is not having one.
And it stays a **file**: it replicates with the store, survives a restore, and
needs no migration, so a store on a filesystem or in an S3 bucket still carries
its own provenance.

Verified, all three paths:

```
origin = a public realm      → 200
origin = a realm you cannot read → 403  "published by …, which you may not read"
no origin (vendored npm)     → 200
```

**NO ORIGIN MEANS PUBLIC, deliberately.** The store also holds vendored
third-party mirrors — `lib/three` and friends — which were public npm bytes
before they were vendored and have no owning realm to inherit from. Gating
those would break every consumer to protect nothing.

**This is the one database read on the path, and it is the right one.** ACLs
live in Postgres; "may this user read" is a different question from "what does
this specifier mean" or "what are these bytes", which are the two §9 keeps out
of the database. It also collapses for the common case — a public realm answers
yes for everyone, forever — so the hot path stays effectively database-free.

403 rather than 404: the address is real and well-formed, and pretending the
package does not exist would send a legitimate consumer chasing a publish that
already happened.

**Not yet exercised in anger.** Every package in this corpus predates origin
recording, so all of them take the "no origin → public" branch; the three
results above were produced by writing the sidecar by hand. A genuine test
wants a private realm publishing a package and a second user being refused, and
this corpus has no private realm in it.

### 10.3 Precompressed variants, derived once

Brotli and gzip, negotiated on `Accept-Encoding`, verified on
`northwind/records@1.1.1/index.js`:

```
identity   41,767 bytes
gzip       11,132 bytes
br          9,465 bytes   (77% off)
br;q=0     → falls back to gzip
```

**The compressed bytes are a CACHE, never part of the seal.** The obvious move
is to compress at publish and seal the `.br` beside the source; it is wrong,
and the reason matters: **compressed output is not reproducible**. gzip and
brotli do not promise byte-identical results across library versions or build
flags, so sealing them would make a Version's `treeHash` depend on whichever
zlib the publishing machine linked. A content-addressed store whose digest
moves with the toolchain is not content-addressed — and Deck's determinism is
the whole asset.

So variants live in `<store>-derived/<aa>/<treeHash>/<sha256(path)>.<enc>`,
keyed by the digest of the immutable input. **That needs no invalidation
either**: a new Version has a new digest and therefore a new path, so nothing
can ever be stale. The same trick the HTTP layer uses, applied on disk — and a
key an S3 bucket takes verbatim.

Brotli runs at quality 11, which is normally far too slow to consider. It is
correct here precisely because the input is immutable: the cost is paid once
per Version and read from disk forever after, so the usual latency argument
does not apply.

**`Vary: Accept-Encoding` is back, and it is not the `Vary` §10.1 deleted.**
`Accept-Encoding` has a handful of real values and every CDN normalises it to a
canonical set before keying; `Accept` is unbounded and normalised by nobody.
Bounded cardinality is the whole difference between a `Vary` that works and one
that shreds a cache. The ETag carries the encoding too (`…:index.js:br`),
because a compressed body and an identity body are different bytes — a cache
keying them together would eventually hand a client a compressed body with no
`content-encoding`, which decodes to nothing.

Compression is skipped below 1 KiB (a gzip header is 18 bytes before any
payload, and a transfer that small is latency-bound anyway) and restricted to
an allowlist of text-ish types, so a new binary format added to the store
defaults to being left alone rather than pointlessly recompressed. If the
output is not smaller than the input, identity is served — never a larger body
wearing a smaller name.

### 10.4 Real `206` responses

Every form clients actually send, verified:

```
bytes=0-19      → 206  content-range: bytes 0-19/41767        20 bytes
bytes=100-      → 206  content-range: bytes 100-41766/41767
bytes=-12       → 206  content-range: bytes 41755-41766/41767  (the real tail)
bytes=99999999- → 416  content-range: bytes */41767
bytes=0-9,20-29 → 200  whole body
```

Multi-range answers the whole body rather than building a
`multipart/byteranges` document. The spec explicitly permits it, and no client
of this store asks for one — the alternative is a body format with its own
boundary parsing that would exist solely to be untested.

416 states the real length, so a client that guessed can correct itself in one
more request instead of probing.

**The range is taken over the representation actually sent**, which is why it
is computed AFTER the encoding decision: a range names bytes of the _encoded_
body, and slicing the original then labelling it `content-encoding: br` would
hand back an offset into the wrong stream.

### 10.5 One honest note about the dev proxy

With `Accept-Encoding` deliberately blanked, the client still saw a full-size
body — and an ETag ending `:gzip`. Traefik injects `Accept-Encoding: gzip`
toward the origin and decompresses for a client that did not ask, forwarding
the origin's ETag as it goes. The origin's own response is coherent (gzip body,
`content-length: 11132`, matching ETag, `Vary: Accept-Encoding`); the
normalisation is the proxy's.

Worth knowing before reading these headers through a proxy and concluding the
server is confused. It also does the right thing where it counts: Traefik does
not inject an encoding on a `Range` request, which is why the `content-range`
figures above are over identity bytes.

### 10.6 Remaining, after this pass

Only one of §10's four is left: **streaming instead of buffering**.
`readStoredFile` returns a `Buffer`, so a large asset is fully resident before
a byte goes out. The per-file tree store could stream straight from disk and an
S3 backend wants that shape anyway — but it lives in `packages/deck`, which is
**vendored verbatim**, so it belongs in `~/Projects/deck` first and gets pulled
through rather than patched here.
