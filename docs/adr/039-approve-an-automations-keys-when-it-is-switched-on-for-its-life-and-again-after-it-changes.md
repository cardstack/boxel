---
status: proposed
date: 2026-11-18
scope:
  - packages/runtime-common/automations.ts
  - packages/runtime-common/automation-index-hook.ts
  - packages/runtime-common/automation-admission.ts
  - packages/runtime-common/automation-tick.ts
  - packages/runtime-common/automation-reconcile.ts
  - packages/runtime-common/automation-routes.ts
  - packages/runtime-common/**/*automation-key-approval*
  - packages/realm-server/handlers/handle-automations.ts
  - packages/realm-server/handlers/handle-key-bindings.ts
  - packages/realm-server/lib/key-bindings.ts
  - packages/realm-server/lib/key-binding-batch.ts
  - packages/realm-server/lib/key-binding-revocation.ts
  - packages/realm-server/**/*automation-key-approval*
  - packages/postgres/migrations/*automation*
  - packages/postgres/migrations/*key-binding*
  - packages/host/app/**/*switch-on*
---

# 039. Approve an automation's keys when it is switched on, for its life, and again after it changes

An automation spends keys while nobody watches, and some of those keys belong
to people other than its payer. So every key approval an automation needs is
asked for when it is switched on, not discovered when a run comes due. Until
every approval lands, the automation waits and runs nothing. An approval
belongs to the automation and lasts for its life, so no run asks again. The
approval records what the key's owner saw: the automation's declared
operations, its script, its triggers and its params. An edit to any of them
asks the key's owner again. This ADR builds on ADR 005 (approvals happen only
in the secure window or the CLI), ADR 011 (whom a notice may name) and
ADR 028 (the card holds the definition, and a server row holds the payer and
the state).

## 1. Decision

In this ADR, a _binding_ is the API Keys record of a key owner's approval for
one `callApi` operation in one realm to send a chosen key in one credential
slot. An _automation approval_ is a key owner's approval for one automation to
use one binding. An automation's _approved version_ is its declared
operations, the SHA-256 hash of its script file's content, the timing of each
trigger (kind, cron expression, time zone, `at`, `until`, `count` and
webhook), and its params. A trigger's label is not part of the version.

### 1.1. Switching on asks for every approval

Switching an automation on, and resuming it, MUST check every declared
operation for the payer against the automation's approvals. An automation
with an approval missing MUST be in the state _waiting for key approval_. The
server MUST NOT start a run of the automation's triggers in that state: the
tick MUST NOT enqueue one, and reconcile MUST NOT make one up. When the last
approval lands, the server MUST move the automation to active, compute its
next run from that moment and tell the payer. A slot that passed while the
automation waited MUST NOT run.

### 1.2. An automation approval lives beside its binding

An automation approval MUST be a record in the API Keys tables, one for each
binding the automation uses. It MUST name the automation, the binding and the
key's owner, and MUST record the approved version. It MUST NOT be a field of
the automation's row or of its card. Removing the automation MUST delete its
approvals. Revoking, removing or suspending the binding MUST end every
automation approval of it.

A binding with no matching automation approval MUST NOT serve a run of an
automation's triggers, even when the binding is approved for automations.

### 1.3. One step when the payer owns every key

When the payer owns every key the missing approvals need, the switch-on flow
MUST open the secure window in approve mode for those approvals. A
`{{userKey}}` slot needs the payer's own key. An `{{apiKey}}` slot needs a
share in the realm. The payer owns that share when the payer owns the key it
holds. One confirmation in the secure window MUST write the bindings it needs
and the automation approvals. The app page MUST NOT write an approval itself
(ADR 005 §1.1). When the payer closes the window without confirming, the
automation MUST stay in _waiting for key approval_.

### 1.4. A notice for every other key's owner

Each other key owner a missing approval needs MUST get a notice. The app's
API Keys badge MUST count it, and it MUST link to the secure window's approve
page. The notice MUST name the realm, the automation, and each operation with
its destination. It MUST NOT name the payer to the key's owner except as
ADR 011 §1.2 allows. When an `{{apiKey}}` slot has no share in the realm, the
realm's direct writers MUST get a notice to share a key. A notice MUST end
when the approval it asks for lands or the automation is removed.

A missing approval MUST NOT fail a run. The automation waits instead.

### 1.5. An approval lasts for the life of the automation

A run of the automation's triggers MUST use an automation approval that
matches the automation's current version with no further approval. An
automation approval MUST end only when its binding ends (§1.2), when the
automation is removed, or when the automation's version changes (§1.6).

### 1.6. A change to the version asks again

When the index sees an edit to the automation's card or to its script file,
the server MUST compare the automation's new version with each approval's
version. On any difference, the server MUST move the automation to _waiting
for key approval_ at once, never at its next run. The notices of §1.4 and the
one-step path of §1.3 MUST apply as at switch-on. A paused automation MUST
stay paused, and its resume MUST check the approvals (§1.1). An edit that
leaves the version the same, such as a renamed trigger label, MUST NOT ask
again.

A change to the vendor request an operation sends is a change to the binding,
not to the automation. It follows the API Keys rules, which move the binding
to `needs-reapproval`.

### 1.7. Admission checks every run

Admission MUST check each run of the automation's triggers against the
automation's approvals, and against the version computed from the card and
the script that the attempt reads. A run MUST be refused when an approval it
needs has ended or doesn't match that version. Such a refusal means that an
approval ended or the automation changed after it was approved. It never
means that the approval was not asked for.

Preview and Run now act as the direct writer who starts them (ADR 028). They
MAY use a binding approved for automations without an automation approval,
because a Preview runs before an automation is switched on.

## 2. Rationale

A binding approved for automations lets any run in the realm use the key, and
that includes an automation the key's owner never saw. Anyone who can edit
the card or the script file can change what that run does. So the approval
has to name the automation and the version the owner agreed to. Then an edit
that changes what the key is spent on goes back to the owner.

The approval is asked for at switch-on because that is when the automation's
row and payer come to exist. Before then there is nothing to approve for.
Afterwards, a missing approval would surface only as a failed run, possibly
hours later and possibly unseen. A waiting state shows the problem in the
console at once, and it costs nothing while it lasts.

The record lives beside the binding because the key's owner, not the payer,
controls it. Revocation, share suspension, key deletion and grant removal
already reach bindings. An approval kept beside the binding ends with it,
with no second path to keep in step. An automation can also need approvals
from several owners, each of whom may approve a different version. The
automation's row has one payer and one state, so it can't hold those.

The script is hashed because it is a separate file. An edit to the script
file doesn't change the card. The triggers and params are in the version
because they decide how often the key is spent and on what. Labels are left
out because they only name a trigger's run count (ADR 028 §1.4).

The payer usually owns the keys, so most automations need only one
confirmation, and it fits inside switch-on. The secure window still makes
that confirmation, because card code can reach the app page (ADR 005).

## 3. Considered options

- **Approval at switch-on, recorded per automation and version (chosen).**
- **Approval per run.** This is too onerous for the key's owner. A scheduled
  run would stall until someone answered.
- **Approval per realm operation only, as interactive use works.** An edit to
  the script, the schedule or the params would change what the key's owner
  agreed to without asking.
- **Discover a missing approval at the first run.** The automation would
  silently fail its first runs.
- **Ask only the payer, never the key's owner.** The automation would spend
  someone else's key without consent.
- **Keep the approval on the automation's row.** The key's owner controls the
  approval, and the row has room for only one payer's view. Revoking a
  binding would also need a second path to reach the row.

## 4. Remediation

Known gaps are listed in [remediation/039.md](remediation/039.md).
