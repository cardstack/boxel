import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Principal } from './principal';

export class ClinicalAccessPolicy extends CardDef {
  static displayName = 'Clinical access policy';
  static prefersWideFormat = true;

  @field policyId = contains(StringField);
  @field viewIdentityRule = contains(StringField);
  @field viewClinicalRule = contains(StringField);
  @field viewMedicationsRule = contains(StringField);
  @field viewNotesRule = contains(StringField);
  @field viewBillingRule = contains(StringField);
  @field viewAuditRule = contains(StringField);
  @field editCarePlanRule = contains(StringField);
  @field orderMedicationRule = contains(StringField);
  @field beginDischargeRule = contains(StringField);
  @field coordinateCareRule = contains(StringField);
  @field highAcuityReviewRule = contains(StringField);
  @field approveReleaseRule = contains(StringField);
  @field visitDuringHoursRule = contains(StringField);
  @field familyMedicationRule = contains(StringField);
  @field caretakerInstructionsRule = contains(StringField);
  @field emergencyReadRule = contains(StringField);
  @field suspendedRefusalRule = contains(StringField);

  @field administrators = linksToMany(Principal);
  @field privacyOfficers = linksToMany(Principal);
  @field emergencyClinicians = linksToMany(Principal);
  @field facilityStaff = linksToMany(Principal);
  @field directory = linksToMany(Principal);

  @field cardTitle = contains(StringField, {
    computeVia: function () {
      return 'Clinical access policy';
    },
  });

