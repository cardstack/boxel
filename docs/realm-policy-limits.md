# What a realm's policy does not do

A realm's policy (`RealmPolicy`, pointed at by the `policy` field of the
realm's `realm.json`) lets a caller the realm's own permissions decline invoke
an operation on a card, when a grant's predicate holds for that card. How to
write one is in [card operations](card-operations.md#the-card-routes-and-a-realms-policy)
and the `realm-policy-authoring` skill.

This page is the other half: the limits of what a policy enforces. Each is
deliberate, and each is the kind a reader only learns about when it bites. So
read all of them before relying on a policy for anything that matters:

1. [A policy only widens](#a-policy-only-widens)
2. [A predicate that reads the index is a window](#a-predicate-that-reads-the-index-is-a-window)
3. [Search is not a prompt revocation boundary](#search-is-not-a-prompt-revocation-boundary)
4. [A card's stored source is the whole card](#a-cards-stored-source-is-the-whole-card)
5. [A grant on a card reaches what the card carries](#a-grant-on-a-card-reaches-what-the-card-carries)
6. [An id list beside a list of links is authorization](#an-id-list-beside-a-list-of-links-is-authorization)
7. [A write is judged against the state it changes](#a-write-is-judged-against-the-state-it-changes)
8. [Timing is not covered](#timing-is-not-covered)
9. [Any writer of a realm controls its policy](#any-writer-of-a-realm-controls-its-policy)
10. [A caller who cannot read the realm does not name their cards](#a-caller-who-cannot-read-the-realm-does-not-name-their-cards)
11. [Who is told a realm is archived](#who-is-told-a-realm-is-archived)
12. [Search leaves out a subtype that redeclares a compared field](#search-leaves-out-a-subtype-that-redeclares-a-compared-field)

Where a test pins one of these, the section names it. The test asserts the
behavior described here, including the parts that look like bugs, so a change
to the behavior is a change to this page too.

## A policy only widens

**Nothing in a policy removes access the realm's permissions grant.** The
policy is consulted only for a caller the realm's permissions decline. A
caller the permissions let read the realm reads every card in it, and a realm
writer writes every card in it, whatever the policy says. Their requests never
load the policy and never evaluate a predicate.

So a policy cannot hide a card from a realm reader, keep a writer off a field,
or give a realm writer less than full write. To narrow what someone can do,
take the realm permission away and grant back, through the policy, the
operations they should keep.

A declaration marked `nonGrantable` is the same rule from the other side: no
grant reaches it, so only a caller the realm's permissions allow invokes it. It
narrows nothing a permission grants.

A grant cannot give a caller realm-owner authority either: a route that needs
an owner, such as `_permissions`, answers on the realm's permissions alone.

## A predicate that reads the index is a window

**A grant whose predicate is annotated `snapshot: true` authorizes against the
card's index row, and the index lags the card's stored source.** A computed
value and a linked card's fields are in the index only, so a predicate that
reads one must carry the annotation, and accepts the window when it does.

If a classroom's `headTeacher` is computed from its roster, removing someone
from the roster does not stop a grant on `.headTeacher == actor()` admitting
them until the classroom is indexed again. That holds at the gate, for a read,
and under the write lock, for a write: a write's predicate reads the row as it
stands when the lock is taken.

A predicate that reads only the card's stored source (its own values, its
contained values, and the ids its links hold) has no such window: a write that
takes the caller off the card is seen by the next request. A realm that needs
a grant to stop admitting as soon as a card changes writes its predicate
against the stored source. Each decision a snapshot predicate makes is logged
as `policy-snapshot-read` on the `boxel:operations` channel, so an operator can
count the windows a realm has accepted. The details are in
[What a predicate reads](card-operations.md#what-a-predicate-reads).

## Search is not a prompt revocation boundary

**Removing someone from a card stops a direct read on the next request. A
search keeps returning the card until it is reindexed.** A direct read judges
the card as stored. A search composes the grant into a filter over the index,
so it is exactly as fresh as the index.

| What changed                                        | Direct reads and writes                                   | Search                                         |
| --------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| a value on the card a predicate reads               | the next request                                          | the next index pass of that card               |
| a computed value or linked card a predicate reads   | the next index pass of that card (a `snapshot` predicate) | the next index pass of that card               |
| the policy card                                     | the policy card's next index pass                         | the policy card's next index pass              |
| a setting a predicate reads through `realmConfig()` | the next index pass of `realm.json`                       | (a `realmConfig()` predicate scopes no search) |
| the realm's `policy` pointer                        | at once                                                   | at once                                        |

A policy-card edit, or an edit to a module a rule's type lives in, takes effect
when its index pass lands: the realm revalidates its compiled policy as soon
as it hears of the pass, and a read that finds the compiled policy more than
five seconds unchecked revalidates it, in case that signal was lost. The settings a predicate reads through `realmConfig()` come from the
indexed `realm.json` in the same way. The `policy` pointer itself is read from
`realm.json` on disk, so a write that changes it takes effect on the next
request. A realm server running on more than one node sees the new pointer on
the others once the realm's index swap is broadcast to them.

So an operator revoking someone's access urgently revokes it on the direct
path: change the card the predicate reads, or the caller's realm permission,
and the next direct read refuses them. Then wait for the reindex, or start one,
before treating search as closed. An explain of a search reports how far
behind the index is, in `search.index.pending`
([Asking about a search](card-operations.md#asking-about-a-search)).

Pinned by "a provider is taken off a schedule" in
`packages/realm-server/tests/realm-policy-school-example-test.ts`.

## A card's stored source is the whole card

**A card's raw `.json` is its whole stored document, including every field a
`read` projection omits.** A `readSource` grant serves it, so a `readSource`
grant beside a narrower `read` hands the caller everything the `read` was
written to leave out. Never grant `readSource` casually alongside a `read` with
an `output`.

It is not a superset of a read either. A default `read` carries the linked
cards in `included[]`, and the stored document holds only their ids.

Card writes show the whole card in the same way. A `create` or `update` grant
over the card+json routes (`POST`, `PATCH`) answers with the card's indexed
document, without running the type's `read`, so no `output` narrows it. That
includes a `PATCH` that changes nothing. Grant a card write only where the
caller may see the whole card.

## A grant on a card reaches what the card carries

**A grant decides whether a caller reaches a card. It does not decide what
else that card brings with it.** This is an authoring constraint the realm
helps with, not a boundary it enforces.

- **Linked cards.** A read carries the linked cards in `included[]` by
  default, and a rendered format draws whatever its template draws. Neither
  asks whether the caller is granted the linked card. A teacher granted a
  classroom receives the roster cards it links to, though no rule grants
  anyone the roster.
- **Computed values.** A computed value is part of the card's own attributes,
  and is served whatever the read declares. It can derive from linked cards,
  so a computed `headTeacherEmail` publishes a field of a roster card to
  everyone who reads the classroom.

Two declarations on an operation narrow the first:

- `links` decides how much of the link graph a read or a query carries:
  `'ids'` names each linked card and carries none of them, and on a query
  `'none'` carries no link at all
  ([`links`](card-operations.md#links--how-much-of-the-link-graph-a-read-or-a-query-carries)).
  A viewer's host then fetches each link on its own request, which the
  linked card's own grants decide.
- `html` on a named query marks the prerendered formats a listing must not
  serve (`'unshareable'`), for formats whose templates draw linked cards
  ([`html`](card-operations.md#html--which-prerendered-formats-a-read-or-a-query-serves)).

Compiling the policy warns where a grant would carry a type no rule grants:
`grant-reaches-ungranted-type` for the document a read or query answers with,
and `render-reaches-ungranted-type` for the formats it renders. Both are
warnings, and the grant stays live. Nothing narrows or warns about computed
values: keep a computed value that derives from another card's data off any
type a grant reaches, or accept that it is published with the card.

## An id list beside a list of links is authorization

**A realm whose roster is links needs a parallel list of Matrix ids for its
grants to read, and that list is authorization-bearing data that nothing keeps
in step.** `actor()` is the caller's Matrix user id as a string, and a
predicate reads the card's stored source, where a link is only a URL. So a
predicate cannot follow a classroom's `teachers` links to compare the caller
with the roster. The classroom stores `teacherIds` too, and the grant reads
that:

```json
{ "operation": "read", "where": ".teacherIds | any(. == actor())" }
```

Three things follow:

- **The mirror is surface a raw `update` can write.** Whoever can update the
  card can add themselves, or anyone, to `teacherIds`. Never grant a raw
  `update` on a type whose grants read a mirror (see the next section).
- **It can drift from the links it shadows.** Adding a teacher to `teachers`
  does not add their id. The two disagree until someone writes the mirror
  again, and the grant follows the mirror. The school example syncs it by
  hand, from a button that writes the ids from the linked roster cards, and
  shows a warning whenever the two disagree.
- **It is migration debt.** When a policy can resolve the caller to a roster
  card, a predicate can read the links directly, and every realm that grew a
  mirror has a field to retire and a set of grants to rewrite. Don't grow one
  where the realm's own permissions would serve.

`packages/school-example-realm` shows the mirror, the sync, and why its grants
pair with a named operation rather than with `update`.

## A write is judged against the state it changes

**A write's predicate is decided under the write lock, against the card as it
stands before the write.** Nothing judges the card the write leaves. So a
grant that admits a caller because of a value on the card does not stop that
caller writing the value. There are three shapes of this:

- **Escape by transfer.** A caller admitted because they are on the card
  writes themselves off it, or hands it to someone else, and the write
  succeeds. A teacher granted `update` on classrooms whose `teacherIds` hold
  them can set `teacherIds` to a colleague's id. The write is allowed, and
  their next write is refused.
- **Chaining into a second grant.** One write sets up the value a different
  grant reads. A caller granted `update` on a card, and `delete` where a
  field names them, writes the field and then deletes the card. A later entry
  in the same batch is judged by the card the earlier entry leaves, so the
  chain can run in one request.
- **Re-pointing the authorizing field.** A caller admitted by a field rewrites
  it to admit someone the grant was never meant to reach: a teacher adds a
  friend to `teacherIds`, and the friend now reads the classroom.

The authoring rules that contain it:

- **Keep the field a predicate reads out of reach of the grant it
  authorizes.** Grant a named operation that writes only what the caller
  should change, never a raw `update` on a type whose grants read the card's
  own fields.
- **Judge a create by the card it is anchored on.** A named create anchored on
  a card is judged by that card, and writes a new one. The school example's
  `appendActivity` is judged by its classroom's `teacherIds`, which it cannot
  write.
- **Mark the operation that writes authorization `nonGrantable`.** The
  operation that changes who is on a card, such as a roster sync, is then
  invoked only by a caller the realm's permissions allow.

Pinned by "a write is authorized on the state before it, so it may write the
field that authorized it" and "a named create anchored on a card is judged by
that card, which it cannot write" in
`packages/realm-server/tests/realm-policy-write-lock-test.ts`.

## Timing is not covered

**A caller who cannot read the realm can tell a card the policy refused them
from one that does not exist, by measuring how long the refusal takes.** The
two answers are the same 404, byte for byte. But a card that does not exist is
refused before any predicate runs, and a card the policy refused had a
predicate evaluated against it. A caller who measures carefully can separate
the two, and so learn which cards exist. The realm does not pad either answer.

## Any writer of a realm controls its policy

**The policy pointer is the `policy` field on the realm's config card,
`realm.json`, and writing `realm.json` needs realm write, not realm owner.**
Whoever can write the realm decides which policy governs it, or that none
does. A grant can never reach `realm.json`: no policy grant reads it, reads its
source or writes it, and a policy-scoped search leaves it out. A realm writer
needs none.

That includes pointing the realm at a policy card in a realm the writer cannot
read. The realm loads and applies the card on the server's authority, not the
writer's. So its answers tell the writer whether a compiling policy sits at
that URL and what it grants: a pointer to a card that does not compile turns
every refusal into a 500, and a pointer to one that does admits whoever its
grants admit. A policy's rules are not secret from the writers of other realms
on the same server. `validatePolicy` on the config card refuses such a writer,
but the realm's behavior answers anyway.

## A caller who cannot read the realm does not name their cards

**A caller the policy admits to create cards, who cannot read the realm, gets
a realm-minted id for every card they create.** A create mints a card where
nothing is stored and is refused where a card is, so letting such a caller
choose the path would tell them which paths hold a card.

- A `lid` still links cards within a batch, and the result echoes it as
  `{ lid, id }`. But it names no file.
- Re-sending a create mints a duplicate, since the `lid` is not the card's
  identity.
- Such a caller's card+json `POST` must target the realm root. One aimed at a
  directory beneath it gets the 404 a missing card gets.

A caller who can read the realm, including one a grant reaches, keeps choosing
their own ids, and is told when one is taken
([The card routes and a realm's policy](card-operations.md#the-card-routes-and-a-realms-policy)).

## Who is told a realm is archived

**An archived realm answers with its seal (a 403, code `archived`), and in a
realm with a policy, who is told depends on what they would have been allowed
to do.**

- A caller the realm's permissions allow meets the seal wherever the realm is
  sealed, whatever the policy grants them.
- A caller the policy admits meets the seal only where a grant would admit
  them. Where no grant would, they get the answer the realm gives while it is
  active, so the seal does not tell them anything a grant doesn't.
- On the routes that serve stored bytes (the `card+source` read and the file
  serve of a data file or a card's `.json`), any signed-in caller of an
  archived, private realm with a policy is told it is archived, whether or
  not a grant reaches the file.

## Search leaves out a subtype that redeclares a compared field

**A `query` grant's filter does not judge the cards of a subtype that declares
the compared field differently, so a search through that grant never returns
them.** A grant like `.providerId == actor()` compiles to a filter comparing
`providerId`. A subtype in the governed realm may declare `providerId` as
something else: a computed field, a query-backed one, another type, a list, or
not at all. The filter cannot compare that field as the rule's type declares
it, so the compiled filter excludes the subtype's cards rather than misjudge
them.

A direct `GET` of one of those cards is decided by the predicate against the
card itself, so it may still admit the caller. The card is reachable and does
not appear in search.

An explain does not name the types left out, but the guard is
visible in the explained search fragment, in `search.fragment`: the comparison
sits beside a `not` of the subtype. A subtype that declares the field back as
the rule's type declares it is judged as normal.
