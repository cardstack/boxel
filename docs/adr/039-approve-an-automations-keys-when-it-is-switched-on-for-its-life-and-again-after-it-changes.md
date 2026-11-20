---
status: proposed
date: 2026-11-18
scope:
  - packages/runtime-common/automations.ts
  - packages/runtime-common/automation-index-hook.ts
  - packages/runtime-common/automation-admission.ts
  - packages/runtime-common/automation-admission-route.ts
  - packages/runtime-common/automation-manual-runs.ts
  - packages/runtime-common/automation-tick.ts
  - packages/runtime-common/automation-reconcile.ts
  - packages/runtime-common/automation-routes.ts
  - packages/runtime-common/tasks/run-automation.ts
  - packages/runtime-common/**/*automation-key-approval*
  - packages/realm-server/handlers/handle-automations.ts
  - packages/realm-server/handlers/handle-key-bindings.ts
  - packages/realm-server/lib/key-bindings.ts
  - packages/realm-server/lib/key-binding-batch.ts
  - packages/realm-server/lib/key-binding-revocation.ts
  - packages/realm-server/**/*automation-key-approval*
  - packages/postgres/migrations/*automation*
  - packages/postgres/migrations/*key-binding*
  - packages/secure-origin/src/shell/keys/approve-page.gts
  - packages/secure-origin/src/shell/keys/approval-batch.ts
  - packages/host/app/services/key-notices.ts
  - packages/host/app/lib/key-notices.ts
---

# 039. Approve an automation's keys when it is switched on, for its life, and again after it changes

An automation spends keys while nobody watches, and some of those keys belong
to people other than its payer. So every key approval an automation needs is
asked for when it is switched on, not discovered when a run comes due. Until
every approval lands, the automation waits and runs nothing. An approval
belongs to the automation and lasts for its life, so no run asks again. The
approval records what the key's owner saw: who pays, the automation's
declared operations, its script, its triggers, its params and its `callApi`
cap. A change to any of them asks the key's owner again. This ADR builds on
ADR 005 (approvals happen only in the secure window or the CLI), ADR 011
(whom a notice may name), ADR 026 (whom a run acts as) and ADR 028 (the card
holds the definition, and a server row holds the payer and the state).

## 1. Decision

In this ADR, a _binding_ is the API Keys record of a key owner's approval for
one `callApi` operation in one realm to send a chosen key in one credential
slot. An _automation approval_ is a key owner's approval for one automation,
named by its card, to use one binding. An automation's _version_ is its
payer, its declared operations, the SHA-256 hash of its script file's
content, its triggers (each one's label and timing), its params, and its
`callApiCalls` cap. An approval _matches_ when the automation's version
equals the approval's, except that a `callApiCalls` cap below the approved
one still matches.

### 1.1. Switching on asks for every approval

Switching an automation on, and resuming it, MUST check every declared
operation against a matching approval. An automation with an approval missing
or not matching MUST be in the state _waiting for key approval_. The server
MUST NOT start a run of the automation's triggers in that state: the tick
MUST NOT enqueue one, reconcile MUST NOT make one up, and admission MUST
refuse one enqueued before the automation began waiting. When every approval
matches, the server MUST move the automation to the state its schedule gives
(active or _done_), computed from that moment, and MUST tell the payer. A
slot that passed while the automation waited MUST NOT run.

A pause (ADR 028 §1.3) takes precedence over waiting. An automation that is
_waiting for credits_ or _done_ MUST move to _waiting for key approval_ when
an approval stops matching.

### 1.2. An automation approval lives beside its binding

An automation approval MUST be a record in the API Keys tables, one for each
binding the automation uses. It MUST name the automation's card, the binding
and the key's owner, and MUST record the version it approved. It MUST NOT be
a field of the automation's row or of its card. Removing the automation or
deleting its card MUST delete its approvals.

An approval MUST follow its binding. Revoking or removing the binding MUST
end the approval. Suspending the binding MUST suspend the approval, and the
binding's resuming MUST resume it. When an `{{apiKey}}` binding comes to send
a different share or key, every approval of it MUST end, unless the
confirmation that changes the binding also approves those automations.

A binding with no matching automation approval MUST NOT serve a run of an
automation's triggers, even when the binding is approved for automations.

Ending or deleting an approval only takes a use away from a key. It MUST NOT
need a secure session when it follows from the automation's own changes or
from its binding (ADR 005 §1.1 governs giving an approval). A key owner's own
revocation of an approval MUST need one, as revoking a binding does.

### 1.3. One step when the payer owns every key

When the payer owns every key the missing approvals need, the switch-on flow
MUST open the secure window in approve mode for those approvals. A
`{{userKey}}` slot needs the payer's own key. An `{{apiKey}}` slot needs a
share in the realm. The payer owns that share when the payer owns the key it
holds. One confirmation in the secure window MUST write the bindings it needs
and the automation approvals. The app page MUST NOT write an approval itself
(ADR 005 §1.1). When the payer closes the window without confirming, the
automation MUST stay in _waiting for key approval_.

Every confirmation MUST name the version it showed, and MUST be refused when
the automation's version differs when the confirmation lands.

### 1.4. A notice for every key owner who must approve

Each key owner a missing approval needs MUST get a notice, the payer
included. The app's API Keys badge MUST count it, and it MUST link to the
secure window's approve page. The notice MUST name the realm, the automation,
and each operation with its destination. It MUST NOT name the payer to the
key's owner except as ADR 011 §1.2 allows. When an `{{apiKey}}` slot has no
share in the realm, the realm's direct writers MUST get a notice to share a
key. A notice MUST end when the approval it asks for matches or the
automation is removed. §1.3 is the switch-on shortcut for the payer's own
notice.

An approval that is missing, ended or suspended MUST NOT fail a run. The
server MUST move the automation to _waiting for key approval_ and send these
notices as soon as it learns of it.

### 1.5. An approval lasts for the life of the automation

A run of the automation's triggers MUST use a matching automation approval
with no further approval. An automation approval MUST end only when its
binding ends or changes (§1.2), or when the automation is removed. A version
change doesn't end an approval: the approval stops matching, and matches
again if the version returns to the approved one.

### 1.6. A change to the version asks again

When the index sees an edit to the automation's card or to its script file,
the server MUST compare the automation's version with each approval's. When
one stops matching, the server MUST move the automation to _waiting for key
approval_ at once, never at its next run, and MUST send the notices of §1.4.
When every approval matches again, §1.1 applies. A card that doesn't read as
a declaration has no version, and MUST leave the automation as it is. A
resume that changes the payer changes the version, so it asks again too.

A change to the vendor request an operation sends is a change to the binding,
not to the automation. It follows the API Keys rules, which move the binding
to `needs-reapproval`. The server learns of that only at a call, so that run
is refused, and §1.7 applies.

### 1.7. Admission checks every run

Admission MUST check each run of the automation's triggers against the
automation's approvals, and against the version computed from the card and
the script that the attempt reads. A run MUST be refused when an approval it
needs has ended or doesn't match that version. Such a refusal means that an
approval ended or the automation changed after it was approved, or that the
binding needs re-approval. It never means that the approval was not asked
for. Such a refusal MUST NOT count toward the run of failures that pauses an
automation. When the server learns of it, the server MUST move the automation
to _waiting for key approval_ and send the notices of §1.4.

Preview and Run now act as the direct writer who starts them (ADR 026 §1.1).
Each slot they fill MUST use a key that person owns, a binding approved for
interactive use, or a binding with an automation approval that matches the
card's current version with that person as payer.

## 2. Rationale

A binding approved for automations lets any run in the realm use the key, and
that includes an automation the key's owner never saw. Anyone who can edit
the card or the script file can change what that run does. So the approval
has to name the automation and the version the owner agreed to. Then an edit
that changes what the key is spent on goes back to the owner.

The version holds what the key's owner can judge when approving: how much of
the key is spent, through which requests, and for whom. The operations fix
each vendor request, and the script and the params decide how the run fills
it. The triggers and the `callApiCalls` cap decide how often. A label
is in it because renaming a trigger restarts its run count (ADR 028 §1.4).
The payer is in it because a run acts as, and is paid for by, the payer
(ADR 026 §1.1), and a key owner agrees to that person's use. A lower cap
spends less, so it doesn't ask again.

The version leaves out the realm data the script reads. A writer who edits a
card the script reads, such as a list of places to look up, changes the
inputs of a call. Those inputs stay inside requests the owner approved, at a
rate the triggers and the cap bound, so they don't ask again.

A version change only stops an approval matching. The card saves itself while
someone edits it, so an approval that ended on every save would cost each
key owner a fresh approval for a half-typed edit. A reverted edit matches
again, with no one asked.

The approval is asked for at switch-on because that is when the automation's
row and payer come to exist. Afterwards, a missing or ended approval would
surface only as a failed run, possibly hours later and possibly unseen. A
waiting state shows the problem in the console at once, and it costs nothing
while it lasts.

The record lives beside the binding because the key's owner, not the payer,
controls it. Revocation, share suspension, key deletion and grant removal
already reach bindings, so an approval beside its binding follows them with
no second path to keep in step. An automation can also need approvals from
several owners, each on a different version, which one row can't hold.

Removing an automation or editing its card ends or idles approvals under the
app's session. That is safe because it only takes a use away from a key, and
the worst card code can do with it is make an automation wait. Giving an
approval is what spends a key, so that stays in the secure window.

Preview and Run now happen while a person watches, but that person may not
own the key. Limiting them to keys the person owns, to interactive bindings,
which that person could already invoke in the browser, or to a matching
approval keeps the edit-then-run path from spending someone else's key.

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
- **End an approval on any version change.** Every intermediate save would
  ask every key owner again.
- **Let Preview and Run now use any binding approved for automations.** Any
  direct writer could edit the script and spend another owner's key at once.
- **Include the realm data the script reads in the version.** What a run
  reads is known only once it runs, so no approval could name it in advance,
  and every ordinary edit to the realm would ask every key owner again.

## 4. Remediation

Known gaps are listed in [remediation/039.md](remediation/039.md).
