---
validated: source-proven
---

# organize-sensitive-stub-pair — Two-card pattern: sensitive full record + safe operational stub, kept in sync

**What this gives you:** A privacy-aware split where one card holds the **full sensitive record** (PII, medical, legal, financial, custody, etc.) and a second card holds a **safe operational stub** with just the public-facing identity + boolean flags. The full record lives in a restricted realm; the stub is what other app surfaces link to. A `syncStub` Command pushes selected fields from full → stub on demand; a `syncIssues` getter on the full record flags drift in the UI.

**When to use:**
- **School / HR records.** Full student or employee profile holds medical / accommodation / family / custody data; the stub holds name + grade-level / role + boolean flags (`hasAllergy`, `hasIEP`, `hasCustodyAlert`).
- **Healthcare or HIPAA-adjacent.** Sensitive chart vs. operational identity card.
- **Compliance-bounded apps.** GDPR / SOC2 / FERPA scenarios where the audit boundary matters more than the join cost.
- **Any "private vs. public projection" split.** The full record stays in a permissioned realm; the stub is the safe-to-link version that grids, feeds, and assignment cards reference.

**The insight:** Boxel relationships cross realms by design — a card in a public realm can `linksTo` a card in a private realm if the permissions allow. **But you usually don't want to do that.** The link surface and the prerendered preview expose more than you want; queries against the public realm leak through to the private one. The right shape is to model **two cards** and let the link target be the *safe* one. The full record holds the link to the stub (one-way), the stub stays in a less-permissioned realm, and a sync action projects selected fields across when the source changes.

Two pieces make this work:

1. **A `syncIssues` getter on the full record's Component** that diffs the live stub against the full record's fields. The UI surfaces "needs sync" affordances when the getter returns non-empty.
2. **A `Sync<Record>StubCommand`** that performs the projection in one transaction. The Command takes the full record as input, copies the safe-subset fields onto the stub, and `SaveCardCommand`s the stub.

## Recipe shape

```ts
// full-record.gts
import { CardDef, Component, field, contains, linksTo } from 'https://cardstack.com/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';

import { IdentitySection, MedicalSection, /* … */ } from './sections';
import { OperationalStub } from './operational-stub';

export class FullRecord extends CardDef {
  static displayName = 'Full Record';

  @field identity = contains(IdentitySection);
  @field medical  = contains(MedicalSection);
  // … more sensitive sections …

  // One-way link to the safe stub — the *full* record points at the stub.
  @field operationalStub = linksTo(() => OperationalStub);

  static isolated = class Isolated extends Component<typeof this> {
    // syncIssues compares the live stub to the canonical fields on the
    // full record, returning an array of human-readable mismatch strings.
    get syncIssues(): string[] {
      const issues: string[] = [];
      const stub = this.args.model?.operationalStub;
      const identity = this.args.model?.identity;
      const medical = this.args.model?.medical;
      if (!stub || !identity) return issues;

      if (stub.recordId   !== identity.recordId)   issues.push('Record ID mismatch');
      if (stub.firstName  !== identity.firstName)  issues.push('First name mismatch');
      if (stub.lastName   !== identity.lastName)   issues.push('Last name mismatch');
      if (stub.active     !== identity.active)     issues.push('Active status mismatch');
      if (stub.hasAllergy !== medical?.hasAllergy) issues.push('Allergy flag mismatch');
      // … one issue per safe-subset field …
      return issues;
    }
    get needsSync(): boolean {
      return this.syncIssues.length > 0;
    }

    syncStub = async () => {
      const profile = this.args.model;
      if (!profile?.operationalStub) return;
      try {
        await new SyncOperationalStubCommand(this.args.context.commandContext)
          .execute(profile);
      } catch (error) {
        console.error('Failed to sync stub:', error);
      }
    };

    <template>
      {{!-- Sensitive banner up top, then sections, then a sync button when needsSync --}}
      {{#if this.needsSync}}
        <button type='button' {{on 'click' this.syncStub}}>
          Sync stub ({{this.syncIssues.length}} field(s) drifted)
        </button>
      {{/if}}
      {{!-- … rest of the isolated layout, with sensitive banner + sections … --}}
    </template>
  };
}

// The Command that performs the projection.
export class SyncOperationalStubCommand extends Command<typeof FullRecord, undefined> {
  static actionVerb = 'Sync Operational Stub';
  async getInputType() { return FullRecord; }

  protected async run(profile: FullRecord): Promise<undefined> {
    const stub = profile.operationalStub;
    if (!stub) throw new Error('No operational stub linked to this record');

    // Project the safe subset.
    stub.recordId   = profile.identity?.recordId;
    stub.firstName  = profile.identity?.firstName;
    stub.lastName   = profile.identity?.lastName;
    stub.active     = profile.identity?.active;
    stub.hasAllergy = profile.medical?.hasAllergy;
    // … all safe-subset fields …

    // Save the updated stub back to its own realm.
    const stubRealm = new URL(
      new URL(stub.id).origin
      + new URL(stub.id).pathname.split('/').slice(0, -2).join('/')
      + '/',
    );
    await new SaveCardCommand(this.commandContext).execute({
      card: stub,
      realm: stubRealm,
    });
    return undefined;
  }
}
```

