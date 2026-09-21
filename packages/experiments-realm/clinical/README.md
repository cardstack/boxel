# Clinical example — cards driven by named operations

A small, synthetic hospital: three patient records, the clinicians looking
after them, the facility they are in, and a ward-round dashboard. Every action
a clinician takes on this data is a **named operation** declared on the card
type as plain data, and every button in the templates invokes one through
`operations()`.

It is here to be copied. If you are adding operations to your own card type,
`patient-record.gts` is the file to read — it carries one of each shape the
authoring surface has.

```
chart-fields.gts        the contained values a record holds in bulk
clinician.gts           Clinician, and the two halves of a transfer
facility.gts            HospitalFacility
patient-record.gts      ConsultRequest, PatientRecord, and the interactive chart
clinical-dashboard.gts  the two saved searches, rendered as entry rows
audit/*.txt             the append-only ledger the batches write to
```

`ConsultRequest` shares a module with `PatientRecord` rather than having one of
its own: the two link to each other, and separate modules would mean a cyclic
import between them. That, plus a chart template with a control for every
operation, is why `patient-record.gts` is long for a card module.

**No patient, clinician or facility here is real.** All of it is invented.

## This example does not restrict who can do anything

Anyone who can write this realm can run every operation below; anyone who can
read it can read every record. Operations are **identity-aware but not
access-enforced**:

- `actor()` tells a declaration who is calling, so an operation can record who
  acted. It does not decide whether they may.
- `assert(…)` guards the **state of the data** — "this event is still open",
  "this clinician is not already consulting". It is never an authorization
  check, and a failed one means the data was not in the shape the operation
  needs, not that the caller lacked permission.
- An `output` projection decides the shape of one operation's answer. A field
  it leaves out is still reachable through the card's plain read, its stored
  source, or a search.

The realm's own read/write permissions are the only thing enforced. Enforcement
at the operation level is a separate project; until it ships, treat every
operation's result as reachable by any caller permitted to use the realm.

## What each operation demonstrates

| Where | Name | Built on | Worth reading for |
| --- | --- | --- | --- |
| `PatientRecord` | `escalateRhythmEvent` | `transform` | a raw `bxl` program whose `assert` is a precondition on stored state |
| `PatientRecord` | `titrateDose` | `transform` | exact-one `select` plus an arithmetic update (`\|= . + …`) |
| `PatientRecord` | `addConsultant` | `transform` | a declarative `assert { unique, by }` over a collection of links, with `append` |
| `PatientRecord` | `transferToIcu` | `transform` | a declarative `set`, including writing a link from a `linkTo` param |
| `PatientRecord` | `recordVitals` | `appendContainsMany` | adding to a collection that grows without bound, without loading the card |
| `PatientRecord` | `requestConsult` | `create` | a named create whose `fill` links the new card back with `instance('id')` |
| `PatientRecord` | `addConsult` | `transform` | the other half of a link, so a batch can create and link in one commit |
| `PatientRecord` | `myPatients` | `query` | a saved search compared against `actor()` |
| `PatientRecord` | `admittedOnUnit` | `query` | a saved search whose filter a payload fills |
| `Clinician` | `acceptCase` | `transform` | a declarative uniqueness guard over contained values |
| `Clinician` | `releaseCase` | `transform` | `del` through a `select`, guarded by an `assert` |

## The two batches

Both are built in `patient-record.gts`, in the isolated template.

**Create and link in one commit.** `requestAndListConsult` mints a
`ConsultRequest`, appends it to the record's own `consults`, and writes a line
to the audit log — three entries, one commit. The create's handle is the local
id (`lid`) the link entry names, so nothing has to read the new card's URL
back, and a failure anywhere leaves all three unwritten.

Note the contrast with `requestConsult` one button to its left: that one is a
single named `create`, because the consult owns the link to the patient and
filling it is the whole of the work. You only need the batch when the *other*
card has to change too.

**A transfer as a parallel group.** `transferToIcu` changes the record, the
receiving clinician's caseload and the releasing clinician's caseload. They
have nothing to say to each other, so they are staged as a parallel group and
commit together — the receiving clinician can never end up holding a case the
record does not show.

## The audit log

`audit/pt-100*.txt` are plain text files in this realm, linked from each record
with `linksTo(FileDef)`. The batches append one line to them with `appendLine`,
in the same commit as the card change.

Two things about them are worth knowing before copying the pattern:

- **The line is composed by the caller.** Which `FileDef` type a realm file
  gets is decided by its extension, so a `.txt` here is base's `TextFileDef`
  and a realm cannot declare its own operations on it. Only the base
  `appendLine` and `update` are available, and the base `appendLine` takes the
  line as its payload. A value the realm knows and the caller does not — the
  authenticated actor — therefore belongs on the card, which is where
  `recordVitals` and `requestConsult` stamp it.
- **The file has to exist.** `appendLine` appends to a file; it does not create
  one. These logs are checked in for that reason.

## Running it

These cards are part of the `experiments` realm, so bring the stack up with
`mise run dev-all` — the `test-services:realm-server` flavor sets
`SKIP_EXPERIMENTS=true` and does not mount this realm at all.

```
https://localhost:4201/experiments/clinical/PatientRecord/pt-1001
https://localhost:4201/experiments/clinical/ClinicalDashboard/cardiology-ward-round
```

Two things about a **cold** stack, both of which make a working button look
broken:

- The realm indexes from scratch on first boot, and until a card's row exists
  the page says it is still being prepared.
- A write's response waits on its own index job, and index passes are
  serialized per realm — so behind a full-realm pass a button can sit in flight
  for minutes with the bytes already on disk. `http://localhost:4210/_indexing-dashboard`
  shows what is queued.

Invoking an operation writes to the realm, which here is this folder in the
working tree. `git checkout -- packages/experiments-realm/clinical` puts the
fixtures back; a named `create` also leaves a new card behind, under
`clinical/ConsultRequest/`.

The authoring guide for everything used here is `docs/card-operations.md` at
the root of this repository.