  static isolated = class extends Component<typeof ClinicalAccessPolicy> {
    get rules() {
      return [
        ['ViewIdentity', this.args.model.viewIdentityRule],
        ['ViewClinicalSummary', this.args.model.viewClinicalRule],
        ['ViewMedications', this.args.model.viewMedicationsRule],
        ['ViewInternalNotes', this.args.model.viewNotesRule],
        ['ViewBilling', this.args.model.viewBillingRule],
        ['ViewAuditTrail', this.args.model.viewAuditRule],
        ['EditCarePlan', this.args.model.editCarePlanRule],
        ['OrderMedication', this.args.model.orderMedicationRule],
        ['BeginDischarge', this.args.model.beginDischargeRule],
        ['CoordinateCareConference', this.args.model.coordinateCareRule],
        ['ReviewHighAcuity', this.args.model.highAcuityReviewRule],
        ['ApproveRecordRelease', this.args.model.approveReleaseRule],
        ['VisitDuringHours', this.args.model.visitDuringHoursRule],
        ['ViewFamilyMedicationSchedule', this.args.model.familyMedicationRule],
        ['ViewCaretakerInstructions', this.args.model.caretakerInstructionsRule],
        ['EmergencyRead', this.args.model.emergencyReadRule],
      ];
    }

    get administrators(): Principal[] {
      return loadedPrincipals(this.args.model.administrators);
    }

    get privacyOfficers(): Principal[] {
      return loadedPrincipals(this.args.model.privacyOfficers);
    }

    get emergencyClinicians(): Principal[] {
      return loadedPrincipals(this.args.model.emergencyClinicians);
    }

    get facilityStaff(): Principal[] {
      return loadedPrincipals(this.args.model.facilityStaff);
    }

    <template>
      <article class='policy'>
        <header>
          <p class='eyebrow'>BXL AUTHORIZATION / 1</p>
          <h1>Clinical access policy</h1>
          <p>Relationship-backed rules for patient-record capabilities. Open this card in Edit to change statements or membership.</p>
        </header>

        <div class='layout'>
          <section class='rules' aria-label='BXL capability rules'>
            {{#each this.rules as |rule|}}
              <div class='rule'>
                <strong>{{rule.[0]}}</strong>
                <code>{{rule.[1]}}</code>
              </div>
            {{/each}}
            <div class='rule refusal'>
              <strong>Explicit refusal</strong>
              <code>refuse when {{@model.suspendedRefusalRule}}</code>
            </div>
          </section>

          <aside>
            <h2>Policy membership</h2>
            <Membership @label='Administrators' @people={{this.administrators}} />
            <Membership @label='Privacy officers' @people={{this.privacyOfficers}} />
            <Membership @label='Emergency clinicians' @people={{this.emergencyClinicians}} />
            <Membership @label='Facility staff' @people={{this.facilityStaff}} />
            <p class='note'>Patient-specific attending, care-team, pharmacy, billing, and suspended seats live on each patient resource.</p>
          </aside>
        </div>
      </article>

      <style scoped>
        .policy, .policy * { box-sizing: border-box; }
        .policy { width: 100%; min-height: 100%; padding: 30px; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        header { max-width: 780px; padding-bottom: 22px; border-bottom: 1px solid var(--border); }
        .eyebrow { margin: 0 0 10px; color: var(--primary); font: 700 11px/1 var(--font-mono); letter-spacing: .13em; }
        h1 { margin: 0; font: 650 clamp(28px, 4vw, 44px)/1 var(--font-serif); letter-spacing: -.035em; }
        header > p:last-child { max-width: 680px; margin: 12px 0 0; color: var(--muted-foreground); line-height: 1.55; }
        .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 330px); gap: 28px; padding-top: 24px; }
        .rules { min-width: 0; border-top: 1px solid var(--border); }
        .rule { display: grid; grid-template-columns: minmax(150px, 210px) minmax(0, 1fr); gap: 18px; padding: 13px 0; border-bottom: 1px solid var(--border); }
        .rule strong { font-size: 13px; }
        code { overflow-wrap: anywhere; color: var(--clinical-code); font: 500 12px/1.55 var(--font-mono); }
        .refusal code { color: var(--destructive); }
        aside { padding: 18px; border: 1px solid var(--border); background: var(--card); }
        h2 { margin: 0 0 18px; font: 650 18px/1.2 var(--font-serif); }
        .note { margin: 18px 0 0; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }
        @media (max-width: 760px) { .policy { padding: 20px; } .layout { grid-template-columns: 1fr; } .rule { grid-template-columns: 1fr; gap: 5px; } }
      </style>
    </template>
  };
}

interface MembershipSignature {
  Args: {
    label: string;
    people: Principal[];
  };
}

class Membership extends Component<MembershipSignature> {
  <template>
    <section class='membership'>
      <h3>{{@label}}</h3>
      {{#each @people as |person|}}
        <span>{{person.displayName}}</span>
      {{else}}
        <span class='empty'>No members</span>
      {{/each}}
    </section>
    <style scoped>
      .membership { display: grid; gap: 5px; margin: 0 0 15px; }
      h3 { margin: 0 0 3px; color: var(--muted-foreground); font: 700 10px/1.2 var(--font-mono); letter-spacing: .09em; text-transform: uppercase; }
      span { color: var(--foreground); font-size: 13px; }
      .empty { color: var(--muted-foreground); font-style: italic; }
    </style>
  </template>
}

function loadedPrincipals(
  values: (Principal | null | undefined)[] | undefined,
): Principal[] {
  return (values ?? []).filter(
    (value): value is Principal => value != null,
  );
}

function ids(values: (Principal | null | undefined)[] | undefined): string[] {
  return loadedPrincipals(values).map((value) => value.partyId).filter(Boolean) as string[];
}

export function policyDocument(policy: ClinicalAccessPolicy) {
  return {
    schema: 'bxl-authorization/1' as const,
    id: policy.policyId ?? 'clinical-access',
    scopes: [
      {
        name: 'HospitalFacility',
        seats: [
          { name: 'Staff', from: 'Policy.FacilityStaff' },
          { name: 'Administrator', from: 'Policy.Administrators' },
        ],
        capabilities: [
          { name: 'ViewOperationalContext', where: 'Seat.Staff or Seat.Administrator' },
          { name: 'ViewDirectory', where: 'Party.Member' },
        ],
      },
      {
        name: 'PatientRecord',
        links: [{ name: 'Facility', to: 'HospitalFacility' }],
        seats: [
          { name: 'Patient', from: 'Resource.Patient' },
          { name: 'Attending', from: 'Resource.Attending' },
          { name: 'CareTeam', from: 'Resource.CareTeam' },
          { name: 'PharmacyTeam', from: 'Resource.PharmacyTeam' },
          { name: 'BillingTeam', from: 'Resource.BillingTeam' },
          { name: 'Family', from: 'Resource.Family' },
          { name: 'Administrator', from: 'Policy.Administrators' },
          { name: 'PrivacyOfficer', from: 'Policy.PrivacyOfficers' },
          { name: 'EmergencyClinician', from: 'Policy.EmergencyClinicians' },
          { name: 'Suspended', from: 'Resource.Suspended' },
        ],
        capabilities: [
          { name: 'EmergencyRead', where: policy.emergencyReadRule ?? 'Seat.EmergencyClinician and Input.BreakGlass == true and Input.IncidentTicket != null' },
          { name: 'ViewRecordLocator', where: 'Party.Member or Party.Guest' },
          { name: 'ViewIdentity', where: policy.viewIdentityRule ?? 'Seat.Patient or Seat.Family or Seat.Attending or Seat.CareTeam or Seat.PharmacyTeam or Seat.BillingTeam or Seat.PrivacyOfficer or Seat.Administrator or Capability.EmergencyRead' },
          { name: 'ViewClinicalSummary', where: policy.viewClinicalRule ?? 'Seat.Patient or Seat.Attending or Seat.CareTeam or Seat.PrivacyOfficer or Seat.Administrator or Capability.EmergencyRead' },
          { name: 'ViewVitals', where: 'Capability.ViewClinicalSummary' },
          { name: 'ViewMedications', where: policy.viewMedicationsRule ?? 'Seat.Patient or Seat.Attending or Seat.CareTeam or Seat.PharmacyTeam or Capability.EmergencyRead' },
          { name: 'VisitDuringHours', where: policy.visitDuringHoursRule ?? 'Seat.Family and Input.LocalHour >= Resource.VisitingStartHour and Input.LocalHour < Resource.VisitingEndHour' },
          { name: 'ViewFamilyMedicationSchedule', where: policy.familyMedicationRule ?? 'Seat.Family and Capability.VisitDuringHours' },
          { name: 'ViewCaretakerInstructions', where: policy.caretakerInstructionsRule ?? 'Seat.Patient or Seat.Attending or Seat.CareTeam or (Seat.Family and Capability.VisitDuringHours)' },
          { name: 'ViewInternalNotes', where: policy.viewNotesRule ?? 'Seat.Attending or Seat.CareTeam or Capability.EmergencyRead', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot view internal clinical notes.' }] },
          { name: 'ViewBilling', where: policy.viewBillingRule ?? 'Seat.Patient or Seat.BillingTeam or Seat.PrivacyOfficer or Seat.Administrator', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot view billing data.' }] },
          { name: 'ViewAuditTrail', where: policy.viewAuditRule ?? 'Seat.PrivacyOfficer or Seat.Administrator' },
          { name: 'ViewFacilityContext', where: 'via(Resource.Facility; Capability.ViewOperationalContext)' },
          { name: 'EditCarePlan', where: policy.editCarePlanRule ?? '(Seat.Attending or Seat.CareTeam) and Resource.Status == "admitted"', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot mutate patient records.' }] },
          { name: 'OrderMedication', where: policy.orderMedicationRule ?? '(Seat.Attending or Seat.PharmacyTeam) and Resource.Status == "admitted"', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot order medication.' }] },
          { name: 'BeginDischarge', where: policy.beginDischargeRule ?? 'Seat.Attending and Resource.Status == "admitted"', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot begin discharge.' }] },
          { name: 'CoordinateCareConference', where: policy.coordinateCareRule ?? '(Seat.Attending or Seat.CareTeam) and Capability.ViewClinicalSummary and Resource.Status == "admitted" and Resource.Severity != "Low"', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot coordinate a care conference.' }] },
          { name: 'ReviewHighAcuity', where: policy.highAcuityReviewRule ?? '(Seat.Attending or Seat.CareTeam or Seat.PrivacyOfficer or Seat.Administrator or Capability.EmergencyRead) and Resource.Severity == "Critical"', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot open a high-acuity review.' }] },
          { name: 'ApproveRecordRelease', where: policy.approveReleaseRule ?? '(Seat.PrivacyOfficer or Seat.Administrator) and Capability.ViewAuditTrail and Input.IncidentTicket != null', refuse: [{ when: policy.suspendedRefusalRule ?? 'Seat.Suspended', because: 'Suspended staff cannot approve a record release.' }] },
          { name: 'ExportRecord', where: 'Seat.PrivacyOfficer or Seat.Administrator' },
          { name: 'ActivateEmergencyAccess', where: 'Seat.EmergencyClinician' },
          { name: 'RequestAccess', where: 'Party.Guest' },
        ],
      },
    ],
  };
}

export function policyLinks(policy: ClinicalAccessPolicy) {
  return {
    administrators: ids(policy.administrators),
    privacyOfficers: ids(policy.privacyOfficers),
    emergencyClinicians: ids(policy.emergencyClinicians),
    facilityStaff: ids(policy.facilityStaff),
  };
}