## Why the projection direction matters

The stub points NOWHERE; the full record points AT the stub.

- **App surfaces** (feeds, grids, assignment lists, conversation threads) link to the **stub** — they live in the same realm as the stub and never traverse the link into the private realm.
- The full record's realm is locked down. Only the few users with full access ever load it. Loading it walks the link to the stub (read-only direction) so the UI can show "Public Record" preview, but no public surface ever walks the link *the other way*.

Inverting this direction defeats the privacy boundary. Don't put a `linksTo(FullRecord)` on the stub — that lets any consumer of the stub potentially load the private side.

## Sync timing — push, don't pull

The sync runs on **explicit user action** (a button on the full record's isolated view, OR a Command invoked when a write hook is appropriate). Don't run sync automatically on every save; the cost compounds and the audit trail muddies. Two acceptable triggers:

1. **The "drifted" banner** — `needsSync` lights up; the user reads the diff via `syncIssues` and clicks Sync.
2. **A workflow gate** — after a controlled edit (e.g. a custody-alert flip), the workflow Command sync the stub as its last step.

For per-instance autosync, wrap the projection in a `Command` and call it from the workflow that produced the change. Don't put it in a computed field — computeds aren't write-able and the cost-on-render is wrong for cross-realm writes.

## Sensitive banner

The full record's `isolated` template should open with a visible banner — "SENSITIVE RECORD — Authorized Personnel Only" or equivalent. This is a UI affordance, not a security mechanism (the realm permissions are the security mechanism), but it sets operator expectations and reduces accidental screen-shares.

## Gotchas

- **The stub realm needs the stub's CardDef shape too.** Both realms must import the `OperationalStub` CardDef (the stub realm to *define* it; the full-record realm to *type* the `linksTo`). Use a relative import if both realms share a source tree, or an absolute URL into the stub's realm if not.
- **`SaveCardCommand` for cross-realm writes.** Use the host command; don't try to `serialize-card` + raw `fetch`. The host has its own queue + indexer notifications that bare HTTP misses.
- **`new URL(stub.id)` parsing depends on the stub being saved.** Don't call `syncStub` before the stub has an id. If you're creating the stub-and-full-record pair in one flow, save the stub first.
- **The `syncIssues` getter is a comparison, not a merge.** A field that's `undefined` on both sides (because the section hasn't been filled in yet) shouldn't flag as drifted. Use `??` or explicit nullish checks if your stub initializes fields to defaults.
- **Field-shape drift over time.** When you add a new safe-subset field, you have to update both: (1) the `syncIssues` getter (add the new comparison) and (2) the Command's `run()` body (add the new assignment). Easy to miss one. Consider a constant `SAFE_SUBSET_FIELDS = […]` and derive both from it.
- **No magic auto-sync on writes to the full record.** The model is explicit: the sync action is its own audit-loggable event. If you need real-time sync, that's a different pattern (eventual-consistency feed-into-stub via a Command-spawning workflow).

## Source

- A `<full-record>.gts` card in the workspace (~1100 lines including section layout + nav + sync flow). The pattern was originally extracted from a school-LMS sensitive-record + public-stub split.
- `SyncOperationalStubCommand` lives in the same file as the full record (single-file convention: the Command that mutates a card lives with that card).
- Composes with: [`linksTo`](https://cardstack.com/base/card-api), `SaveCardCommand`, `Command<TInput, undefined>`.

## See also

- [`layout-sectioned-record-with-nav`](../layout-sectioned-record-with-nav/README.md) — paired pattern; long sensitive records often want the sectioned-nav isolated view. Most full-record cards use both patterns together.
- [`command-typed-with-progress`](../command-typed-with-progress/README.md) — wrap the sync in a typed progress flow if the projection is large or cross-realm.
- [`command-optimistic-pipeline`](../command-optimistic-pipeline/README.md) — for multi-step sync that needs an auditable history (each sync produces a run card).
- [`automate-linked-to-me-lookup`](../automate-linked-to-me-lookup/README.md) — if you need the stub to know which full records reference it (for permissioned tooling).
- `boxel/references/card-references.md` — the `links.self` rules for the relationship in JSON.
