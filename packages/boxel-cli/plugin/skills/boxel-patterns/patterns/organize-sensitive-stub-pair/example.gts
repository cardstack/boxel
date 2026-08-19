// Distilled example for `organize-sensitive-stub-pair`.
//
// Two CardDefs:
//   1. FullRecord — sensitive sections (Identity + Medical illustrative only);
//      lives in a restricted realm; owns the link to the stub.
//   2. OperationalStub — safe public projection; lives in a permissioned realm
//      consumed by app surfaces.
//
// One Command:
//   SyncOperationalStubCommand — projects the safe subset, saves the stub.
//
// One Component getter:
//   syncIssues / needsSync — drift detector exposed in the isolated UI.
//
// The full real-world implementation has ~6 sections (Identity / Medical /
// Family / Custody / Financial / IEP), section navigation, and a sensitive
// banner. This example pulls out just the pair shape + the sync mechanics.
import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';

// ─── Safe operational stub ──────────────────────────────────────────
// Lives in a public-ish realm. App surfaces link to *this*, not to the
// FullRecord. Has the bare-minimum fields needed for grids / feeds /
// rosters to render + filter.
export class OperationalStub extends CardDef {
  static displayName = 'Operational Stub';

  @field recordId  = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName  = contains(StringField);
  @field active    = contains(BooleanField);

  // Public-safe boolean flags derived from sensitive sections.
  @field hasAllergy = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: OperationalStub) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ')
        || `Stub ${this.recordId ?? ''}`;
    },
  });
}

// ─── Sensitive sections ─────────────────────────────────────────────
class IdentitySection extends FieldDef {
  static displayName = 'Identity';
  @field recordId  = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName  = contains(StringField);
  @field ssn       = contains(StringField); // sensitive
  @field active    = contains(BooleanField);
}

class MedicalSection extends FieldDef {
  static displayName = 'Medical';
  @field allergies   = contains(StringField); // sensitive free text
  @field medications = contains(StringField); // sensitive free text
  @field hasAllergy  = contains(BooleanField); // safe boolean projection
}

// ─── Full sensitive record ──────────────────────────────────────────
// Lives in a restricted realm. Owns the link to the stub.
export class FullRecord extends CardDef {
  static displayName = 'Full Record';

  @field identity = contains(IdentitySection);
  @field medical  = contains(MedicalSection);

  // One-way link: full → stub.
  @field operationalStub = linksTo(() => OperationalStub);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FullRecord) {
      const f = this.identity?.firstName, l = this.identity?.lastName;
      return [f, l].filter(Boolean).join(' ') || `Record ${this.identity?.recordId ?? ''}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // Compare live stub against the canonical fields on the full record.
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

      return issues;
    }
    get needsSync(): boolean {
      return this.syncIssues.length > 0;
    }

    syncStub = async () => {
      const profile = this.args.model;
      if (!profile?.operationalStub) return;
      try {
        await new SyncOperationalStubCommand(this.args.context!.commandContext)
          .execute(profile);
      } catch (error) {
        console.error('Failed to sync stub:', error);
      }
    };

    <template>
      <article class='record'>
        <div class='sensitive-banner'>
          SENSITIVE RECORD — Authorized Personnel Only
        </div>

        <header class='record-header'>
          <h1>{{@model.cardTitle}}</h1>
          {{#if @model.operationalStub}}
            <div class='stub-preview'>
              <span class='label'>Public Record</span>
              <@fields.operationalStub @format='fitted' />
            </div>
          {{/if}}
        </header>

        {{#if this.needsSync}}
          <aside class='sync-alert' aria-live='polite'>
            <p>Stub has drifted ({{this.syncIssues.length}} field(s)):</p>
            <ul>
              {{#each this.syncIssues as |issue|}}<li>{{issue}}</li>{{/each}}
            </ul>
            <Button {{on 'click' this.syncStub}}>Sync stub</Button>
          </aside>
        {{/if}}

        <section class='record-sections'>
          <@fields.identity @format='embedded' />
          <@fields.medical  @format='embedded' />
        </section>
      </article>

      <style scoped>
        .record { padding: 1.5rem; }
        .sensitive-banner {
          background: color-mix(in srgb, var(--boxel-error-100) 12%, white);
          color: var(--boxel-error-100);
          padding: 0.5rem 1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          border-radius: var(--boxel-border-radius);
          margin-bottom: 1.5rem;
        }
        .record-header { display: flex; justify-content: space-between; align-items: start; gap: 2rem; }
        .stub-preview .label { display: block; font-size: 0.75rem; color: var(--boxel-600); margin-bottom: 0.25rem; }
        .sync-alert {
          padding: 0.75rem 1rem;
          background: var(--boxel-100);
          border-left: 3px solid var(--primary, var(--boxel-purple-300));
          border-radius: var(--boxel-border-radius);
          margin: 1rem 0;
        }
        .sync-alert ul { margin: 0.25rem 0 0.75rem 1.25rem; padding: 0; }
        .record-sections { display: flex; flex-direction: column; gap: 1rem; }
      </style>
    </template>
  };
}

// ─── The projection Command ─────────────────────────────────────────
// Same file convention: the Command that mutates a card lives with it.
export class SyncOperationalStubCommand extends Command<typeof FullRecord, undefined> {
  static actionVerb = 'Sync Operational Stub';
  async getInputType() { return FullRecord; }

  protected async run(profile: FullRecord): Promise<undefined> {
    const stub = profile.operationalStub;
    if (!stub) throw new Error('No operational stub linked to this record');

    // Project the safe subset onto the stub.
    stub.recordId   = profile.identity?.recordId;
    stub.firstName  = profile.identity?.firstName;
    stub.lastName   = profile.identity?.lastName;
    stub.active     = profile.identity?.active;
    stub.hasAllergy = profile.medical?.hasAllergy;

    // Save the updated stub back to its own realm. Compute the stub's realm
    // URL from the stub's id (last two path segments are <TypeName>/<id>).
    const stubURL = new URL(stub.id!);
    const realmURL = new URL(
      stubURL.origin
      + stubURL.pathname.split('/').slice(0, -2).join('/')
      + '/',
    );
    await new SaveCardCommand(this.commandContext).execute({
      card: stub,
      realm: realmURL,
    });
    return undefined;
  }
}
