import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import UserRoundIcon from '@cardstack/boxel-icons/user-round';
import { getMenuItems } from '@cardstack/runtime-common';
import { TrackedObject } from 'tracked-built-ins';
import {
  CardDef,
  Component,
  FieldDef,
  type GetMenuItemParams,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

import { expression, prepareBxlAuthorizationSafe } from './bxl/index';
import {
  ClinicalAccessPolicy,
  policyDocument,
  policyLinks,
} from './clinical-access-policy';
import { HospitalFacility } from './facility';
import { Principal } from './principal';
import { ClinicalResource } from './clinical-resource';

const prepareAuthorization = prepareBxlAuthorizationSafe as (
  document: unknown,
  snapshot: unknown,
) => any;

export class PatientVitals extends FieldDef {
  static displayName = 'Patient vitals';
  @field bpSystolic = contains(NumberField);
  @field bpDiastolic = contains(NumberField);
  @field heartRate = contains(NumberField);
  @field tempC = contains(NumberField);
  @field oxygenSaturation = contains(NumberField);
  @field weightKg = contains(NumberField);
}

export class BillingSummary extends FieldDef {
  static displayName = 'Billing summary';
  @field roomCharge = contains(NumberField);
  @field procedures = contains(NumberField);
  @field pharmacy = contains(NumberField);
}

export class Medication extends FieldDef {
  static displayName = 'Medication';
  @field name = contains(StringField);
  @field doseMg = contains(NumberField);
  @field frequency = contains(StringField);
  @field startDate = contains(StringField);
  @field lastDoseAt = contains(StringField);
  @field nextDoseAt = contains(StringField);
  @field lastDoseStatus = contains(StringField);
}

export class CaretakerInstruction extends FieldDef {
  static displayName = 'Caretaker instruction';
  @field activity = contains(StringField);
  @field status = contains(StringField);
  @field instruction = contains(StringField);
  @field schedule = contains(StringField);
}

export class ClinicalNote extends FieldDef {
  static displayName = 'Clinical note';
  @field authoredAt = contains(StringField);
  @field author = contains(StringField);
  @field category = contains(StringField);
  @field text = contains(StringField);
}

export class AuditEvent extends FieldDef {
  static displayName = 'Audit event';
  @field occurredAt = contains(StringField);
  @field actor = contains(StringField);
  @field action = contains(StringField);
}

export class CareContactAuthorization extends FieldDef {
  static displayName = 'Care contact authorization';
  @field relationship = contains(StringField);
  @field authorization = contains(StringField);
  @field personLabel = contains(StringField);
  @field person = linksTo(Principal);
}

function partyId(principal: Principal | null | undefined): string | undefined {
  return principal?.partyId ?? undefined;
}

function isPrincipal(
  principal: Principal | null | undefined,
): principal is Principal {
  return principal != null;
}

function partyIds(
  principals: (Principal | null | undefined)[] | undefined,
): string[] {
  return (principals ?? [])
    .map((principal) => principal?.partyId)
    .filter(Boolean) as string[];
}

interface ExpectedOutcome {
  headline: string;
  why: string;
  visible: string[];
  actions: string[];
  proof: string;
  tone: 'broad' | 'focused' | 'restricted' | 'blocked' | 'emergency';
}

const IMPERSONATION_TARGETS = [
  { partyId: 'patient:margaret-okonkwo', label: 'Margaret Okonkwo — patient' },
  { partyId: 'family:devon-okonkwo', label: 'Devon Okonkwo — family' },
  { partyId: 'person:aisha-tahir', label: 'Dr. Aisha Tahir — attending' },
  { partyId: 'person:jordan-blake', label: 'Jordan Blake — nested care team' },
  { partyId: 'person:casey-ward', label: 'Casey Ward — suspended nurse' },
  { partyId: 'person:elena-ruiz', label: 'Elena Ruiz — pharmacy' },
  { partyId: 'person:owen-grant', label: 'Owen Grant — billing' },
  { partyId: 'person:nia-okafor', label: 'Nia Okafor — privacy officer' },
  { partyId: 'person:rina-patel', label: 'Rina Patel — administrator' },
  {
    partyId: 'person:theo-martin',
    label: 'Dr. Theo Martin — emergency clinician',
  },
  { partyId: 'person:cameron-price', label: 'Cameron Price — unrelated staff' },
  { partyId: 'guest:morgan-lee', label: 'Morgan Lee — guest' },
  { partyId: 'patient:warner-cohen', label: 'Warner Cohen — other patient' },
  { partyId: 'family:sara-cohen', label: 'Sara Cohen — other family' },
  {
    partyId: 'patient:priya-ramaswamy',
    label: 'Priya Ramaswamy — other patient',
  },
  {
    partyId: 'family:arjun-ramaswamy',
    label: 'Arjun Ramaswamy — other family',
  },
] as const;

function expectedOutcomeFor(
  viewerId: string,
  resourceId: string,
  status: string | undefined,
  severity: string | undefined,
  breakGlass: boolean,
  hasIncidentTicket: boolean,
  localHour: number,
  visitingStartHour: number | undefined,
  visitingEndHour: number | undefined,
): ExpectedOutcome {
  let admitted = status === 'admitted';
  let critical = severity === 'Critical';
  let withinVisitingHours =
    localHour >= (visitingStartHour ?? 9) &&
    localHour < (visitingEndHour ?? 20);
  let facilityOnly: ExpectedOutcome = {
    headline: 'Operational context only',
    why: 'This person is hospital staff, but has no patient-specific seat on this record.',
    visible: ['Record locator', 'Care location'],
    actions: [],
    proof:
      'Party.Member + via(Resource.Facility; Capability.ViewOperationalContext)',
    tone: 'restricted',
  };
  let clinicalSections = [
    'Identity',
    'Care location',
    'Clinical summary',
    'Vitals',
    'Medications',
    'Internal notes',
  ];
  let caregiverSections = [...clinicalSections, 'Meals & daily care'];
  let attendingActions = admitted
    ? [
        'Edit care plan',
        'Order medication',
        'Begin discharge',
        ...(severity !== 'Low' ? ['Start care conference'] : []),
        ...(critical ? ['Open high-acuity review'] : []),
      ]
    : [];

  if (viewerId === 'person:aisha-tahir') {
    if (
      resourceId === 'patient-record:pt-1001' ||
      resourceId === 'patient-record:pt-1003'
    ) {
      return {
        headline: admitted
          ? 'Full attending view with clinical CTAs'
          : 'Full attending view, but no mutation CTAs',
        why: admitted
          ? 'The attending seat grants the clinical bundle, and this record is still admitted.'
          : 'The attending seat still grants read access, but resource-state predicates remove actions after discharge.',
        visible: caregiverSections,
        actions: attendingActions,
        proof: 'Seat.Attending + Capability composition + Resource.Status',
        tone: 'broad',
      };
    }
    return facilityOnly;
  }

  if (
    viewerId === 'person:jordan-blake' &&
    resourceId === 'patient-record:pt-1001'
  ) {
    return {
      headline: 'Nested care-team access',
      why: 'Jordan is inside the cardiac night team, which is inside this patient’s cardiac care team.',
      visible: caregiverSections,
      actions: admitted ? ['Edit care plan', 'Start care conference'] : [],
      proof: 'Seat.CareTeam → team:cardiac-care → team:cardiac-night → Jordan',
      tone: 'broad',
    };
  }

  if (
    viewerId === 'person:casey-ward' &&
    resourceId === 'patient-record:pt-1001'
  ) {
    return {
      headline: 'Clinical read access with explicit refusals',
      why: 'Casey inherits the same nested care-team grant as Jordan, but the suspended seat removes notes and every mutation.',
      visible: [
        'Identity',
        'Care location',
        'Clinical summary',
        'Vitals',
        'Medications',
        'Meals & daily care',
      ],
      actions: [],
      proof: 'Seat.CareTeam grants; refuse when Seat.Suspended wins',
      tone: 'blocked',
    };
  }

  if (
    viewerId === 'person:amara-shah' &&
    resourceId === 'patient-record:pt-1002'
  ) {
    return {
      headline: 'ICU care-team access with high-acuity workflow',
      why: 'Amara belongs to this patient’s ICU care-team userset, and the critical severity unlocks an additional review CTA.',
      visible: caregiverSections,
      actions: admitted
        ? ['Edit care plan', 'Start care conference', 'Open high-acuity review']
        : [],
      proof:
        'Seat.CareTeam + Resource.Status == "admitted" + Resource.Severity == "Critical"',
      tone: 'broad',
    };
  }

  if (viewerId === 'person:elena-ruiz') {
    return {
      headline: admitted
        ? 'Medication-focused view with ordering CTA'
        : 'Medication-focused read-only view',
      why: 'The pharmacy-team userset grants identity and medication access, but not diagnosis, vitals, notes, billing, or audit.',
      visible: ['Identity', 'Care location', 'Medications'],
      actions: admitted ? ['Order medication'] : [],
      proof: 'Seat.PharmacyTeam + Resource.Status',
      tone: 'focused',
    };
  }

  if (viewerId === 'person:owen-grant') {
    return {
      headline: 'Billing-focused view',
      why: 'The billing-team userset grants identity and charges while clinical details remain redacted.',
      visible: ['Identity', 'Care location', 'Billing summary'],
      actions: [],
      proof: 'Seat.BillingTeam; no clinical seat',
      tone: 'focused',
    };
  }

  if (viewerId === 'person:nia-okafor' || viewerId === 'person:rina-patel') {
    let role =
      viewerId === 'person:nia-okafor' ? 'privacy officer' : 'administrator';
    return {
      headline: 'Broad oversight view without internal clinical notes',
      why: `The ${role} seat grants clinical summary, billing, audit, and export. Internal notes and medications remain outside this oversight role.`,
      visible: [
        'Identity',
        'Care location',
        'Clinical summary',
        'Vitals',
        'Billing summary',
        'Audit trail',
      ],
      actions: [
        'Export record',
        ...(hasIncidentTicket ? ['Approve record release'] : []),
        ...(critical ? ['Open high-acuity review'] : []),
      ],
      proof:
        'Oversight seat + Capability.ViewAuditTrail + incident-ticket and severity context',
      tone: 'broad',
    };
  }

  if (viewerId === 'person:theo-martin') {
    if (resourceId === 'patient-record:pt-1002') {
      return {
        headline: 'Attending access plus emergency controls',
        why: 'Theo is this record’s attending and is also an emergency clinician. Normal attending access works without break-glass.',
        visible: caregiverSections,
        actions: [...attendingActions, 'Enable emergency access'],
        proof:
          'Seat.Attending; Seat.EmergencyClinician independently exposes break-glass controls',
        tone: 'broad',
      };
    }
    if (breakGlass && hasIncidentTicket) {
      return {
        headline: 'Emergency read access is active',
        why: 'Break-glass and a non-empty incident ticket satisfy the emergency input condition for this otherwise unrelated record.',
        visible: clinicalSections,
        actions: ['Enable emergency access'],
        proof:
          'Seat.EmergencyClinician + Input.BreakGlass + Input.IncidentTicket',
        tone: 'emergency',
      };
    }
    return {
      ...facilityOnly,
      headline: 'Operational context with break-glass available',
      why: 'Theo has no patient seat here. Emergency access remains off until both break-glass and an incident ticket are present.',
      actions: ['Enable emergency access'],
      proof: 'EmergencyRead is false until both request inputs are satisfied',
      tone: 'emergency',
    };
  }

  if (viewerId === 'person:cameron-price') {
    return facilityOnly;
  }

  let ownPatientRecord =
    (viewerId === 'patient:margaret-okonkwo' &&
      resourceId === 'patient-record:pt-1001') ||
    (viewerId === 'patient:warner-cohen' &&
      resourceId === 'patient-record:pt-1002') ||
    (viewerId === 'patient:priya-ramaswamy' &&
      resourceId === 'patient-record:pt-1003');
  if (viewerId.startsWith('patient:')) {
    return ownPatientRecord
      ? {
          headline: 'Patient portal view without staff-only notes',
          why: 'The patient seat applies only to the matching record and grants the care summary, vitals, medication schedule, daily-care instructions, and billing.',
          visible: [
            'Identity',
            'Clinical summary',
            'Vitals',
            'Medications',
            'Meals & daily care',
            'Billing summary',
          ],
          actions: [],
          proof: 'Resource.Patient == current party',
          tone: 'focused',
        }
      : {
          headline: 'No cross-patient access',
          why: 'A patient relationship never crosses to another patient record.',
          visible: [],
          actions: [],
          proof: 'Resource.Patient does not match current party',
          tone: 'blocked',
        };
  }

  let ownFamilyRecord =
    (viewerId === 'family:devon-okonkwo' &&
      resourceId === 'patient-record:pt-1001') ||
    (viewerId === 'family:sara-cohen' &&
      resourceId === 'patient-record:pt-1002') ||
    (viewerId === 'family:arjun-ramaswamy' &&
      resourceId === 'patient-record:pt-1003');
  if (viewerId.startsWith('family:')) {
    if (!ownFamilyRecord) {
      return {
        headline: 'No cross-patient family access',
        why: 'Family membership is attached to one patient resource and does not carry to another record.',
        visible: [],
        actions: [],
        proof: 'Resource.Family does not match current party',
        tone: 'blocked',
      };
    }
    return withinVisitingHours
      ? {
          headline: 'Family visit window is open',
          why: 'This family member belongs to the patient-specific family userset. During visiting hours they can see medication timing, dose status, meals, feeding, bathroom, and mobility instructions.',
          visible: [
            'Identity',
            'Medication schedule & dose status',
            'Meals & daily care',
          ],
          actions: ['Check in for visit'],
          proof:
            'Seat.Family + Input.LocalHour inside Resource visiting window',
          tone: 'focused',
        }
      : {
          headline: 'Family identity view; visit details are time-locked',
          why: 'The family relationship is valid, but medication administration and caretaker instructions are hidden outside visiting hours.',
          visible: ['Identity'],
          actions: [],
          proof: 'Seat.Family is true; Capability.VisitDuringHours is false',
          tone: 'restricted',
        };
  }

  if (viewerId === 'guest:morgan-lee') {
    return {
      headline: 'Restricted locator with a request-access CTA',
      why: 'Guests can confirm that a record exists, but cannot see identity or clinical data.',
      visible: ['Record locator'],
      actions: ['Request access'],
      proof: 'Party.Guest grants locator and Capability.RequestAccess',
      tone: 'restricted',
    };
  }

  return facilityOnly;
}

export class PatientDashboard extends CardDef {
  static displayName = 'Patient dashboard';
  static prefersWideFormat = true;

  @tracked viewerPartyId = 'person:aisha-tahir';

  setDemoViewer(partyId: string) {
    if (!IMPERSONATION_TARGETS.some((target) => target.partyId === partyId)) {
      throw new Error(`Unknown clinical demo viewer: ${partyId}`);
    }
    this.viewerPartyId = partyId;
  }

  @field resourceId = contains(StringField);
  @field patientId = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field dob = contains(StringField);
  @field gender = contains(StringField);
  @field bloodType = contains(StringField);
  @field admissionDate = contains(StringField);
  @field dischargeDate = contains(StringField);
  @field status = contains(StringField);
  @field ward = contains(StringField);
  @field room = contains(StringField);
  @field diagnosis = contains(StringField);
  @field severity = contains(StringField);
  @field allergies = contains(StringField);
  @field careSummary = contains(StringField);
  @field dischargeSummaryDraft = contains(StringField);
  @field visitingStartHour = contains(NumberField);
  @field visitingEndHour = contains(NumberField);
  @field vitals = contains(PatientVitals);
  @field billing = contains(BillingSummary);
  @field medications = containsMany(Medication);
  @field caretakerInstructions = containsMany(CaretakerInstruction);
  @field internalNotes = containsMany(ClinicalNote);
  @field auditTrail = containsMany(AuditEvent);
  @field careContacts = containsMany(CareContactAuthorization);

  @field policy = linksTo(ClinicalAccessPolicy);
  @field facility = linksTo(HospitalFacility);
  @field patient = linksTo(Principal);
  @field attending = linksTo(Principal);
  @field careTeam = linksTo(Principal);
  @field pharmacyTeam = linksTo(Principal);
  @field billingTeam = linksTo(Principal);
  @field family = linksTo(Principal);
  @field suspended = linksToMany(Principal);
  @field consultingClinicians = linksToMany(Principal);
  @field carePlanResources = linksToMany(ClinicalResource);
  @field sharedProtocolResources = linksToMany(ClinicalResource);

  @field displayNameWithId = contains(StringField, {
    computeVia: expression('PatientId & " — " & FirstName & " " & LastName'),
  });
  @field totalCharges = contains(NumberField, {
    computeVia: expression(
      'Billing.RoomCharge + Billing.Procedures + Billing.Pharmacy',
    ),
  });
  @field bloodPressureLabel = contains(StringField, {
    computeVia: expression('Vitals.BpSystolic & "/" & Vitals.BpDiastolic'),
  });
  @field highAcuity = contains(BooleanField, {
    computeVia: expression('Severity == "High" or Severity == "Critical"'),
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PatientDashboard) {
      return this.displayNameWithId ?? this.patientId ?? 'Patient dashboard';
    },
  });

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    let hostItems = super[getMenuItems](params);
    if (params.menuContext !== 'interact') {
      return hostItems;
    }

    let impersonationItems: MenuItemOptions[] = IMPERSONATION_TARGETS.map(
      (target) => ({
        label: `View as ${target.label}`,
        icon: UserRoundIcon,
        disabled: this.viewerPartyId === target.partyId,
        action: async () => {
          this.setDemoViewer(target.partyId);
        },
      }),
    );

    return [...impersonationItems, ...hostItems];
  }

  static isolated = class extends Component<typeof PatientDashboard> {
    state = new TrackedObject<{
      breakGlass: boolean;
      incidentTicket: string;
      localHour: number;
    }>({
      breakGlass: false,
      incidentTicket: 'INC-2048',
      localHour: 14,
    });

    get directory(): Principal[] {
      return (this.args.model.policy?.directory ?? []).filter(isPrincipal);
    }

    get people(): Principal[] {
      return this.directory.filter(
        (principal) => principal.principalType !== 'team',
      );
    }

    get viewerId(): string {
      return this.args.model.viewerPartyId ?? this.people[0]?.partyId ?? '';
    }

    get viewer(): Principal | undefined {
      return this.people.find(
        (principal) => principal.partyId === this.viewerId,
      );
    }

    get expectation(): ExpectedOutcome {
      return expectedOutcomeFor(
        this.viewerId,
        this.args.model.resourceId ?? '',
        this.args.model.status,
        this.args.model.severity,
        this.breakGlass,
        Boolean(this.state.incidentTicket.trim()),
        this.state.localHour,
        this.args.model.visitingStartHour,
        this.args.model.visitingEndHour,
      );
    }

    changeViewer = (event: Event) => {
      this.args.model.setDemoViewer((event.target as HTMLSelectElement).value);
    };

    changeIncidentTicket = (event: Event) => {
      this.state.incidentTicket = (event.target as HTMLInputElement).value;
    };

    changeLocalHour = (event: Event) => {
      this.state.localHour = Number((event.target as HTMLInputElement).value);
    };

    toggleBreakGlass = (event: Event) => {
      this.state.breakGlass = (event.target as HTMLInputElement).checked;
    };

    get authorization() {
      let model = this.args.model;
      let policy = model.policy;
      let facility = model.facility;
      if (!policy || !facility) {
        return {
          ok: false as const,
          error: 'The dashboard is missing its policy or facility.',
        };
      }

      let parties = this.directory.map((principal) => ({
        party: principal.partyId,
        data: {
          displayName: principal.displayName,
          jobTitle: principal.jobTitle,
          principalType: principal.principalType,
        },
        ...(principal.members?.length
          ? { members: partyIds(principal.members) }
          : {}),
      }));

      let snapshot = {
        policy: {
          id: policy.policyId,
          links: policyLinks(policy),
        },
        resources: [
          {
            resource: facility.facilityId,
            type: 'HospitalFacility',
            data: { name: facility.name, campus: facility.campus },
          },
          {
            resource: model.resourceId,
            type: 'PatientRecord',
            data: {
              status: model.status,
              severity: model.severity,
              ward: model.ward,
              visitingStartHour: model.visitingStartHour,
              visitingEndHour: model.visitingEndHour,
            },
            links: {
              facility: facility.facilityId,
              patient: partyId(model.patient),
              attending: partyId(model.attending),
              careTeam: partyId(model.careTeam),
              pharmacyTeam: partyId(model.pharmacyTeam),
              billingTeam: partyId(model.billingTeam),
              family: partyId(model.family),
              suspended: partyIds(model.suspended),
            },
          },
        ],
        parties,
        members: parties
          .filter((party) => party.data.principalType === 'person')
          .map((party) => party.party),
        guests: parties
          .filter((party) => party.data.principalType === 'guest')
          .map((party) => party.party),
      };

      let result = prepareAuthorization(policyDocument(policy), snapshot);
      if (!result.ok) {
        return { ok: false as const, error: result.error.message };
      }
      return { ok: true as const, value: result.value };
    }

    get requestInput() {
      return {
        breakGlass: this.breakGlass,
        incidentTicket: this.state.incidentTicket.trim() || null,
        localHour: this.state.localHour,
      };
    }

    get access() {
      let authorization = this.authorization;
      if (!authorization.ok) {
        return {
          capabilities: [] as string[],
          allowed: new Set<string>(),
          metrics: { steps: 0, tupleReads: 0, maxDepth: 0 },
          error: authorization.error,
          refusal: undefined as string | undefined,
        };
      }
      let result = authorization.value.listCapabilities({
        party: this.viewerId,
        resource: this.args.model.resourceId,
        input: this.requestInput,
      });
      if (!result.ok) {
        return {
          capabilities: [] as string[],
          allowed: new Set<string>(),
          metrics: { steps: 0, tupleReads: 0, maxDepth: 0 },
          error: result.error.message,
          refusal: undefined as string | undefined,
        };
      }
      let notes = authorization.value.checkCapability({
        party: this.viewerId,
        capability: 'ViewInternalNotes',
        resource: this.args.model.resourceId,
        input: this.requestInput,
        trace: true,
      });
      return {
        capabilities: [...result.value.capabilities],
        allowed: new Set(result.value.capabilities),
        metrics: notes.ok ? notes.value.metrics : result.value.metrics,
        error: undefined as string | undefined,
        refusal: notes.ok
          ? notes.value.because.find(
              (reason: { kind: string; message: string }) =>
                reason.kind === 'refusal',
            )?.message
          : undefined,
      };
    }

    can(capability: string): boolean {
      return this.access.allowed.has(capability);
    }

    get projection() {
      let model = this.args.model;
      let can = (capability: string) => this.can(capability);
      return {
        locator: can('ViewRecordLocator')
          ? { patientId: model.patientId, ward: model.ward }
          : undefined,
        identity: can('ViewIdentity')
          ? {
              name: `${model.firstName} ${model.lastName}`,
              patientId: model.patientId,
              dob: model.dob,
              gender: model.gender,
              bloodType: model.bloodType,
              status: model.status,
              admissionDate: model.admissionDate,
              dischargeDate: model.dischargeDate,
              ward: model.ward,
              room: model.room,
              severity: model.severity,
            }
          : undefined,
        facility: can('ViewFacilityContext')
          ? {
              name: model.facility?.name,
              campus: model.facility?.campus,
              ward: model.ward,
              room: model.room,
            }
          : undefined,
        clinical: can('ViewClinicalSummary')
          ? {
              diagnosis: model.diagnosis,
              allergies: model.allergies,
              careSummary: model.careSummary,
              dischargeSummaryDraft: model.dischargeSummaryDraft,
              attending: model.attending?.displayName,
            }
          : undefined,
        vitals: can('ViewVitals') ? model.vitals : undefined,
        medications:
          can('ViewMedications') || can('ViewFamilyMedicationSchedule')
            ? (model.medications ?? [])
            : undefined,
        caretakerInstructions: can('ViewCaretakerInstructions')
          ? (model.caretakerInstructions ?? [])
          : undefined,
        notes: can('ViewInternalNotes')
          ? (model.internalNotes ?? [])
          : undefined,
        careContacts: can('ViewClinicalSummary')
          ? (model.careContacts ?? [])
          : undefined,
        consultingClinicians: can('ViewClinicalSummary')
          ? (model.consultingClinicians ?? [])
          : undefined,
        carePlanResources: can('ViewClinicalSummary')
          ? (model.carePlanResources ?? [])
          : undefined,
        sharedProtocolResources: can('ViewClinicalSummary')
          ? (model.sharedProtocolResources ?? [])
          : undefined,
        billing: can('ViewBilling')
          ? {
              roomCharge: this.money(model.billing?.roomCharge),
              procedures: this.money(model.billing?.procedures),
              pharmacy: this.money(model.billing?.pharmacy),
              total: this.money(model.totalCharges),
            }
          : undefined,
        audit: can('ViewAuditTrail') ? (model.auditTrail ?? []) : undefined,
        actions: {
          editCarePlan: can('EditCarePlan'),
          orderMedication: can('OrderMedication'),
          beginDischarge: can('BeginDischarge'),
          coordinateCare: can('CoordinateCareConference'),
          highAcuityReview: can('ReviewHighAcuity'),
          approveRelease: can('ApproveRecordRelease'),
          exportRecord: can('ExportRecord'),
          visitPatient: can('VisitDuringHours'),
          emergencyAccess: can('ActivateEmergencyAccess'),
          requestAccess: can('RequestAccess'),
        },
      };
    }

    get hasClinicalActions(): boolean {
      let actions = this.projection.actions;
      return (
        actions.editCarePlan ||
        actions.orderMedication ||
        actions.beginDischarge ||
        actions.coordinateCare ||
        actions.highAcuityReview ||
        actions.approveRelease ||
        actions.exportRecord ||
        actions.visitPatient
      );
    }

    get breakGlass(): boolean {
      return this.state.breakGlass;
    }

    get incidentTicket(): string {
      return this.state.incidentTicket;
    }

    get localHour(): number {
      return this.state.localHour;
    }

    get medicationStatusSummary(): string {
      return [
        ...new Set(
          (this.args.model.medications ?? []).map(
            (medication) => medication.lastDoseStatus ?? 'Unknown',
          ),
        ),
      ].join(' · ');
    }

    get linkedResourceCount(): number {
      return (
        (this.args.model.carePlanResources?.length ?? 0) +
        (this.args.model.sharedProtocolResources?.length ?? 0)
      );
    }

    get currentCharges(): string {
      return this.money(this.args.model.totalCharges);
    }

    money(value: unknown): string {
      let amount = typeof value === 'number' ? value : Number(value ?? 0);
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(Number.isFinite(amount) ? amount : 0);
    }

    <template>
      <article class='dashboard'>
        <header class='topbar'>
          <div class='brand'>
            <span class='brand-mark'>N</span>
            <span><strong>NORTHSTAR MEDICAL</strong><small>Patient operations</small></span>
          </div>
          <div class='demo-controls'>
            <label class='viewer-control'>
              <span>View as a person</span>
              <select
                value={{this.viewerId}}
                {{on 'change' this.changeViewer}}
                data-test-viewer
              >
                {{#each this.people as |person|}}
                  <option value={{person.partyId}}>{{person.displayName}}
                    —
                    {{person.jobTitle}}</option>
                {{/each}}
              </select>
            </label>
            <label class='policy-clock'>
              <span>Hospital hour</span>
              <input
                type='number'
                min='0'
                max='23'
                value={{this.localHour}}
                {{on 'input' this.changeLocalHour}}
                data-test-policy-hour
              />
            </label>
          </div>
        </header>

        {{#if this.access.error}}
          <section class='error-state' data-test-policy-error>
            <p class='eyebrow'>POLICY COULD NOT BE PREPARED</p>
            <h1>Authorization configuration needs attention</h1>
            <code>{{this.access.error}}</code>
          </section>
        {{else}}
          <div class='status-strip'>
            {{#if this.viewer}}
              <span class='viewer-avatar'>{{this.viewer.displayName}}</span>
              <span>{{this.viewer.jobTitle}}</span>
              <span class='decision-count'>{{this.access.capabilities.length}}
                capabilities on this record</span>
            {{else}}
              <span class='viewer-avatar'>Loading access directory…</span>
            {{/if}}
          </div>

          <section
            class='expectation'
            data-tone={{this.expectation.tone}}
            data-test-expected-outcome
          >
            <div class='expectation-copy'>
              <p class='eyebrow'>DEFAULT POLICY · WHAT SHOULD HAPPEN AND WHY</p>
              <h2>{{this.expectation.headline}}</h2>
              <p>{{this.expectation.why}}</p>
              <code>{{this.expectation.proof}}</code>
            </div>
            <div class='expectation-list'>
              <div>
                <strong>Should see</strong>
                {{#each this.expectation.visible as |item|}}<span
                  >{{item}}</span>{{else}}<span>Nothing on this record</span>{{/each}}
              </div>
              <div>
                <strong>Should be able to do</strong>
                {{#each this.expectation.actions as |item|}}<span
                  >{{item}}</span>{{else}}<span>No CTA</span>{{/each}}
              </div>
            </div>
          </section>

          <section
            class='mutation-pulse'
            aria-label='Live mutation signals'
            data-clinical-section='signals'
          >
            <div><small>Location</small><strong>{{@model.ward}}
                ·
                {{@model.room}}</strong></div>
            <div><small>Acuity</small><strong>{{@model.severity}}</strong></div>
            <div><small>Blood pressure</small><strong
              >{{@model.bloodPressureLabel}}</strong></div>
            <div><small>Heart rate</small><strong>{{@model.vitals.heartRate}}
                bpm</strong></div>
            <div><small>Medication state</small><strong
              >{{this.medicationStatusSummary}}</strong></div>
            <div><small>Care steps</small><strong
              >{{@model.caretakerInstructions.length}}</strong></div>
            <div><small>Clinical notes</small><strong
              >{{@model.internalNotes.length}}</strong></div>
            <div><small>Care contacts</small><strong
              >{{@model.careContacts.length}}</strong></div>
            <div><small>Consultants</small><strong
              >{{@model.consultingClinicians.length}}</strong></div>
            <div><small>Linked modules</small><strong
              >{{this.linkedResourceCount}}</strong></div>
            <div><small>Current charges</small><strong
              >{{this.currentCharges}}</strong></div>
            <div><small>Discharge draft</small><strong>{{if
                  @model.dischargeSummaryDraft
                  'Ready'
                  'None'
                }}</strong></div>
          </section>

          {{#if this.projection.identity}}
            <main class='patient-shell' data-test-patient-dashboard>
              <section class='patient-header'>
                <div>
                  <p class='eyebrow'>PATIENT
                    {{this.projection.identity.patientId}}</p>
                  <h1>{{this.projection.identity.name}}</h1>
                  <div class='patient-meta'>
                    <span>{{this.projection.identity.dob}}</span>
                    <span>{{this.projection.identity.gender}}</span>
                    <span>{{this.projection.identity.bloodType}}</span>
                    <span>{{this.projection.identity.ward}}
                      ·
                      {{this.projection.identity.room}}</span>
                  </div>
                </div>
                <div class='acuity {{if @model.highAcuity "urgent"}}'>
                  <small>{{this.projection.identity.status}}</small>
                  <strong>{{this.projection.identity.severity}}</strong>
                </div>
              </section>

              <div class='content-grid'>
                <div class='clinical-column'>
                  {{#if this.projection.clinical}}
                    <section
                      class='section clinical-summary'
                      data-test-section='clinical-summary'
                      data-clinical-section='clinical-summary'
                    >
                      <div class='section-title'><span>01</span><h2>Clinical
                          summary</h2></div>
                      <div class='summary-grid'>
                        <div><small>Primary diagnosis</small><strong
                          >{{this.projection.clinical.diagnosis}}</strong></div>
                        <div><small>Allergies</small><strong
                            class='warning'
                          >{{this.projection.clinical.allergies}}</strong></div>
                        <div><small>Attending</small><strong
                          >{{this.projection.clinical.attending}}</strong></div>
                        <p>{{this.projection.clinical.careSummary}}</p>
                        {{#if this.projection.clinical.dischargeSummaryDraft}}
                          <p class='discharge-draft'><strong>Discharge draft:</strong>
                            {{this.projection.clinical.dischargeSummaryDraft}}</p>
                        {{/if}}
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.vitals}}
                    <section class='section' data-test-section='vitals'>
                      <div class='section-title'><span>02</span><h2>Latest
                          vitals</h2><small>Today · 08:40</small></div>
                      <div class='vitals-grid'>
                        <Metric
                          @label='Blood pressure'
                          @value={{@model.bloodPressureLabel}}
                          @unit='mmHg'
                        />
                        <Metric
                          @label='Heart rate'
                          @value={{this.projection.vitals.heartRate}}
                          @unit='bpm'
                        />
                        <Metric
                          @label='Temperature'
                          @value={{this.projection.vitals.tempC}}
                          @unit='°C'
                        />
                        <Metric
                          @label='Oxygen'
                          @value={{this.projection.vitals.oxygenSaturation}}
                          @unit='%'
                        />
                        <Metric
                          @label='Weight'
                          @value={{this.projection.vitals.weightKg}}
                          @unit='kg'
                        />
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.medications}}
                    <section
                      class='section'
                      data-test-section='medications'
                      data-clinical-section='medications'
                    >
                      <div class='section-title'><span>03</span><h2>Active
                          medications</h2></div>
                      <div class='table'>
                        <div class='table-row table-head'><span
                          >Medication</span><span>Dose</span><span
                          >Schedule</span><span>Last dose</span><span
                          >Status</span><span>Next dose</span></div>
                        {{#each this.projection.medications as |medication|}}
                          <div class='table-row'><strong
                            >{{medication.name}}</strong><span
                            >{{medication.doseMg}} mg</span><span
                            >{{medication.frequency}}</span><span
                            >{{medication.lastDoseAt}}</span><span
                              class='dose-status'
                            >{{medication.lastDoseStatus}}</span><span
                            >{{medication.nextDoseAt}}</span></div>
                        {{/each}}
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.caretakerInstructions}}
                    <section
                      class='section'
                      data-test-section='caretaker-instructions'
                      data-clinical-section='daily-care'
                    >
                      <div class='section-title'><span>04</span><h2>Meals &
                          daily care</h2><small>Caregiver instructions</small></div>
                      <div class='care-grid'>
                        {{#each
                          this.projection.caretakerInstructions
                          as |instruction|
                        }}
                          <article class='care-item'>
                            <div class='care-icon' aria-hidden='true'>
                              {{#if (eq instruction.activity 'Meals')}}
                                <svg viewBox='0 0 24 24'><path
                                    d='M7 3v8M4 3v5c0 2 6 2 6 0V3M7 11v10M15 3v18M15 3c4 2 4 8 0 10'
                                  /></svg>
                              {{else if (eq instruction.activity 'Feeding')}}
                                <svg viewBox='0 0 24 24'><path
                                    d='M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z'
                                  /><path d='M9 13h6M12 10v6' /></svg>
                              {{else if (eq instruction.activity 'Bathroom')}}
                                <svg viewBox='0 0 24 24'><circle
                                    cx='8'
                                    cy='5'
                                    r='2'
                                  /><path
                                    d='M8 8v6M5 11h6M6 21l2-7 2 7M15 4h5v16h-5M17 12h1'
                                  /></svg>
                              {{else}}
                                <svg viewBox='0 0 24 24'><path
                                    d='M5 17c3-1 4-4 5-7M10 10l3 3 2-6M13 13l4 7M10 15l-4 6'
                                  /><circle cx='12' cy='4' r='2' /></svg>
                              {{/if}}
                            </div>
                            <div><small>{{instruction.activity}}</small><strong
                              >{{instruction.status}}</strong></div>
                            <p>{{instruction.instruction}}</p>
                            <span>{{instruction.schedule}}</span>
                          </article>
                        {{/each}}
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.notes}}
                    <section
                      class='section internal'
                      data-test-section='internal-notes'
                    >
                      <div class='section-title'><span>05</span><h2>Internal
                          clinical notes</h2><em>STAFF ONLY</em></div>
                      <div class='notes-grid'>
                        {{#each this.projection.notes as |note|}}
                          <article class='clinical-note'>
                            <header>
                              <strong>{{note.author}}</strong>
                              <span>{{note.category}}</span>
                            </header>
                            <p>{{note.text}}</p>
                            <time>{{note.authoredAt}}</time>
                          </article>
                        {{/each}}
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.billing}}
                    <section
                      class='section'
                      data-test-section='billing'
                      data-clinical-section='billing'
                    >
                      <div class='section-title'><span>06</span><h2>Billing
                          summary</h2></div>
                      <div class='billing-grid'>
                        <span>Room
                          <strong
                          >{{this.projection.billing.roomCharge}}</strong></span>
                        <span>Procedures
                          <strong
                          >{{this.projection.billing.procedures}}</strong></span>
                        <span>Pharmacy
                          <strong
                          >{{this.projection.billing.pharmacy}}</strong></span>
                        <span class='total'>Current total
                          <strong
                          >{{this.projection.billing.total}}</strong></span>
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.audit}}
                    <section class='section' data-test-section='audit'>
                      <div class='section-title'><span>07</span><h2>Audit trail</h2></div>
                      {{#each this.projection.audit as |event|}}
                        <div class='audit-row'><time
                          >{{event.occurredAt}}</time><strong
                          >{{event.actor}}</strong><span
                          >{{event.action}}</span></div>
                      {{/each}}
                    </section>
                  {{/if}}

                  {{#if this.projection.careContacts}}
                    <section
                      class='section'
                      data-clinical-section='care-contacts'
                    >
                      <div class='section-title'><span>08</span><h2>Authorized
                          care contacts</h2></div>
                      <div class='contact-grid'>
                        {{#each this.projection.careContacts as |contact|}}
                          <article class='care-contact'>
                            <div class='contact-monogram' aria-hidden='true'>
                              <svg viewBox='0 0 24 24'>
                                <circle cx='12' cy='8' r='3.5' />
                                <path d='M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6' />
                              </svg>
                            </div>
                            <div class='contact-copy'>
                              <strong>{{contact.personLabel}}</strong>
                              <p>{{contact.authorization}}</p>
                            </div>
                            <span>{{contact.relationship}}</span>
                          </article>
                        {{/each}}
                      </div>
                    </section>
                  {{/if}}
                </div>

                <aside class='action-rail'>
                  {{#if this.projection.facility}}
                    <section
                      class='rail-section'
                      data-test-section='facility-context'
                    >
                      <p class='rail-label'>CARE LOCATION</p>
                      <strong>{{this.projection.facility.name}}</strong>
                      <span>{{this.projection.facility.campus}}</span>
                      <span>{{this.projection.facility.ward}}
                        · Room
                        {{this.projection.facility.room}}</span>
                    </section>
                  {{/if}}

                  <section class='rail-section actions'>
                    <p class='rail-label'>AVAILABLE ACTIONS</p>
                    {{#if this.projection.actions.editCarePlan}}<button
                        type='button'
                        class='primary'
                        data-test-action='edit-care-plan'
                      >Edit care plan</button>{{/if}}
                    {{#if this.projection.actions.orderMedication}}<button
                        type='button'
                        data-test-action='order-medication'
                      >Order medication</button>{{/if}}
                    {{#if this.projection.actions.beginDischarge}}<button
                        type='button'
                        data-test-action='begin-discharge'
                      >Begin discharge</button>{{/if}}
                    {{#if this.projection.actions.coordinateCare}}<button
                        type='button'
                        data-test-action='coordinate-care'
                      >Start care conference</button>{{/if}}
                    {{#if this.projection.actions.highAcuityReview}}<button
                        type='button'
                        data-test-action='high-acuity-review'
                      >Open high-acuity review</button>{{/if}}
                    {{#if this.projection.actions.approveRelease}}<button
                        type='button'
                        data-test-action='approve-release'
                      >Approve record release</button>{{/if}}
                    {{#if this.projection.actions.exportRecord}}<button
                        type='button'
                        data-test-action='export-record'
                      >Export record</button>{{/if}}
                    {{#if this.projection.actions.visitPatient}}<button
                        type='button'
                        class='primary'
                        data-test-action='visit-patient'
                      >Check in for visit</button>{{/if}}
                    {{#unless this.hasClinicalActions}}
                      <p class='quiet'>No clinical mutations available for this
                        viewer.</p>
                    {{/unless}}
                  </section>

                  {{#if this.projection.consultingClinicians}}
                    <section
                      class='rail-section'
                      data-clinical-section='consultants'
                    >
                      <p class='rail-label'>CONSULTING CLINICIANS</p>
                      <strong>{{this.projection.consultingClinicians.length}}
                        linked consultants · ordered</strong>
                      <div class='linked-clinicians'>
                        {{#each
                          this.projection.consultingClinicians
                          as |clinician|
                        }}
                          <article class='linked-clinician'>
                            <span
                              class='clinician-monogram'
                            >{{clinician.displayName.[0]}}</span>
                            <span class='clinician-copy'>
                              <strong>{{clinician.displayName}}</strong>
                              <span>{{clinician.jobTitle}}</span>
                            </span>
                          </article>
                        {{/each}}
                      </div>
                    </section>
                  {{/if}}

                  {{#if this.projection.carePlanResources}}
                    <section class='rail-section'>
                      <p class='rail-label'>CARE PLAN RESOURCES</p>
                      <strong>{{this.projection.carePlanResources.length}}
                        linked module</strong>
                      <span>Breaking-news distress response</span>
                    </section>
                  {{/if}}

                  {{#if this.projection.sharedProtocolResources}}
                    <section class='rail-section'>
                      <p class='rail-label'>SHARED PROTOCOL LIBRARY</p>
                      <strong>{{this.projection.sharedProtocolResources.length}}
                        reusable module</strong>
                    </section>
                  {{/if}}

                  {{#if this.projection.actions.emergencyAccess}}
                    <section
                      class='rail-section break-glass'
                      data-test-emergency-control
                    >
                      <p class='rail-label'>EMERGENCY ACCESS</p>
                      <label><input
                          type='checkbox'
                          checked={{this.breakGlass}}
                          {{on 'change' this.toggleBreakGlass}}
                        />
                        Enable break-glass</label>
                      <input
                        type='text'
                        value={{this.incidentTicket}}
                        aria-label='Incident ticket'
                        {{on 'input' this.changeIncidentTicket}}
                      />
                      <small>Requires an incident ticket. The clinical system
                        must audit use.</small>
                    </section>
                  {{/if}}

                  <section class='rail-section capabilities'>
                    <p class='rail-label'>CURRENT ACCESS</p>
                    <div class='chips'>{{#each
                        this.access.capabilities
                        as |capability|
                      }}<span>{{capability}}</span>{{/each}}</div>
                    <small>{{this.access.metrics.steps}}
                      graph steps · depth
                      {{this.access.metrics.maxDepth}}</small>
                    {{#if this.access.refusal}}<p
                        class='refusal'
                      >{{this.access.refusal}}</p>{{/if}}
                  </section>
                </aside>
              </div>
            </main>
          {{else}}
            <main class='restricted' data-test-restricted-record>
              <div class='restricted-copy'>
                <p class='eyebrow'>RESTRICTED PATIENT RECORD</p>
                <h1>Patient details are not available to this viewer.</h1>
                {{#if this.projection.locator}}<p>Record
                    {{this.projection.locator.patientId}}
                    is active in
                    {{this.projection.locator.ward}}.</p>{{/if}}
                {{#if this.projection.actions.requestAccess}}<button
                    type='button'
                    class='primary'
                    data-test-action='request-access'
                  >Request access</button>{{/if}}
              </div>
              {{#if this.projection.facility}}
                <aside class='restricted-location'>
                  <span>Operational context</span>
                  <strong>{{this.projection.facility.name}}</strong>
                  <p>{{this.projection.facility.ward}}
                    · Room
                    {{this.projection.facility.room}}</p>
                </aside>
              {{/if}}
              {{#if this.projection.actions.emergencyAccess}}
                <aside class='restricted-emergency'>
                  <strong>Emergency clinician</strong>
                  <label><input
                      type='checkbox'
                      checked={{this.breakGlass}}
                      {{on 'change' this.toggleBreakGlass}}
                    />
                    Enable break-glass</label>
                  <input
                    type='text'
                    value={{this.incidentTicket}}
                    aria-label='Incident ticket'
                    {{on 'input' this.changeIncidentTicket}}
                  />
                </aside>
              {{/if}}
            </main>
          {{/if}}
        {{/if}}
      </article>

      <style scoped>
        .dashboard,
        .dashboard * {
          box-sizing: border-box;
        }
        .dashboard {
          container: patient-dashboard / inline-size;
          width: 100%;
          min-height: 100%;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
        }
        .topbar {
          position: sticky;
          top: 0;
          z-index: 20;
          min-height: 76px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          padding: 14px 28px;
          border-bottom: 2px solid var(--border);
          background: var(--clinical-navy);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-mark {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          background: var(--primary);
          color: var(--primary-foreground);
          font: 800 18px/1 var(--font-serif);
        }
        .brand > span:last-child {
          display: grid;
          gap: 3px;
        }
        .brand strong {
          font: 700 12px/1 var(--font-mono);
          letter-spacing: 0.09em;
        }
        .brand small {
          color: var(--muted-foreground);
          font-size: 12px;
        }
        .demo-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
        }
        .viewer-control {
          display: grid;
          grid-template-columns: auto minmax(260px, 390px);
          align-items: center;
          gap: 12px;
        }
        .policy-clock {
          display: grid;
          grid-template-columns: auto 62px;
          align-items: center;
          gap: 9px;
        }
        .viewer-control > span,
        .policy-clock > span {
          color: var(--muted-foreground);
          font: 700 10px/1 var(--font-mono);
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }
        select,
        input[type='text'],
        input[type='number'] {
          min-height: 38px;
          border: 1px solid var(--clinical-rule-strong);
          border-radius: 0;
          background: var(--input);
          color: var(--foreground);
          font: 500 13px var(--font-sans);
        }
        select {
          padding: 0 34px 0 12px;
        }
        input[type='text'] {
          width: 100%;
          padding: 0 10px;
        }
        input[type='number'] {
          width: 62px;
          padding: 0 8px;
          text-align: center;
          font-family: var(--font-mono);
        }
        .status-strip {
          min-height: 36px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 7px 28px;
          border-bottom: 1px solid var(--border);
          background: var(--secondary);
          color: var(--muted-foreground);
          font-size: 12px;
        }
        .viewer-avatar {
          color: var(--foreground);
          font-weight: 700;
        }
        .decision-count {
          margin-left: auto;
          color: var(--clinical-accent-text);
          font-family: var(--font-mono);
        }
        .expectation {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(330px, 0.75fr);
          gap: 28px;
          padding: 22px 28px;
          border-bottom: 2px solid var(--border);
          background: var(--clinical-accent-soft);
        }
        .expectation-copy h2 {
          font-family: var(--font-sans);
          font-weight: 700;
        }
        .expectation-copy > p:not(.eyebrow) {
          max-width: 820px;
          margin: 8px 0;
          color: var(--clinical-copy);
          font-size: 13px;
          line-height: 1.5;
        }
        .expectation-copy code {
          color: var(--clinical-code);
          font: 600 10px/1.5 var(--font-mono);
        }
        .expectation-list {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .expectation-list > div {
          display: grid;
          align-content: start;
          gap: 6px;
          padding: 13px;
          border: 1px solid var(--border);
          background: var(--card);
        }
        .expectation-list strong {
          font: 700 10px/1.2 var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .expectation-list span {
          position: relative;
          padding-left: 12px;
          color: var(--clinical-copy);
          font-size: 11px;
          line-height: 1.35;
        }
        .expectation-list span::before {
          content: '•';
          position: absolute;
          left: 0;
          color: var(--primary);
        }
        .mutation-pulse {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          border-bottom: 2px solid var(--border);
          background: var(--clinical-navy);
          color: var(--foreground);
        }
        .mutation-pulse > div {
          min-width: 0;
          display: grid;
          gap: 3px;
          padding: 9px 12px;
          border-right: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .mutation-pulse small {
          color: var(--muted-foreground);
          font: 700 8px/1 var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .mutation-pulse strong {
          overflow: hidden;
          color: var(--primary);
          font: 700 11px/1.2 var(--font-sans);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .patient-shell {
          max-width: 1440px;
          margin: 22px auto 0;
          padding: 0 28px 42px;
          border: 2px solid var(--border);
          background: var(--card);
        }
        .patient-header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 28px;
          padding: 26px 0 22px;
          border-bottom: 2px solid var(--clinical-rule-strong);
        }
        .eyebrow,
        .rail-label {
          margin: 0 0 9px;
          color: var(--clinical-accent-text);
          font: 700 10px/1 var(--font-mono);
          letter-spacing: 0.12em;
        }
        h1 {
          margin: 0;
          font: 600 clamp(30px, 5vw, 48px)/1.02 var(--font-serif);
          letter-spacing: -0.035em;
        }
        .patient-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 18px;
          margin-top: 12px;
          color: var(--muted-foreground);
          font-size: 13px;
        }
        .acuity {
          min-width: 148px;
          padding: 12px 15px;
          border: 1px solid var(--border);
          border-left: 7px solid var(--clinical-good);
          background: var(--clinical-panel);
          text-align: right;
        }
        .acuity.urgent {
          border-color: var(--destructive);
        }
        .acuity small,
        .acuity strong {
          display: block;
          text-transform: capitalize;
        }
        .acuity small {
          color: var(--muted-foreground);
          font-size: 11px;
        }
        .acuity strong {
          margin-top: 3px;
          font: 650 17px/1.2 var(--font-serif);
        }
        .content-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 290px;
          gap: 30px;
        }
        .clinical-column {
          min-width: 0;
        }
        .section {
          padding: 24px 0;
          border-bottom: 1px solid var(--border);
        }
        .section-title {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 17px;
        }
        .section-title > span {
          color: var(--clinical-accent-text);
          font: 700 10px var(--font-mono);
        }
        h2 {
          margin: 0;
          font: 600 20px/1.2 var(--font-serif);
          letter-spacing: -0.015em;
        }
        .section-title > small {
          margin-left: auto;
          color: var(--muted-foreground);
          font-size: 11px;
        }
        .section-title em {
          margin-left: auto;
          color: var(--clinical-amber);
          font: 700 9px var(--font-mono);
          letter-spacing: 0.1em;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }
        .summary-grid > div {
          display: grid;
          gap: 5px;
        }
        .summary-grid small {
          color: var(--muted-foreground);
          font-size: 11px;
        }
        .summary-grid strong {
          font-size: 14px;
        }
        .summary-grid .warning {
          color: var(--clinical-amber);
        }
        .summary-grid > p {
          grid-column: 1 / -1;
          margin: 2px 0 0;
          color: var(--clinical-copy);
          font: 400 15px/1.6 var(--font-serif);
        }
        .summary-grid .discharge-draft {
          padding: 10px 12px;
          border-left: 4px solid var(--primary);
          background: var(--clinical-accent-soft);
          font-family: var(--font-sans);
          font-size: 12px;
        }
        .vitals-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          border-top: 1px solid var(--border);
          border-left: 1px solid var(--border);
        }
        .table {
          border-top: 1px solid var(--border);
        }
        .table-row {
          display: grid;
          grid-template-columns: 1.25fr 0.5fr 0.8fr 0.8fr 0.7fr 0.8fr;
          gap: 14px;
          padding: 11px 8px;
          border-bottom: 1px solid var(--border);
          font-size: 12px;
        }
        .table-head {
          color: var(--muted-foreground);
          font: 700 9px var(--font-mono);
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }
        .dose-status {
          color: var(--clinical-good);
          font-weight: 700;
        }
        .care-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .care-item {
          display: grid;
          grid-template-columns: 54px 1fr;
          column-gap: 13px;
          padding: 14px;
          border: 1px solid var(--border);
          background: var(--clinical-panel);
        }
        .care-icon {
          grid-row: 1 / 4;
          width: 54px;
          height: 54px;
          display: grid;
          place-items: center;
          color: var(--primary);
          border-right: 1px solid var(--border);
          padding-right: 12px;
        }
        .care-icon svg {
          width: 40px;
          height: 40px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.7;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .care-item > div:not(.care-icon) {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .care-item small {
          color: var(--muted-foreground);
          font: 700 9px var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .care-item strong {
          font-size: 12px;
        }
        .care-item p {
          margin: 5px 0;
          color: var(--foreground);
          font-size: 13px;
          font-weight: 650;
          line-height: 1.35;
        }
        .care-item > span {
          color: var(--muted-foreground);
          font-size: 10px;
        }
        .internal {
          border-left: 2px solid var(--clinical-amber);
          padding-left: 18px;
        }
        .notes-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
          gap: 10px;
        }
        .clinical-note {
          display: grid;
          grid-template-rows: auto 1fr auto;
          gap: 9px;
          min-width: 0;
          padding: 13px 14px;
          border: 1px solid var(--border);
          background: var(--clinical-panel);
        }
        .clinical-note header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .clinical-note header strong {
          font-size: 12px;
        }
        .clinical-note header span {
          color: var(--clinical-amber);
          font: 700 8px/1 var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .clinical-note p {
          margin: 0;
          color: var(--clinical-copy);
          font-size: 11px;
          line-height: 1.45;
        }
        .clinical-note time {
          color: var(--muted-foreground);
          font: 9px/1.2 var(--font-mono);
        }
        .contact-grid {
          display: grid;
          gap: 8px;
        }
        .care-contact {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr) auto;
          align-items: center;
          gap: 11px;
          min-width: 0;
          padding: 10px 12px;
          border: 1px solid var(--border);
          background: var(--clinical-panel);
        }
        .contact-monogram {
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border: 1px solid var(--clinical-rule-strong);
          border-radius: 50%;
          background: var(--background);
          font: 700 11px/1 var(--font-mono);
        }
        .contact-monogram svg {
          width: 18px;
          height: 18px;
          fill: none;
          stroke: currentColor;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-width: 1.6;
        }
        .contact-copy {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .contact-copy strong {
          font-size: 12px;
        }
        .contact-copy p {
          overflow: hidden;
          margin: 0;
          color: var(--muted-foreground);
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .care-contact > span {
          color: var(--clinical-accent-text);
          font: 700 9px/1 var(--font-mono);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .billing-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1px;
          background: var(--border);
          border: 1px solid var(--border);
        }
        .billing-grid > span {
          display: grid;
          gap: 5px;
          padding: 13px;
          background: var(--clinical-panel);
          color: var(--muted-foreground);
          font-size: 11px;
        }
        .billing-grid strong {
          color: var(--foreground);
          font: 650 14px var(--font-mono);
        }
        .billing-grid .total {
          background: var(--clinical-accent-soft);
        }
        .audit-row {
          display: grid;
          grid-template-columns: 130px 150px 1fr;
          gap: 15px;
          padding: 10px 0;
          border-top: 1px solid var(--border);
          font-size: 12px;
        }
        .audit-row time,
        .audit-row span {
          color: var(--muted-foreground);
        }
        .action-rail {
          min-width: 0;
          padding-top: 24px;
          border-left: 1px solid var(--border);
        }
        .rail-section {
          display: grid;
          gap: 7px;
          padding: 0 0 20px 22px;
          margin-bottom: 20px;
          border-bottom: 1px solid var(--border);
        }
        .rail-section > strong {
          font: 600 17px var(--font-serif);
        }
        .rail-section > span {
          color: var(--muted-foreground);
          font-size: 12px;
        }
        .linked-clinicians {
          display: grid;
          gap: 8px;
          min-width: 0;
          margin-top: 4px;
        }
        .linked-clinician {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          min-width: 0;
          padding: 9px 10px;
          border: 1px solid var(--clinical-rule-strong);
          background: var(--clinical-panel);
        }
        .clinician-monogram {
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border: 1px solid var(--clinical-rule-strong);
          border-radius: 50%;
          background: var(--background);
          font: 700 12px/1 var(--font-mono);
        }
        .clinician-copy {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .clinician-copy strong,
        .clinician-copy > span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clinician-copy strong {
          font-size: 12px;
        }
        .clinician-copy > span {
          color: var(--muted-foreground);
          font-size: 10px;
        }
        button {
          min-height: 42px;
          padding: 0 13px;
          border: 1px solid var(--clinical-rule-strong);
          border-radius: 0;
          background: var(--secondary);
          color: var(--secondary-foreground);
          font: 700 12px var(--font-sans);
          text-align: left;
          cursor: pointer;
        }
        button:hover {
          border-color: var(--primary);
          background: var(--accent);
          color: var(--accent-foreground);
        }
        button.primary {
          border-color: var(--primary);
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .actions button {
          position: relative;
          width: 100%;
          padding-right: 34px;
        }
        .actions button::after {
          content: '→';
          position: absolute;
          right: 13px;
          font: 700 15px var(--font-mono);
        }
        .quiet {
          margin: 0;
          color: var(--muted-foreground);
          font-size: 12px;
          line-height: 1.45;
        }
        .break-glass {
          border-left: 2px solid var(--destructive);
          padding-left: 20px;
        }
        .break-glass label,
        .restricted-emergency label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }
        .break-glass small,
        .capabilities small {
          color: var(--muted-foreground);
          font-size: 10px;
          line-height: 1.45;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .chips span {
          padding: 4px 6px;
          border: 1px solid var(--border);
          color: var(--clinical-code);
          font: 500 9px var(--font-mono);
        }
        .refusal {
          margin: 5px 0 0;
          color: var(--clinical-danger-text);
          font-size: 11px;
          line-height: 1.45;
        }
        .restricted,
        .error-state {
          min-height: 480px;
          padding: 64px max(28px, 8vw);
        }
        .restricted {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          gap: 30px;
          align-content: center;
        }
        .restricted-copy {
          max-width: 660px;
        }
        .restricted-copy h1 {
          max-width: 620px;
        }
        .restricted-copy > p:last-of-type {
          color: var(--muted-foreground);
        }
        .restricted-copy button {
          margin-top: 20px;
        }
        .restricted-location,
        .restricted-emergency {
          display: grid;
          gap: 7px;
          padding: 20px;
          border: 1px solid var(--border);
          background: var(--clinical-panel);
        }
        .restricted-location > span {
          color: var(--clinical-accent-text);
          font: 700 9px var(--font-mono);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .restricted-location strong {
          font: 600 18px var(--font-serif);
        }
        .restricted-location p {
          margin: 0;
          color: var(--muted-foreground);
          font-size: 12px;
        }
        .restricted-emergency {
          grid-column: 2;
          border-left: 2px solid var(--destructive);
        }
        .error-state code {
          display: block;
          max-width: 900px;
          margin-top: 20px;
          padding: 16px;
          background: var(--clinical-panel);
          color: var(--clinical-danger-text);
          font: 12px/1.5 var(--font-mono);
          white-space: pre-wrap;
        }
        @container patient-dashboard (max-width: 58rem) {
          .topbar {
            min-height: 58px;
            gap: 12px;
            padding: 10px 14px;
          }
          .brand {
            gap: 8px;
          }
          .brand-mark {
            width: 30px;
            height: 30px;
            font-size: 14px;
          }
          .brand strong {
            font-size: 10px;
          }
          .brand small {
            display: none;
          }
          .demo-controls {
            flex: 1;
            flex-wrap: nowrap;
            gap: 8px;
          }
          .viewer-control {
            flex: 1;
            grid-template-columns: 1fr;
            gap: 3px;
          }
          .policy-clock {
            grid-template-columns: 1fr 52px;
            gap: 3px;
          }
          .viewer-control > span,
          .policy-clock > span {
            font-size: 8px;
          }
          select,
          input[type='text'],
          input[type='number'] {
            min-height: 30px;
            font-size: 10px;
          }
          select {
            padding-inline: 8px 24px;
          }
          input[type='number'] {
            width: 52px;
          }
          .status-strip {
            min-height: 30px;
            gap: 8px;
            padding: 5px 14px;
            font-size: 10px;
          }
          .expectation {
            grid-template-columns: minmax(0, 1fr) minmax(15rem, 0.8fr);
            gap: 12px;
            padding: 12px 14px;
          }
          .expectation-copy h2 {
            font-size: 15px;
          }
          .expectation-copy > p:not(.eyebrow) {
            margin: 4px 0;
            font-size: 10px;
            line-height: 1.35;
          }
          .expectation-copy code {
            font-size: 8px;
          }
          .expectation-list {
            gap: 6px;
          }
          .expectation-list > div {
            gap: 3px;
            padding: 7px;
          }
          .expectation-list strong,
          .expectation-list span {
            font-size: 8px;
          }
          .expectation-list span {
            padding-left: 9px;
            line-height: 1.2;
          }
          .patient-shell {
            margin-top: 10px;
            padding: 0 14px 28px;
          }
          .patient-header {
            gap: 14px;
            padding: 15px 0 13px;
          }
          h1 {
            font-size: 30px;
          }
          .patient-meta {
            margin-top: 7px;
            font-size: 10px;
          }
          .acuity {
            min-width: 105px;
            padding: 8px 10px;
            border-left-width: 5px;
          }
          .content-grid {
            grid-template-columns: minmax(0, 1fr) 10.5rem;
            gap: 16px;
          }
          .section {
            padding: 16px 0;
          }
          .section-title {
            margin-bottom: 10px;
          }
          h2 {
            font-size: 16px;
          }
          .summary-grid {
            gap: 10px;
          }
          .summary-grid strong {
            font-size: 11px;
          }
          .summary-grid > p {
            font-size: 12px;
            line-height: 1.4;
          }
          .vitals-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .table-row {
            grid-template-columns: 1.15fr 0.45fr 0.7fr 0.7fr 0.65fr 0.7fr;
            gap: 5px;
            padding: 8px 4px;
            font-size: 9px;
          }
          .care-grid {
            grid-template-columns: 1fr;
          }
          .action-rail {
            padding-top: 16px;
          }
          .rail-section {
            gap: 4px;
            margin-bottom: 12px;
            padding: 0 0 12px 12px;
          }
          .rail-section > strong {
            font-size: 13px;
          }
          .rail-section > span {
            font-size: 9px;
          }
          .actions button {
            min-height: 32px;
            padding: 0 8px;
            font-size: 9px;
          }
          .actions button::after {
            display: none;
          }
          .chips {
            gap: 3px;
          }
          .chips span {
            padding: 2px 3px;
            font-size: 7px;
          }
          .capabilities small {
            font-size: 8px;
          }
        }
        @media (max-width: 920px) {
          .expectation {
            grid-template-columns: 1fr;
          }
          .content-grid {
            grid-template-columns: 1fr;
          }
          .action-rail {
            border-left: 0;
          }
          .rail-section {
            padding-left: 0;
          }
          .vitals-grid {
            grid-template-columns: repeat(3, 1fr);
          }
          .summary-grid {
            grid-template-columns: 1fr 1fr;
          }
          .billing-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 680px) {
          .topbar {
            align-items: stretch;
            flex-direction: column;
            padding: 16px 18px;
          }
          .demo-controls {
            align-items: stretch;
            flex-direction: column;
          }
          .viewer-control {
            grid-template-columns: 1fr;
          }
          .policy-clock {
            grid-template-columns: 1fr 72px;
          }
          .expectation {
            padding: 18px;
          }
          .expectation-list,
          .care-grid {
            grid-template-columns: 1fr;
          }
          .patient-shell {
            margin-top: 12px;
            padding: 0 18px 30px;
            border-inline: 0;
          }
          .patient-header {
            align-items: start;
            flex-direction: column;
          }
          .status-strip {
            padding-inline: 18px;
          }
          .decision-count {
            display: none;
          }
          .vitals-grid,
          .summary-grid,
          .billing-grid {
            grid-template-columns: 1fr 1fr;
          }
          .table-row {
            grid-template-columns: 1fr 1fr;
          }
          .table-head {
            display: none;
          }
          .audit-row {
            grid-template-columns: 1fr;
            gap: 3px;
          }
          .restricted {
            grid-template-columns: 1fr;
            padding: 42px 22px;
          }
          .restricted-emergency {
            grid-column: 1;
          }
        }
      </style>
    </template>
  };
}

interface MetricSignature {
  Args: {
    label: string;
    value: unknown;
    unit: string;
  };
}

class Metric extends Component<MetricSignature> {
  <template>
    <div class='metric'>
      <span>{{@label}}</span>
      <strong>{{@value}}</strong>
      <small>{{@unit}}</small>
    </div>
    <style scoped>
      .metric {
        min-width: 0;
        padding: 13px 11px;
        border-right: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
        background: var(--clinical-panel);
      }
      span {
        display: block;
        min-height: 26px;
        color: var(--muted-foreground);
        font-size: 10px;
        line-height: 1.25;
      }
      strong {
        color: var(--foreground);
        font: 650 19px/1 var(--font-mono);
      }
      small {
        margin-left: 4px;
        color: var(--muted-foreground);
        font-size: 9px;
      }
    </style>
  </template>
}
