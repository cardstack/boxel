import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import EmailField from '@cardstack/base/email';
import PhoneNumberField from '@cardstack/base/phone-number';
import AddressField from '@cardstack/base/address';
import BooleanField from '@cardstack/base/boolean';
import { realmURL } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { gt } from '@cardstack/boxel-ui/helpers';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';

import { Vendor } from './vendor';
import { statusField } from './status-field';
import { PaymentTermsField } from './payment-terms-field';
import { LifecycleDatesField } from './lifecycle-dates-field';
import OnboardVendorCommand from './commands/onboard-vendor-command';
import { VendorWorkspace } from './components/vendor-workspace';
import { StatePill } from './components/state-pill';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

// A calendar-day comparison: a certification that expires today is still
// valid today. Compares Y/M/D locally, never via toISOString (UTC skew).
function isPastDay(d?: Date | null): boolean {
  if (!d) {
    return false;
  }
  let now = new Date();
  let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day < today;
}

function maskTail(value?: string | null): string {
  let v = (value ?? '').replace(/\s/g, '');
  if (!v.length) {
    return '';
  }
  let tail = v.slice(-4);
  return `••••${tail}`;
}

// One compliance credential with a shelf life. Expiry is the load-bearing
// fact: an expired certification makes the whole profile award-ineligible
// (see VendorProfile.complianceOk and the RFQ comparison board).
export class CertificationField extends FieldDef {
  static displayName = 'Certification';

  @field name = contains(StringField);
  @field issuer = contains(StringField);
  @field issuedOn = contains(DateField);
  @field expiresOn = contains(DateField);

