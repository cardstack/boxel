# Two writers on one realm, and a fairness number the run prints itself

## The question this has to answer

Does a write wait on another person's indexing?

Today the load harness cannot be pointed at that question. Every write in a run
comes from one Matrix identity, so a run produces no two-identity contention at
all — and a measurement that reports "no unfairness" because no two writers
existed says nothing about whether the lane is fair. The staging window that
prompted this had 107 index passes, zero of them blocked, and three initiators
none of whom shared a realm.

Three separate things stand in the way, and each one is enough on its own:

1. A realm's write permission belongs to its owner, so the second writer's
   first POST is a 403. Granting write to a second account is a manual step
   nobody has a command for.
2. Every writer in a run drives the same `write` block, so even two writing
   identities would issue indistinguishable work — and the interesting case is
   an expensive write and a cheap one overlapping.
3. Nothing in the run summary reports the answer. It lives in `jobs` rows,
   which means an AWS session and a SQL prompt.

## What gets built

### 1. The grant becomes a command

`setup-realm.ts` already leaves "grant the other users read access" to the
operator as a UI step. The realm exposes `PATCH /_permissions` to its owner, so
there is no reason for that to be manual. The setup script will grant every
non-owner row in the credential file `read`, and the first `--write-grants N`
of them `read` + `write` as well (default 1, so a two-identity write run works
out of the box; `0` restores today's read-only shape).

`realm-owner` cannot be granted or modified through that endpoint, which is
what keeps this from being a privilege-escalation tool — the owner is whoever
`realm create` made the owner.

### 2. A run can name a write block per writer

The workload file gains a `writes` array beside today's single `write`:

```json
"writes": [
  {
    "label": "hub",
    "method": "PATCH",
    "path": "Course/intro-to-fairness",
    "everyMs": 30000,
    "adoptsFrom": { "module": "${realm}course", "name": "Course" },
    "attributes": { "title": "Intro (rev ${n})" }
  },
  {
    "label": "leaf",
    "username": "loadtest02",
    "everyMs": 5000,
    "adoptsFrom": { "module": "${realm}note", "name": "Note" },
    "attributes": { "title": "Note ${n}" }
  }
]
```

Four members carry the weight:

- **`method: "PATCH"`** — the only way to express a wide fan-out. A POST
  creates a card nothing links to yet, so its index pass visits one file
  however large the realm is. Patching a hub card that many instances link to
  makes the pass visit all of them, which is the expensive write the cheap one
  is supposed to be waiting behind. (A patch that changes nothing leaves the
  file alone and indexes nothing, so the attributes have to vary — `${n}` and
  `${date}` already do.)
- **`everyMs`** — a per-block cadence. This is what produces both halves of the
  measurement rather than one: a hub every 30 s and a leaf every 5 s gives leaf
  writes that land inside a hub pass and leaf writes that do not, from one run.
  Two blocks on one cadence fire in lockstep and leave no uncontended baseline.
- **`username`** — pins a block to a specific credential row, so "writer A on
  realm R, writer B on realm R, A ≠ B" is stated in the file rather than being
  a property of the order the CSV happens to be in. Unpinned blocks take
  sessions in file order, as today.
- **`label`** — names the block in the summary, so hub and leaf are never
  averaged together.

`write` (singular) keeps working and means a one-block `writes`. Both present
is an error.

Before the first write, each writer decodes the `permissions` claim out of its
own realm JWT and the run refuses to start if a writer cannot write — naming
the user, the realm, and the grant command — instead of discovering it as three
error lines and a run full of write failures.

### 3. The run summary reports the fairness split

The harness has no database and must not grow one: it runs from a CloudShell
session with `fetch` and nothing else. So the measurement comes from what the
driver itself observes — every write's identity, block, start and end.

A card write waits on its own index pass (`enqueue`, then `awaitIndex`), so a
write's window contains the lane wait. From the windows:

- **overlapped** — two write windows intersect.
- **behind** — a write started inside another's window and finished no earlier
  than it. Under one lane per realm that is forced: the second pass cannot be
  claimed until the first releases. Under a per-writer lane it is not. So this
  count is the thing that moves when the lane splits, which is what makes it
  worth printing rather than just "overlapped".
- Each split by **same identity** (the CS-13039 case) against **different
  identity** (the CS-13053 case).

The headline is the count the acceptance criterion asks for — writes blocked
behind a different identity — and the score is, per block:

```
fairness = median latency with the lane to itself
         ÷ median latency while blocked behind another identity
```

1.00 means being blocked cost nothing. Lower means the block paid someone
else's pass.

**An empty bucket prints `not measured`, never `1.00`.** That is the whole
point of the ticket: a run with no contention scoring a perfect 1.00 is what
made the staging number unreadable, and the output has to refuse to produce
that reading.

Writes also start carrying `x-boxel-logging-correlation-id`, which the realm
server already reads on the write path and logs beside the `enqueue` /
`awaitIndex` stage split. That is the escape hatch when someone wants the
server's own number for a specific slow write, and it costs one header.

## What this does not claim

The driver sees HTTP windows, not `jobs` rows. "Behind" is a necessary
consequence of a serial lane, not a direct reading of one — a write could
finish after another for its own reasons. The summary says so in its own words
and names the join (`corr=`) that confirms it. The third gap the ticket lists —
the benchmark's browser half authenticating as one user — is the benchmark
protocol's, not the harness's, and is out of scope here.

## Files

| file                         | change                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `lib/workload.ts`            | `writes[]`, `method`, `everyMs`, `username`, `label`; `write` normalizes into it                                                |
| `lib/fairness.ts`            | new — the write ledger, the classification, the rendered section                                                                |
| `lib/permissions.ts`         | new — read/patch `_permissions`, decode the `permissions` claim from a realm JWT                                                |
| `run-load.ts`                | assign blocks to writers, PATCH writes, record windows, preflight write permission, print the section, stamp the correlation id |
| `setup-realm.ts`             | grant read (and write for the first N) to the non-owner rows                                                                    |
| `workload.example.json`      | a two-writer hub/leaf example                                                                                                   |
| `README.md`                  | the cross-writer section                                                                                                        |
| `tests/load-harness-test.ts` | parsing, assignment, and classification — including the empty-bucket refusal                                                    |

## Testing

`packages/realm-server/tests/load-harness-test.ts` is a standalone unit suite —
it runs under `node --experimental-strip-types` against a four-line QUnit
driver in seconds, with no test-pg and no ports — and is where the parsing and
the classification go.

The parts that need a server are exercised by an actual run against a local
stack. The realm for that is purpose-built rather than borrowed: a `Hub` card
with 40 `Leaf` cards linking to it, so a hub PATCH invalidates 41 files and a
leaf POST invalidates one. That asymmetry is the point — a realm without a real
fan-out gives two indistinguishable writes and a fairness score that means
nothing.

Two things that could only be shown by running it did show up that way. The
write-permission preflight refused the first attempt, naming the account with
no grant and printing the `--grants-only` command that fixed it; and
`matrixDomainFor` was taking `URL.host`, so that refusal offered
`@user:localhost:8008` — an id no account has — for pasting into the command it
recommended.
