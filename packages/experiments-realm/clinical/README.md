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

| Where           | Name                  | Built on             | Worth reading for                                                               |
| --------------- | --------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `PatientRecord` | `escalateRhythmEvent` | `transform`          | a raw `bxl` program whose `assert` is a precondition on stored state            |
| `PatientRecord` | `titrateDose`         | `transform`          | exact-one `select` plus an arithmetic update (`\|= . + …`)                      |
| `PatientRecord` | `addConsultant`       | `transform`          | a declarative `assert { unique, by }` over a collection of links, with `append` |
| `PatientRecord` | `transferToIcu`       | `transform`          | a declarative `set`, including writing a link from a `linkTo` param             |
| `PatientRecord` | `recordVitals`        | `appendContainsMany` | adding to a collection that grows without bound, without loading the card       |
| `PatientRecord` | `requestConsult`      | `create`             | a named create whose `fill` links the new card back with `instance('id')`       |
| `PatientRecord` | `addConsult`          | `transform`          | the other half of a link, so a batch can create and link in one commit          |
| `PatientRecord` | `myPatients`          | `query`              | a saved search compared against `actor()`                                       |
| `PatientRecord` | `admittedOnUnit`      | `query`              | a saved search whose filter a payload fills                                     |
| `Clinician`     | `acceptCase`          | `transform`          | a declarative uniqueness guard over contained values                            |
| `Clinician`     | `releaseCase`         | `transform`          | `del` through a `select`, guarded by an `assert`                                |

## The two batches

Both are built in `patient-record.gts`, in the isolated template.

**Create and link in one commit.** `requestAndListConsult` mints a
`ConsultRequest`, appends it to the record's own `consults`, and writes a line
to the audit log — three entries, one commit. The create's handle is the local
id (`lid`) the link entry names, so nothing has to read the new card's URL
back, and a failure anywhere leaves all three unwritten.

Note the contrast with `requestConsult` one button to its left: that one is a
single named `create`, because the consult owns the link to the patient and
filling it is the whole of the work. You only need the batch when the _other_
card has to change too.

**A transfer as a parallel group.** `transferToIcu` changes the record, the
receiving clinician's caseload and the releasing clinician's caseload. They
have nothing to say to each other, so they are staged as a parallel group and
commit together — the receiving clinician can never end up holding a case the
record does not show.

## The audit log

`audit/pt-100*.log` are plain text files in this realm, linked from each record
with `linksTo(AuditLog)`. The batches append one line to them in the same commit
as the card change.

The log is the one place here where the operation is declared on a **file**
rather than a card, and it is worth reading for that:

```ts
export class AuditLog extends TextFileDef {
  @operation static record = {
    base: 'appendLine',
    params: { what: StringField },
    input: bxl`. + { line: (TEXT(NOW(); "yyyy-mm-dd hh:mm:ss") + " " + actor() + " " + params("what")) }`,
  } satisfies OperationDeclaration;
}
```

and the batches invoke it by name, on the file rather than the card:

```ts
let log = this.record.auditLog;
if (log) {
  b.on(log).record({ what: `consult requested: ${this.consultSpecialty}` });
}
```

Three things about it are worth knowing before copying the pattern:

- **The realm composes the line, not the caller.** An `appendLine` usually
  declares a `line` param, which makes the whole line the caller's to write —
  including the part naming who wrote it. An `input` program is the other
  spelling: it _produces_ the line, so the timestamp and the authenticated
  actor are composed where a caller cannot reach them. The caller chooses what
  to say and never who said it. `. +` merges into the payload rather than
  replacing it, and `NOW()` answers an Excel serial rather than a timestamp, so
  it is formatted — unformatted it would append a number like `46023.518`.
- **A declaration on a file is only reachable if the realm binds the file to
  it.** A stored file's class comes from its extension, and `realm.json` is
  where this realm says which class its own extensions mean:

  ```json
  {
    "attributes": {
      "fileTypes": {
        ".log": { "module": "./clinical/audit-log", "name": "AuditLog" }
      }
    }
  }
  ```

  Without that entry a `.log` is base's `TextFileDef`, the declaration lowers
  and indexes without complaint, and every invocation of it fails to resolve.
  A realm binds which _class_ an extension means; it does not get to say what
  counts as a file, so the extension has to be one the platform already reads
  as one — and not one the platform keeps for itself, which rules out the
  executable extensions and `.json`, where a binding would re-type every module
  or every card instance rather than a realm's own content. The binding is also
  realm-wide, which is why these logs use `.log` rather than `.txt`: every
  `.txt` in this realm would otherwise become an audit log, including a
  hello-world file and three format-preview samples.

- **`appendLine` creates the file it appends to**, so nothing here has to
  exist first, and a binding adds a name rather than taking the base
  operations away: `b.on(log).appendLine({ line })` still works on a bound
  file. These logs are checked in for a different reason — a
  `linksTo(AuditLog)` needs a stored file to hydrate an instance from, and
  `b.on(log)` takes that instance. Where nothing is stored yet, name the path
  instead — `b.on('clinical/audit/pt-1004.log')` — and the first append brings
  the file into being.

## Running it

These cards are part of the `experiments` realm, so bring the stack up with
`dev-all` — the `test-services:realm-server` flavor sets `SKIP_EXPERIMENTS=true`
and does not mount this realm at all. Skipping the realms this example does not
touch keeps the shared index worker off them:

```
SKIP_CATALOG=true SKIP_BOXEL_HOMEPAGE=true SKIP_SUBMISSION=true SKIP_SOFTWARE_FACTORY=true \
  mise run dev-all
```

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
fixtures back.

A named `create` also leaves a new card behind, and not in this folder — a
created card's path is composed from its **type's** name, not from where the
operation was invoked, so `requestConsult` writes to `ConsultRequest/` at the
realm root. Remove it with `rm -rf packages/experiments-realm/ConsultRequest`.
Close the card in the browser before restoring either one, or the open tab
writes its copy back over you.

The authoring guide for everything used here is `docs/card-operations.md` at
the root of this repository.
