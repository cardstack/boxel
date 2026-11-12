---
status: proposed
date: 2026-11-09
scope:
  - packages/runtime-common/query.ts
  - packages/runtime-common/query-syntax.ts
  - packages/runtime-common/query-grammar.ts
  - packages/runtime-common/binding-reference.ts
  - packages/runtime-common/search-bounds.ts
  - packages/runtime-common/index-query-engine.ts
  - packages/runtime-common/query-engine/**
  - packages/runtime-common/realm-index-query-engine.ts
  - packages/runtime-common/search-entry.ts
  - packages/runtime-common/vector-query.ts
  - packages/runtime-common/log-query.ts
  - packages/runtime-common/formula-sql.ts
  - packages/runtime-common/helpers/ai.ts
  - packages/host/app/utils/search/**
  - packages/host/app/services/store.ts
  - packages/runtime-common/card-operations/lowering.ts
  - packages/runtime-common/query-field-utils.ts
  - packages/bxl/src/bxl/sql/**
  - packages/postgres/migrations/**
  - docs/search.md
---

# 032. Keep the answer a saved query gives, and read the older spelling as it always was

Queries live in realms: in query-backed fields, saved searches, and card
data. Their authors are people and agents who are not watching when the
engine changes, and a realm's content is its author's, often on a realm
server we do not run. So a change to the engine must not change what a saved
query returns. A query in the older spelling is read exactly as it always
was, unknown members and all. A query in the newer spelling is checked
strictly, so a mistake is refused with a code instead of answered with
nothing. Which spelling a query is in, and what each reads leniently or
strictly, is in [Search](../search.md#compatibility-older-and-newer-spellings).

## 1. Decision

### 1.1. A saved query keeps its answer

A change to the query engine MUST NOT change the answer to a query that the
engine accepts today. The one exception is a fix to an answer that
contradicts the documented semantics. Such a fix MUST be listed, with the old
and the new behavior, in
[Search](../search.md#compatibility-older-and-newer-spellings) in the change
that makes it. This applies equally to a change made in a migration, such as
a SQL function the engine calls.

`matches` is interactive text search, so a change to how it matches or
ranks words MAY change a saved query's answer, in either spelling. Such a
change MUST be listed the same way. A total MUST stay exact where it was
exact: a query in the older spelling counts every match, as it always did.

The platform MUST NOT rewrite a query stored in a realm to keep its answer.

### 1.2. The older spelling is read leniently

A query in the older spelling MUST be read as it always was. A member that it
ignored before MUST still be ignored, and a value it read before MUST still be
read the same way. New strictness MUST NOT apply to it.

### 1.3. The newer spelling is read strictly

A query in the newer spelling MUST be refused, with a stable error code, when
it has an unknown member, a value of the wrong kind, or a request the engine
cannot answer. The engine MUST NOT answer such a query with an empty or a
partial result instead. An error code MUST NOT change its meaning once it has
shipped.

### 1.4. One meaning, detected from the query alone

Every query in the newer spelling MUST lower to exactly one query in the
older spelling, and both MUST run the same SQL. Which spelling a query is in
MUST be decided from the query alone. A new marker of the newer spelling MUST
be one that no query in the older spelling can contain.

The engine's own form, which lowering yields and the host sends over the
wire, is `main`'s grammar plus the V2 members, with `on` on every node, so
the server cannot tell it from an author's query that mixes the two and MUST
accept it, reading it strictly. A rule about how an author writes a newer
query that the engine form would break, such as naming the query's type with
a top-level `type` rather than an `on` on the top filter node
(`mixed-spelling`), MUST be enforced where the author's query first arrives,
before lowering: the host's card searches, the AI assistant's search tools,
and a query-backed field's definition. The server's check is the strictness
rule; the authoring rule is the surfaces'.

### 1.5. Saved labels resolve once

A query saved with field labels SHOULD have its labels resolved to field
paths when it is saved, against the types as they are then, so that a later
schema change cannot make a saved query ambiguous.

### 1.6. An addition every older query refused is read in both spellings

A spelling that every query in the older spelling was refused for — such as
a type written as the string `"<module>#<Name>"` (ADR 035),
which the older reading refused as `type is not valid` — MAY be accepted in
both spellings, and MUST NOT by itself make a query the newer spelling. An
older query that adopts it is still read leniently (§1.2).

### 1.7. The older spelling is frozen

The older spelling is exactly the grammar `main` had before Query V2, a
compatibility layer for the queries saved under it, and MUST NOT grow. Its
reading MUST stay as it is: lenient (§1.2), with its older and looser
limits, and with the answers it gave before Query V2, apart from the fixes
listed under §1.1.

Every member and value form that `main`'s grammar did not have MUST mark a
query as the newer spelling (§1.4), so a query that uses any of it is read
strictly as a whole, with the newer defaults. This covers the whole-query
members Query V2 added (`let`, `facets`, `collapse`, `select`,
`explain`, `timeZone`, `page.total`, `page.exactTotal`), its filter
operators and options, its sort spellings, and anything added from now on. An unknown member is
not such a marker: one the older spelling ignored (§1.2) is still ignored.
The engine's own form, which lowering yields, is `main`'s grammar plus these
members and is never lowered again.

What the older spelling ignores and refuses is listed in
[Search](../search.md#compatibility-older-and-newer-spellings).

### 1.8. A caveat is a warning; a flag main exposed stays

A response MUST report a caveat (an answer usable but not exactly what was
asked: a total that is a lower bound, an approximate order, a cut set) as a
coded entry in `meta.warnings`, never as a new flag elsewhere in `meta`.
`meta` holds facts. A flag a released response already carried (`main`'s
`meta.incomplete` and `meta.linkClosureTruncated`) MUST still be sent, in
both spellings, since clients read it whatever spelling their query was in;
its warning MAY be sent beside it. The codes are listed in
[Search](../search.md#warnings), and a code MUST NOT change its meaning once
it has shipped.

## 2. Rationale

The engine cannot migrate the queries it serves. They are spread across
realms, and in a federation (ADR 004) across realm servers whose operators
upgrade on their own schedule. A query-backed field is also part of a card's
definition: a changed answer changes what the card renders and what its
indexed copy holds, with no edit by its author. So compatibility has to be the
engine's job, and the default has to be that nothing changes.

The two readings serve two kinds of query. An older query was written
against the engine's lenient behavior, and some rely on it without knowing,
for example with an ignored `page.cursor`. A newer query is usually written
by an agent, and the most common failure of an agent's query is a name that
does not exist. Answered leniently, it returns nothing, and the agent reads
"no results" as a fact. Refused with a code that names the problem, it is
fixed on the next try.

Detecting the spelling from the query keeps both readings without a version
number, which every saved query would otherwise need, and which agents would
forget to write.

Freezing the older spelling keeps the compatibility layer finite. Each new
feature it accepted would need its own lenient reading, and the two readings
would drift apart. With new grammar newer-only, the older reading is a fixed
target that its tests pin once, and every new feature is checked strictly.

Warnings carry a code and a message, so one list serves every caveat and a
new caveat needs no new response member. A client that knows the code acts on
it; one that does not can still show the message. A flag is one more member
to learn per caveat, and says nothing a person can read.

## 3. Considered options

- **Detect the spelling from the query; lenient old, strict new (chosen).**
- **A version member in every query.** It is explicit, but every saved
  query would need a rewrite to gain it, and a missing version is itself
  ambiguous.
- **Migrate saved queries in realms.** The platform does not own realm
  content, cannot reach realms on other servers, and a rewrite loses the
  author's text.
- **Strict everywhere.** Saved queries that work today would start failing.
- **Lenient everywhere.** Agents get silent empty answers to mistakes.
- **Resolve labels each time a query runs.** A field added later with a
  similar name would make a saved query ambiguous, or change what it reads.

## 4. Remediation

Known gaps are listed in [remediation/032.md](remediation/032.md).