  @field isExpired = contains(BooleanField, {
    computeVia: function (this: CertificationField) {
      return isPastDay(this.expiresOn);
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get expiryLabel() {
      let d = this.args.model?.expiresOn;
      if (!d) {
        return 'no expiry';
      }
      return `${this.args.model?.isExpired ? 'expired' : 'expires'} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    <template>
      <div class='cert-row'>
        <span class='cert-name'>{{@model.name}}</span>
        <span class='cert-issuer'>{{@model.issuer}}</span>
        <StatePill
          @label={{this.expiryLabel}}
          @hue={{if @model.isExpired 'red' 'green'}}
          @dot={{true}}
        />
      </div>
      <style scoped>
        .cert-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-4xs) 0;
          font-size: 0.875rem;
        }
        .cert-name {
          font-weight: 600;
        }
        .cert-issuer {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

// Remittance details captured at intake. The account number is stored whole
// but every read format renders only the masked tail — payment execution is
// out of scope for this block (see readMe non-goals), the number exists so
// Finance can verify the vendor record against an invoice by its last 4.
export class BankDetailsField extends FieldDef {
  static displayName = 'Bank Details';

  @field bankName = contains(StringField);
  @field accountName = contains(StringField);
  @field accountNumber = contains(StringField);
  @field routingNumber = contains(StringField);

  @field maskedAccountNumber = contains(StringField, {
    computeVia: function (this: BankDetailsField) {
      return maskTail(this.accountNumber);
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='bank'>
        <span class='bank-name'>{{@model.bankName}}</span>
        <span class='account'>{{@model.accountName}}
          {{@model.maskedAccountNumber}}</span>
      </div>
      <style scoped>
        .bank {
          display: flex;
          gap: var(--boxel-sp-sm);
          align-items: baseline;
          font-size: 0.875rem;
        }
        .bank-name {
          font-weight: 600;
        }
        .account {
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='bank-atom'>{{@model.bankName}}
        {{@model.maskedAccountNumber}}</span>
      <style scoped>
        .bank-atom {
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}

export const VENDOR_PROFILE_STATUSES = [
  'intake',
  'under-review',
  'approved',
  'onboarded',
  'rejected',
];

export const VENDOR_PROFILE_STATUS_LABELS: Record<string, string> = {
  intake: 'Intake',
  'under-review': 'Under Review',
  approved: 'Approved',
  onboarded: 'Onboarded',
  rejected: 'Rejected',
};

export const VENDOR_PROFILE_STATUS_COLORS: Record<string, StateColor> = {
  intake: stateColor('slate'),
  'under-review': stateColor('amber'),
  approved: stateColor('blue'),
  onboarded: stateColor('green'),
  rejected: stateColor('red'),
};

const STATUS_HUES: Record<string, 'slate' | 'amber' | 'blue' | 'green' | 'red'> =
  {
    intake: 'slate',
    'under-review': 'amber',
    approved: 'blue',
    onboarded: 'green',
    rejected: 'red',
  };

// A statusField (not a plain enum) so the vetting pipeline has a real
// transition graph: the Vendor Onboarding board derives its columns from
// these options and refuses illegal drags. `approved → onboarded` is
// deliberately ABSENT — onboarding creates the active Vendor record, so it
// only happens through OnboardVendorCommand (whose direct patch is not
// graph-gated), never by dragging a card.
export const VendorProfileStatusField = statusField({
  options: [
    {
      value: 'intake',
      label: 'Intake',
      hue: 'slate',
      meaning: 'Paperwork received, nobody has looked yet',
    },
    {
      value: 'under-review',
      label: 'Under Review',
      hue: 'amber',
      meaning: 'Compliance documents being checked',
    },
    {
      value: 'approved',
      label: 'Approved',
      hue: 'blue',
      meaning: 'Cleared to onboard — run Onboard Vendor to activate',
    },
    {
      value: 'onboarded',
      label: 'Onboarded',
      hue: 'green',
      terminal: true,
      meaning: 'Active vendor record exists; invitable to RFQs',
    },
    {
      value: 'rejected',
      label: 'Rejected',
      hue: 'red',
      terminal: true,
      meaning: 'Vetting failed — reasons in notes',
    },
  ],
  transitions: {
    intake: ['under-review', 'rejected'],
    'under-review': ['approved', 'rejected', 'intake'],
    approved: ['under-review', 'rejected'],
    onboarded: [],
    rejected: ['intake'],
  },
  displayName: 'Vendor Profile Status',
});

// The buyer-recorded intake dossier for a would-be vendor: identity, tax and
// remittance details, and dated compliance credentials. Single-persona rule:
// there is no vendor-facing submission flow — the procurement manager
// transcribes the vendor's paperwork. OnboardVendorCommand converts an
// approved profile into an active Vendor; complianceOk is the award gate the
// RFQ comparison board reads.
export class VendorProfile extends CardDef {
  static displayName = 'Vendor Profile';
  static headerColor = '#3e4e88';

  @field companyName = contains(StringField);
  @field contactName = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field address = contains(AddressField);
  @field serviceCategory = contains(StringField, {
    description: 'e.g. IT Hardware, Facilities, Marketing, Logistics',
  });
  @field taxId = contains(StringField);
  @field bankDetails = contains(BankDetailsField);
  @field certifications = containsMany(CertificationField);
  @field insuranceExpiry = contains(DateField);
  @field status = contains(VendorProfileStatusField);
  @field notes = contains(TextAreaField);
  // ---- Added in the Desk-spec merge (additive only) -----------------------
  @field paymentTerms = contains(PaymentTermsField);
  @field lifecycle = contains(LifecycleDatesField);
  @field linkedVendor = linksTo(() => Vendor);

  @field maskedTaxId = contains(StringField, {
    computeVia: function (this: VendorProfile) {
      return maskTail(this.taxId);
    },
  });

  @field expiredCertificationCount = contains(StringField, {
    computeVia: function (this: VendorProfile) {
      let expired = (this.certifications ?? []).filter(
        (c) => c?.isExpired,
      ).length;
      return String(expired);
    },
  });

  // The award gate: insurance ON FILE and current, AND no expired
  // certifications. Absence is non-compliance — a profile with no insurance
  // recorded must not read as compliant (fake-vendor fraud starts with thin
  // files). The RFQ comparison board disables Award for any vendor whose
  // profile fails this.
  @field complianceOk = contains(BooleanField, {
    computeVia: function (this: VendorProfile) {
      let certsOk = (this.certifications ?? []).every((c) => !c?.isExpired);
      let insuranceOk =
        this.insuranceExpiry != null && !isPastDay(this.insuranceExpiry);
      return certsOk && insuranceOk;
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: VendorProfile) {
      return this.companyName?.trim()?.length
        ? this.companyName
        : 'Untitled Vendor Profile';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked busy = false;
    @tracked error: string | undefined;
    @tracked message: string | undefined;

    get canOnboard() {
      return (
        this.args.model?.status === 'approved' &&
        this.args.model?.complianceOk &&
        !this.args.model?.linkedVendor
      );
    }

    onboard = async () => {
      let model = this.args.model;
      if (!model) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.error = 'Commands are unavailable in this mode';
        return;
      }
      let realm = (model as any)?.[realmURL]?.href;
      if (!realm) {
        this.error = 'Could not determine the realm for the new vendor';
        return;
      }
      this.error = undefined;
      this.message = undefined;
      this.busy = true;
      try {
        let result = await new OnboardVendorCommand(commandContext).execute({
          profile: model,
          realm,
        } as any);
        this.message = (result as any)?.message;
      } catch (error: any) {
        this.error = error?.message ?? String(error);
      } finally {
        this.busy = false;
      }
    };

    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'intake'] ?? 'slate';
    }
    get statusLabel() {
      return (
        VENDOR_PROFILE_STATUS_LABELS[this.args.model?.status ?? ''] ??
        'Intake'
      );
    }
    get insuranceExpired() {
      return isPastDay(this.args.model?.insuranceExpiry);
    }
    get complianceLabel() {
      return this.args.model?.complianceOk
        ? 'Compliance current'
        : 'Compliance lapsed — award blocked';
    }
    get insuranceDateLabel() {
      let d = this.args.model?.insuranceExpiry;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })
        : '';
    }

    // The live-query workspace mounts only in interactive contexts —
    // prerender gets the static sections. Known Glimmer backtracking
    // assertion fires when getCards-backed components mount during
    // prerender (see app-factory notes); CRUD-function presence is the
    // documented gate.
    get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }
    <template>
      <article class='profile'>
        <header class='head'>
          <div>
            <p class='kicker'>Vendor Profile</p>
            <h1>{{@model.companyName}}</h1>
            <p class='sub'>{{@model.serviceCategory}}</p>
          </div>
          <div class='head-pills'>
            <StatePill
              @label={{this.statusLabel}}
              @hue={{this.statusHue}}
              @emphatic={{true}}
            />
            <StatePill
              @label={{this.complianceLabel}}
              @hue={{if @model.complianceOk 'green' 'red'}}
              @dot={{true}}
            />
            {{#if this.canOnboard}}
              <Button
                @kind='primary'
                @size='small'
                @disabled={{this.busy}}
                {{on 'click' this.onboard}}
              >Onboard as Vendor</Button>
            {{/if}}
          </div>
        </header>

        {{#if this.error}}<div class='flash error'>{{this.error}}</div>{{/if}}
        {{#if this.message}}<div class='flash ok'>{{this.message}}</div>{{/if}}

        <div class='grid'>
          <section class='panel'>
            <h2>Contact</h2>
            <dl>
              <div><dt>Contact</dt><dd>{{@model.contactName}}</dd></div>
              <div><dt>Email</dt><dd>{{#if @model.email}}<@fields.email
                    />{{/if}}</dd></div>
              <div><dt>Phone</dt><dd>{{#if @model.phone}}<@fields.phone
                    @format='atom'
                  />{{/if}}</dd></div>
              <div><dt>Address</dt><dd>{{@model.address.fullAddress}}</dd></div>
            </dl>
          </section>

          <section class='panel'>
            <h2>Tax &amp; Remittance</h2>
            <dl>
              <div><dt>Tax ID</dt><dd class='mono'>{{@model.maskedTaxId}}</dd></div>
              <div><dt>Bank</dt><dd><@fields.bankDetails /></dd></div>
              <div><dt>Terms</dt><dd>{{#if @model.paymentTerms.shorthand}}
                  <@fields.paymentTerms @format='embedded' />
                {{else}}not negotiated yet{{/if}}</dd></div>
              <div><dt>Lifecycle</dt><dd><@fields.lifecycle
                    @format='embedded'
                  /></dd></div>
            </dl>
          </section>

          <section class='panel span'>
            <h2>Compliance</h2>
            <dl>
              <div>
                <dt>Insurance</dt>
                <dd>
                  {{#if @model.insuranceExpiry}}
                    <StatePill
                      @label='{{if this.insuranceExpired "expired" "valid to"}} {{this.insuranceDateLabel}}'
                      @hue={{if this.insuranceExpired 'red' 'green'}}
                      @dot={{true}}
                    />
                  {{else}}
                    <StatePill @label='not on file' @hue='amber' @dot={{true}} />
                  {{/if}}
                </dd>
              </div>
            </dl>
            <div class='certs'>
              {{#each @fields.certifications as |Cert|}}
                <Cert />
              {{else}}
                <p class='empty'>No certifications recorded yet.</p>
              {{/each}}
            </div>
          </section>

          {{#if @model.notes}}
            <section class='panel span'>
              <h2>Notes</h2>
              <p class='notes'>{{@model.notes}}</p>
            </section>
          {{/if}}

          {{#if @model.linkedVendor}}
            <section class='panel span'>
              <h2>Active Vendor Record</h2>
              <@fields.linkedVendor @format='embedded' />
            </section>
            {{#if this.isInteractive}}
              <section class='panel span'>
                <h2>Vendor Workspace</h2>
                <VendorWorkspace
                  @vendor={{@model.linkedVendor}}
                  @context={{@context}}
                />
              </section>
            {{/if}}
          {{/if}}
        </div>
      </article>
      <style scoped>
        .profile {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-lg);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0 var(--boxel-sp-5xs);
          font-family: var(--font-heading, inherit);
          font-size: 1.75rem;
          line-height: 1.15;
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .head-pills {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-xxs);
        }
        .flash {
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          margin-bottom: var(--boxel-sp);
          font-size: 0.875rem;
        }
        .flash.error {
          background: color-mix(
            in oklch,
            var(--state-red-fg, #b91c1c) 10%,
            transparent
          );
          color: var(--state-red-fg, #b91c1c);
        }
        .flash.ok {
          background: color-mix(
            in oklch,
            var(--state-green-fg, #15803d) 10%,
            transparent
          );
          color: var(--state-green-fg, #15803d);
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        .panel.span {
          grid-column: 1 / -1;
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        dl {
          margin: 0;
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        dl > div {
          display: grid;
          grid-template-columns: 7rem 1fr;
          gap: var(--boxel-sp-xs);
          align-items: baseline;
        }
        dt {
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.8125rem;
        }
        dd {
          margin: 0;
          font-size: 0.875rem;
        }
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .certs {
          margin-top: var(--boxel-sp-xs);
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
          font-style: italic;
        }
        .notes {
          margin: 0;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
        @container (max-width: 560px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .head {
            flex-direction: column;
          }
          .head-pills {
            align-items: flex-start;
            flex-direction: row;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'intake'] ?? 'slate';
    }
    get statusLabel() {
      return (
        VENDOR_PROFILE_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Intake'
      );
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.companyName}}</span>
          <span class='cat'>{{@model.serviceCategory}}</span>
        </div>
        <StatePill
          @label={{if @model.complianceOk 'compliant' 'lapsed'}}
          @hue={{if @model.complianceOk 'green' 'red'}}
          @dot={{true}}
        />
        <StatePill @label={{this.statusLabel}} @hue={{this.statusHue}} />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cat {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>
        <span class='dot {{if @model.complianceOk "ok" "bad"}}'></span>
        {{@model.companyName}}
      </span>
      <style scoped>
        .atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          font-size: 0.8125rem;
        }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .dot.ok {
          background: var(--state-green-fg, #15803d);
        }
        .dot.bad {
          background: var(--state-red-fg, #b91c1c);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusLabel() {
      return (
        VENDOR_PROFILE_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Intake'
      );
    }
    get certCount() {
      return (this.args.model?.certifications ?? []).length;
    }
    get topCerts() {
      return (this.args.model?.certifications ?? [])
        .filter(Boolean)
        .slice(0, 2);
    }
    get insuranceLabel() {
      let d = this.args.model?.insuranceExpiry;
      if (!d) {
        return 'insurance not on file';
      }
      let label = d.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });
      return d < new Date() ? `insurance expired ${label}` : `insured to ${label}`;
    }
    <template>
      <div class='fit'>
        <div class='fit-head'>
          <span class='fit-name'>{{@model.companyName}}</span>
          <span
            class='fit-flag {{if @model.complianceOk "ok" "bad"}}'
          >{{if @model.complianceOk '✓' '⚠'}}</span>
        </div>
        <span class='fit-cat'>{{@model.serviceCategory}}</span>
        <div class='fit-mid'>
          <span
            class='fit-insurance {{unless @model.complianceOk "bad"}}'
          >{{this.insuranceLabel}}</span>
          {{#if (gt this.certCount 0)}}
            <div class='fit-cert-pills'>
              {{#each this.topCerts as |cert|}}
                <span
                  class='fit-cert-pill {{if cert.isExpired "expired"}}'
                >{{cert.name}}</span>
              {{/each}}
              {{#if (gt this.certCount 2)}}
                <span class='fit-cert-pill more'>+{{this.certCount}}</span>
              {{/if}}
            </div>
          {{/if}}
        </div>
        <div class='fit-more'>
          <span class='fit-status'>{{this.statusLabel}}</span>
          {{#if @model.contactName}}
            <span class='fit-contact'>{{@model.contactName}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .fit-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp-5xs);
        }
        .fit-name {
          font-weight: 600;
          font-size: 0.9375rem;
          line-height: 1.2;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .fit-flag.ok {
          color: var(--state-green-fg, #15803d);
        }
        .fit-flag.bad {
          color: var(--state-red-fg, #b91c1c);
        }
        .fit-cat {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-mid {
          display: none;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          font-size: 0.75rem;
        }
        .fit-insurance {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-insurance.bad {
          color: var(--state-red-fg, #b91c1c);
          font-weight: 600;
        }
        .fit-cert-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .fit-cert-pill {
          font-size: 0.6875rem;
          padding: 1px 8px;
          border-radius: 999px;
          background: color-mix(
            in oklch,
            var(--procurement-ink, var(--primary, var(--boxel-dark))) 9%,
            transparent
          );
          color: var(--procurement-ink, var(--primary, var(--boxel-dark)));
          white-space: nowrap;
        }
        .fit-cert-pill.expired {
          background: color-mix(
            in oklch,
            var(--state-red-fg, #b91c1c) 10%,
            transparent
          );
          color: var(--state-red-fg, #b91c1c);
          text-decoration: line-through;
        }
        .fit-cert-pill.more {
          background: transparent;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-more {
          display: none;
          margin-top: auto;
          gap: var(--boxel-sp-xs);
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-status {
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-size: 0.6875rem;
        }
        @container fitted-card (height > 120px) {
          .fit-more {
            display: flex;
          }
        }
        @container fitted-card (height > 160px) {
          .fit-mid {
            display: flex;
          }
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
          }
          .fit-cat,
          .fit-more {
            display: none;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };

  // A form someone fills in during a call with the vendor — grouped by how
  // the conversation actually goes (who are you → how do we reach you → are
  // you compliant → how do we pay you), not by schema declaration order.
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='profile-edit'>
        <section class='sect'>
          <h3>Identity</h3>
          <div class='row identity'>
            <FieldContainer @label='Company' @vertical={{true}}>
              <@fields.companyName />
            </FieldContainer>
            <FieldContainer @label='Category' @vertical={{true}}>
              <@fields.serviceCategory />
            </FieldContainer>
            <FieldContainer @label='Status' @vertical={{true}}>
              <@fields.status />
            </FieldContainer>
          </div>
        </section>

        <section class='sect'>
          <h3>Contact</h3>
          <div class='row'>
            <FieldContainer @label='Contact name' @vertical={{true}}>
              <@fields.contactName />
            </FieldContainer>
            <FieldContainer @label='Email' @vertical={{true}}>
              <@fields.email />
            </FieldContainer>
            <FieldContainer @label='Phone' @vertical={{true}}>
              <@fields.phone />
            </FieldContainer>
          </div>
          <FieldContainer @label='Address' @vertical={{true}}>
            <@fields.address />
          </FieldContainer>
        </section>

        <section class='sect compliance'>
          <h3>Compliance
            <span class='sect-hint'>expired credentials block RFQ awards</span></h3>
          <div class='row'>
            <FieldContainer @label='Insurance valid until' @vertical={{true}}>
              <@fields.insuranceExpiry />
            </FieldContainer>
          </div>
          <FieldContainer
            @label='Certifications (name, issuer, dates)'
            @vertical={{true}}
          >
            <@fields.certifications />
          </FieldContainer>
        </section>

        <section class='sect'>
          <h3>Tax &amp; Remittance
            <span class='sect-hint'>shown masked everywhere except here</span></h3>
          <div class='row'>
            <FieldContainer @label='Tax ID' @vertical={{true}}>
              <@fields.taxId />
            </FieldContainer>
          </div>
          <FieldContainer @label='Bank details' @vertical={{true}}>
            <@fields.bankDetails />
          </FieldContainer>
          <FieldContainer @label='Payment terms' @vertical={{true}}>
            <@fields.paymentTerms />
          </FieldContainer>
        </section>

        <section class='sect'>
          <h3>Notes</h3>
          <FieldContainer @label='Internal notes' @vertical={{true}}>
            <@fields.notes />
          </FieldContainer>
          <FieldContainer @label='Active vendor record' @vertical={{true}}>
            <@fields.linkedVendor />
          </FieldContainer>
        </section>
      </div>
      <style scoped>
        .profile-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
        }
        .sect.compliance {
          border-left: 3px solid var(--procurement-ink, var(--primary, var(--boxel-dark)));
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        .row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .identity {
          grid-template-columns: 2fr 1fr 1fr;
        }
        @container edit (width < 640px) {
          .row,
          .identity {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };
}
