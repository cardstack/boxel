import {
  rri,
  type Definition,
  type FieldDefinition,
  type LooseSingleCardDocument,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

// A synthetic hospital ward workload for Lattice acceptance tests. It is the
// clinical parallel of the Nucleus LMS classroom-day dashboard that motivates
// Lattice: patients stand in for students, clinicians for staff, vitals for
// observations, dose events for BAT tallies, shift notes for daily reports,
// the ward board for Classroom Central, and the facility census for the
// head-of-school view. Every value is fabricated; nothing is read from a
// deployment realm. Three test layers consume this module:
//
//   lattice-clinical-oracle-test      pure, no database
//   lattice-clinical-routing-test     Postgres registry, no browser
//   lattice-clinical-publication-test full realm, Chrome producer
//
// The oracle below computes every derived value from raw documents, without
// CardDef getters, BXL, SQL or the server. A scenario is a set of writes plus a
// hand-stated claim about which owners must change; the oracle diff must agree
// with the claim (catalog self-consistency) and the system must agree with the
// oracle (acceptance).

export const latticeClinicalSource = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, Component, field, contains, containsMany, linksTo, linksToMany } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import NumberField from '@cardstack/base/number';
  import BooleanField from '@cardstack/base/boolean';
  const formula = (expression) => bxl(expression, { libraries: ['core'], readableSyntax: false });

  export class Principal extends CardDef {
    @field partyId = contains(StringField);
    @field displayName = contains(StringField);
    @field role = contains(StringField);
    @field department = contains(StringField);
    @field members = linksToMany(() => Principal);
    @field cardTitle = contains(StringField, { computeVia: formula('.displayName // .partyId') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}</output></template>
    };
  }

  export class PatientRecord extends CardDef {
    @field patientId = contains(StringField);
    @field name = contains(StringField);
    @field ward = contains(StringField);
    @field status = contains(StringField);
    @field severity = contains(StringField);
    @field admittedOn = contains(StringField);
    @field attending = linksTo(Principal);
    @field careTeam = linksTo(Principal);
    @field cardTitle = contains(StringField, { computeVia: formula('.name + " · " + .patientId') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}: {{@model.status}}</output></template>
    };
  }

  export class VitalsReading extends CardDef {
    @field patientId = contains(StringField);
    @field date = contains(StringField);
    @field takenAt = contains(StringField);
    @field recordedBy = contains(StringField);
    @field note = contains(StringField);
    @field heartRate = contains(NumberField);
    @field systolic = contains(NumberField);
    @field spo2 = contains(NumberField);
    @field tempC = contains(NumberField);
    @field critical = contains(BooleanField, {
      computeVia: formula('(.heartRate > 120) or (.spo2 < 90) or (.systolic > 180)'),
    });
    @field cardTitle = contains(StringField, { computeVia: formula('.patientId + " vitals " + .date + " " + .takenAt') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}: {{@model.heartRate}}</output></template>
    };
  }

  export class DoseEvent extends CardDef {
    @field patientId = contains(StringField);
    @field date = contains(StringField);
    @field medication = contains(StringField);
    @field dueAt = contains(StringField);
    @field status = contains(StringField);
    @field cardTitle = contains(StringField, { computeVia: formula('.medication + " " + .dueAt') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}: {{@model.status}}</output></template>
    };
  }

  export class ShiftNote extends CardDef {
    @field patientId = contains(StringField);
    @field date = contains(StringField);
    @field author = contains(StringField);
    @field category = contains(StringField);
    @field status = contains(StringField);
    @field version = contains(NumberField);
    @field cardTitle = contains(StringField, { computeVia: formula('.category + " v" + (.version | tostring)') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}: {{@model.status}}</output></template>
    };
  }

  export class PatientDaySummary extends CardDef {
    static materialized = true;
    static queryInputs = {
      patients: { links: { attending: { many: false, projection: {} } } },
      vitals: {},
      doses: {},
      notes: {},
    };
    @field patientId = contains(StringField);
    @field date = contains(StringField);
    @field patients = linksToMany(PatientRecord, {
      query: { filter: { eq: { patientId: '$this.patientId' } }, page: { size: 5 } },
    });
    @field vitals = linksToMany(VitalsReading, {
      query: { filter: { eq: { patientId: '$this.patientId', date: '$this.date' } }, page: { size: 8 } },
    });
    @field doses = linksToMany(DoseEvent, {
      query: { filter: { eq: { patientId: '$this.patientId', date: '$this.date' } }, page: { size: 20 } },
    });
    @field notes = linksToMany(ShiftNote, {
      query: { filter: { eq: { patientId: '$this.patientId', date: '$this.date' } }, page: { size: 20 } },
    });
    @field ward = contains(StringField, { computeVia: formula('.patients[0].ward // ""') });
    @field patientName = contains(StringField, { computeVia: formula('.patients[0].name // ""') });
    @field attendingName = contains(StringField, { computeVia: formula('.patients[0].attending.displayName // ""') });
    @field admitted = contains(BooleanField, { computeVia: formula('(.patients[0].status // "") == "admitted"') });
    @field vitalsCount = contains(NumberField, { computeVia: formula('.vitals | length') });
    @field criticalCount = contains(NumberField, { computeVia: formula('[.vitals[] | select(.critical)] | length') });
    @field lastHeartRate = contains(NumberField, { computeVia: formula('([.vitals[]] | max_by(.takenAt) | .heartRate) // 0') });
    @field dosesDue = contains(NumberField, { computeVia: formula('[.doses[] | select(.status == "due")] | length') });
    @field dosesGiven = contains(NumberField, { computeVia: formula('[.doses[] | select(.status == "given")] | length') });
    @field dosesHeld = contains(NumberField, { computeVia: formula('[.doses[] | select(.status == "held")] | length') });
    @field marComplete = contains(BooleanField, { computeVia: formula('([.doses[] | select(.status == "due")] | length) == 0') });
    @field latestNoteVersion = contains(NumberField, { computeVia: formula('[.notes[].version] | max // 0') });
    @field noteSigned = contains(BooleanField, { computeVia: formula('([.notes[] | select(.status == "signed")] | length) > 0') });
    @field rowStatus = contains(StringField, {
      computeVia: formula('if ([.vitals[] | select(.critical)] | length) > 0 then "critical" elif ([.doses[] | select(.status == "due")] | length) > 0 then "attention" else "stable" end'),
    });
    @field cardTitle = contains(StringField, { computeVia: formula('.patientId + " " + .date') });
    static isolated = class extends Component<typeof this> {
      <template>
        <section data-clinical-summary data-state={{@model.publicationState}}>
          <output data-vitals>{{@model.vitalsCount}}</output>
          <output data-critical>{{@model.criticalCount}}</output>
          <output data-status>{{@model.rowStatus}}</output>
        </section>
      </template>
    };
  }

  export class WardBoard extends CardDef {
    static materialized = true;
    static queryInputs = { census: {}, days: {} };
    @field ward = contains(StringField);
    @field date = contains(StringField);
    @field census = linksToMany(PatientRecord, {
      query: { filter: { eq: { ward: '$this.ward', status: 'admitted' } }, page: { size: 50 } },
    });
    @field days = linksToMany(PatientDaySummary, {
      query: { filter: { eq: { ward: '$this.ward', date: '$this.date' } }, page: { size: 50 } },
    });
    @field censusCount = contains(NumberField, { computeVia: formula('.census | length') });
    @field highSeverity = contains(NumberField, { computeVia: formula('[.census[] | select(.severity == "High" or .severity == "Critical")] | length') });
    @field criticalPatients = contains(NumberField, { computeVia: formula('[.days[] | select(.criticalCount > 0)] | length') });
    @field dueDoses = contains(NumberField, { computeVia: formula('[.days[].dosesDue] | add // 0') });
    @field unsignedNotes = contains(NumberField, { computeVia: formula('[.days[] | select(.admitted == true and .noteSigned == false)] | length') });
    @field rowLines = containsMany(StringField, {
      computeVia: formula('[.days[] | select(.admitted == true)] | sort_by([.rowStatus, .patientId]) | map(.patientId + " " + .patientName + " " + .attendingName + " " + .rowStatus + " " + (.criticalCount | tostring) + "/" + (.vitalsCount | tostring))'),
    });
    @field cardTitle = contains(StringField, { computeVia: formula('.ward + " board " + .date') });
    static isolated = class extends Component<typeof this> {
      <template>
        <section data-clinical-board data-state={{@model.publicationState}}>
          <output data-census>{{@model.censusCount}}</output>
          <output data-critical>{{@model.criticalPatients}}</output>
          {{#each @model.rowLines as |line|}}<div data-row>{{line}}</div>{{/each}}
        </section>
      </template>
    };
  }

  export class FacilityCensus extends CardDef {
    static materialized = true;
    static queryInputs = { boards: {} };
    @field date = contains(StringField);
    @field boards = linksToMany(WardBoard, {
      query: { filter: { eq: { date: '$this.date' } }, page: { size: 20 } },
    });
    @field admittedTotal = contains(NumberField, { computeVia: formula('[.boards[].censusCount] | add // 0') });
    @field criticalTotal = contains(NumberField, { computeVia: formula('[.boards[].criticalPatients] | add // 0') });
    @field wardsNeedingSignatures = containsMany(StringField, {
      computeVia: formula('[.boards[] | select(.unsignedNotes > 0) | .ward] | unique'),
    });
    @field cardTitle = contains(StringField, { computeVia: formula('"Facility " + .date') });
    static isolated = class extends Component<typeof this> {
      <template>
        <section data-clinical-census data-state={{@model.publicationState}}>
          <output data-admitted>{{@model.admittedTotal}}</output>
          <output data-critical>{{@model.criticalTotal}}</output>
        </section>
      </template>
    };
  }
`;

export type ClinicalType =
  | 'Principal'
  | 'PatientRecord'
  | 'VitalsReading'
  | 'DoseEvent'
  | 'ShiftNote'
  | 'PatientDaySummary'
  | 'WardBoard'
  | 'FacilityCensus';

export const CLINICAL_OWNER_TYPES: ClinicalType[] = [
  'PatientDaySummary',
  'WardBoard',
  'FacilityCensus',
];

export interface ClinicalDocument {
  data: {
    type: 'card';
    attributes: Record<string, unknown>;
    relationships?: Record<string, { links: { self: string | null } }>;
    meta: { adoptsFrom: ResolvedCodeRef };
  };
}

export type ClinicalRecords = Map<string, ClinicalDocument>;

export const CLINICAL_DATES = ['2026-09-14', '2026-09-15'] as const;
export const CLINICAL_WARDS = ['cardiology', 'icu'] as const;

const FIRST_NAMES = [
  'Margaret',
  'Devon',
  'Priya',
  'Owen',
  'Sara',
  'Theo',
  'Nia',
  'Warner',
  'Elena',
  'Cameron',
  'Amara',
  'Jordan',
  'Rina',
  'Casey',
  'Aisha',
  'Morgan',
];
const LAST_NAMES = [
  'Okonkwo',
  'Ramaswamy',
  'Cohen',
  'Grant',
  'Martin',
  'Okafor',
  'Ruiz',
  'Price',
  'Shah',
  'Blake',
  'Patel',
  'Ward',
  'Tahir',
  'Lee',
  'Cole',
  'Iyer',
];
const SEVERITIES = ['Low', 'Moderate', 'High', 'Critical'] as const;
const MEDICATIONS = ['Metoprolol', 'Warfarin', 'Furosemide', 'Insulin'];
const NOTE_CATEGORIES = ['Shift handoff', 'Care plan', 'Family update'];

export function clinicalModuleRef(
  realmURL: string,
  name: ClinicalType,
): ResolvedCodeRef {
  return { module: rri(realmURL + 'cards'), name };
}

function pad(n: number): string {
  return String(n).padStart(5, '0');
}

export interface GenerateClinicalOptions {
  realmURL: string;
  // Admitted patients per ward. 1 gives a smoke fixture of roughly 50 cards.
  scale?: number;
  seed?: number;
  // Instance directories for the three owner types. The default sorts in
  // dependency-height order; the drain-order reproducer passes the natural
  // names, whose lexical order puts the census first.
  ownerDirectories?: { summary: string; board: string; census: string };
}

export const HEIGHT_ORDERED_DIRECTORIES = {
  summary: 'Bedside',
  board: 'Board',
  census: 'Census',
};
export const NATURAL_DIRECTORIES = {
  summary: 'PatientDaySummary',
  board: 'WardBoard',
  census: 'FacilityCensus',
};

export interface ClinicalIds {
  realmURL: string;
  dates: readonly string[];
  wards: readonly string[];
  // Patient paths (without .json) grouped by ward and status.
  admitted: Record<string, string[]>;
  // Admitted patients in generation order (wards alternate). Notes are signed
  // for even positions and unsigned for odd ones.
  admittedInOrder: string[];
  discharged: string[];
  attendingOf: (patient: string) => string;
  patientIdOf: (patient: string) => string;
  vitalsOf: (patient: string, date: string) => string[];
  dosesOf: (patient: string, date: string) => string[];
  notesOf: (patient: string, date: string) => string[];
  summary: (patient: string, date: string) => string;
  board: (ward: string, date: string) => string;
  census: (date: string) => string;
}

// Deterministic fabricated workload. The layout is chosen so every scenario in
// the catalog can name its targets structurally (first admitted cardiology
// patient, the reading with no siblings, and so on) instead of by hand.
export function generateClinical({
  realmURL,
  scale = 1,
  seed = 1729,
  ownerDirectories = HEIGHT_ORDERED_DIRECTORIES,
}: GenerateClinicalOptions): { records: ClinicalRecords; ids: ClinicalIds } {
  if (!Number.isInteger(scale) || scale < 1 || scale > 40)
    throw new Error('Clinical scale must be an integer between 1 and 40');
  let state = seed >>> 0;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const between = (low: number, high: number) =>
    low + Math.floor(random() * (high - low + 1));
  const records: ClinicalRecords = new Map();
  const ref = (name: ClinicalType) => clinicalModuleRef(realmURL, name);
  const put = (
    path: string,
    name: ClinicalType,
    attributes: Record<string, unknown>,
    relationships?: ClinicalDocument['data']['relationships'],
  ) => {
    records.set(path + '.json', {
      data: {
        type: 'card',
        attributes,
        ...(relationships ? { relationships } : {}),
        meta: { adoptsFrom: ref(name) },
      },
    });
    return path;
  };
  const link = (target: string) => ({ links: { self: '../' + target } });

  // Clinicians: two attendings and one nurse per ward, one team per ward.
  const attendings: Record<string, string[]> = {};
  const teams: Record<string, string> = {};
  let principalIndex = 0;
  for (const ward of CLINICAL_WARDS) {
    attendings[ward] = [];
    const people: string[] = [];
    for (const role of ['Attending', 'Attending', 'Nurse']) {
      principalIndex++;
      const first = FIRST_NAMES[principalIndex % FIRST_NAMES.length];
      const last = LAST_NAMES[(principalIndex * 3) % LAST_NAMES.length];
      const path = put(`Principal/c-${pad(principalIndex)}`, 'Principal', {
        partyId: `person:c-${pad(principalIndex)}`,
        displayName: `${role === 'Nurse' ? '' : 'Dr. '}${first} ${last}`,
        role,
        department: ward,
      });
      people.push(path);
      if (role === 'Attending') attendings[ward].push(path);
    }
    principalIndex++;
    teams[ward] = put(
      `Principal/t-${pad(principalIndex)}`,
      'Principal',
      {
        partyId: `team:${ward}`,
        displayName: `${ward} care team`,
        role: 'Team',
        department: ward,
      },
      Object.fromEntries(
        people.slice(1).map((member, i) => [`members.${i}`, link(member)]),
      ),
    );
  }

  // Patients: `scale` admitted per ward, plus one discharged cardiology patient.
  const admitted: Record<string, string[]> = { cardiology: [], icu: [] };
  const discharged: string[] = [];
  const attendingOf = new Map<string, string>();
  const patientIdOf = new Map<string, string>();
  let patientIndex = 0;
  const addPatient = (ward: string, status: 'admitted' | 'discharged') => {
    patientIndex++;
    const first = FIRST_NAMES[(patientIndex * 5) % FIRST_NAMES.length];
    const last = LAST_NAMES[(patientIndex * 7) % LAST_NAMES.length];
    const attending = attendings[ward][patientIndex % 2];
    const patientId = `PT-${1000 + patientIndex}`;
    const path = put(
      `PatientRecord/p-${pad(patientIndex)}`,
      'PatientRecord',
      {
        patientId,
        name: `${first} ${last}`,
        ward,
        status,
        severity: SEVERITIES[patientIndex % SEVERITIES.length],
        admittedOn: '2026-09-1' + (patientIndex % 4),
      },
      { attending: link(attending), careTeam: link(teams[ward]) },
    );
    attendingOf.set(path, attending);
    patientIdOf.set(path, patientId);
    (status === 'admitted' ? admitted[ward] : discharged).push(path);
    return path;
  };
  for (let i = 0; i < scale; i++) {
    addPatient('cardiology', 'admitted');
    addPatient('icu', 'admitted');
  }
  addPatient('cardiology', 'discharged');

  // Vitals, doses and notes per (patient, date).
  const vitals = new Map<string, string[]>();
  const doses = new Map<string, string[]>();
  const notes = new Map<string, string[]>();
  const key = (patient: string, date: string) => `${patient}|${date}`;
  let vitalsIndex = 0,
    doseIndex = 0,
    noteIndex = 0;
  const allAdmitted = [...admitted.cardiology, ...admitted.icu];
  allAdmitted.forEach((patient, index) => {
    const patientId = patientIdOf.get(patient)!;
    CLINICAL_DATES.forEach((date, dateIndex) => {
      const readings: string[] = [];
      // The third cardiology patient has no readings on the second date so a
      // scenario can exercise the empty-to-first-match transition. With scale
      // 1 that role falls to the first cardiology patient instead.
      const noReadings =
        dateIndex === 1 &&
        patient === admitted.cardiology[Math.min(2, scale - 1)];
      if (!noReadings) {
        for (let r = 0; r < 2; r++) {
          vitalsIndex++;
          // The first ICU patient's first reading on the first date is critical
          // so the facility census starts with a non-zero critical total.
          const critical =
            patient === admitted.icu[0] && dateIndex === 0 && r === 0;
          readings.push(
            put(`VitalsReading/v-${pad(vitalsIndex)}`, 'VitalsReading', {
              patientId,
              date,
              takenAt: r === 0 ? '08:00' : '14:00',
              recordedBy: 'Nurse on shift',
              note: `Routine reading ${vitalsIndex}`,
              heartRate: critical ? 128 : between(64, 108),
              systolic: between(108, 152),
              spo2: between(94, 99),
              tempC: 36 + Math.round(random() * 15) / 10,
            }),
          );
        }
      }
      vitals.set(key(patient, date), readings);
      const dosePaths: string[] = [];
      for (let d = 0; d < 3; d++) {
        doseIndex++;
        // Rotate statuses by patient so some summaries start with doses due.
        const status = ['given', 'due', 'held'][(d + index) % 3];
        dosePaths.push(
          put(`DoseEvent/m-${pad(doseIndex)}`, 'DoseEvent', {
            patientId,
            date,
            medication: MEDICATIONS[(d + index) % MEDICATIONS.length],
            dueAt: ['08:00', '14:00', '20:00'][d],
            status,
          }),
        );
      }
      doses.set(key(patient, date), dosePaths);
      const notePaths: string[] = [];
      noteIndex++;
      notePaths.push(
        put(`ShiftNote/n-${pad(noteIndex)}`, 'ShiftNote', {
          patientId,
          date,
          author: 'Nurse on shift',
          category: NOTE_CATEGORIES[index % NOTE_CATEGORIES.length],
          status: 'draft',
          version: 1,
        }),
      );
      if (index % 2 === 0) {
        noteIndex++;
        notePaths.push(
          put(`ShiftNote/n-${pad(noteIndex)}`, 'ShiftNote', {
            patientId,
            date,
            author: 'Attending',
            category: NOTE_CATEGORIES[index % NOTE_CATEGORIES.length],
            status: 'signed',
            version: 2,
          }),
        );
      }
      notes.set(key(patient, date), notePaths);
    });
  });
  // The discharged patient keeps one historical reading and nothing else.
  for (const patient of discharged) {
    vitalsIndex++;
    vitals.set(key(patient, CLINICAL_DATES[0]), [
      put(`VitalsReading/v-${pad(vitalsIndex)}`, 'VitalsReading', {
        patientId: patientIdOf.get(patient)!,
        date: CLINICAL_DATES[0],
        takenAt: '07:30',
        recordedBy: 'Discharge nurse',
        note: 'Pre-discharge check',
        heartRate: 72,
        systolic: 118,
        spo2: 98,
        tempC: 36.6,
      }),
    ]);
    vitals.set(key(patient, CLINICAL_DATES[1]), []);
    for (const date of CLINICAL_DATES) {
      doses.set(key(patient, date), []);
      notes.set(key(patient, date), []);
    }
  }

  // Owners: one summary per (patient, date), one board per (ward, date), one
  // census per date. Their authored attributes are only the query parameters.
  //
  // Directory names are chosen so that lexical order equals dependency height
  // (Bedside < Board < Census). The current materialization drain takes the
  // first pending owner by URL and processes one owner per wave; an owner
  // whose feeders are still pending fails that wave, so a top-of-chain owner
  // that sorted first would block the whole realm. See the run log in
  // docs/lattice-clinical-use-cases.md. Height-ordered stabilisation is
  // to-be item 4 in the evaluation; when it lands, this constraint can go.
  const summaryPath = (patient: string, date: string) =>
    `${ownerDirectories.summary}/${patient.split('/')[1]}-d${CLINICAL_DATES.indexOf(date as any)}`;
  const boardPath = (ward: string, date: string) =>
    `${ownerDirectories.board}/${ward}-d${CLINICAL_DATES.indexOf(date as any)}`;
  const censusPath = (date: string) =>
    `${ownerDirectories.census}/d${CLINICAL_DATES.indexOf(date as any)}`;
  for (const patient of [...allAdmitted, ...discharged])
    for (const date of CLINICAL_DATES)
      put(summaryPath(patient, date), 'PatientDaySummary', {
        patientId: patientIdOf.get(patient)!,
        date,
      });
  for (const ward of CLINICAL_WARDS)
    for (const date of CLINICAL_DATES)
      put(boardPath(ward, date), 'WardBoard', { ward, date });
  for (const date of CLINICAL_DATES)
    put(censusPath(date), 'FacilityCensus', { date });

  const ids: ClinicalIds = {
    realmURL,
    dates: CLINICAL_DATES,
    wards: CLINICAL_WARDS,
    admitted,
    admittedInOrder: allAdmitted,
    discharged,
    attendingOf: (patient) => attendingOf.get(patient)!,
    patientIdOf: (patient) => patientIdOf.get(patient)!,
    vitalsOf: (patient, date) => vitals.get(key(patient, date)) ?? [],
    dosesOf: (patient, date) => doses.get(key(patient, date)) ?? [],
    notesOf: (patient, date) => notes.get(key(patient, date)) ?? [],
    summary: summaryPath,
    board: boardPath,
    census: censusPath,
  };
  return { records, ids };
}

export function clinicalFixtures(
  records: ClinicalRecords,
): Record<string, LooseSingleCardDocument> {
  return Object.fromEntries(
    [...records].map(([path, doc]) => [
      path,
      doc as unknown as LooseSingleCardDocument,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Raw-document oracle. Mirrors the BXL formulas in the source above exactly,
// including jq's null handling (`// 0`, `max` of an empty list) and string
// ordering. Any divergence between the two is a fixture bug, not a system bug,
// and the oracle test guards the arithmetic with hand-computed spot checks.

type Attrs = Record<string, any>;

function typeOf(doc: ClinicalDocument): ClinicalType {
  return doc.data.meta.adoptsFrom.name as ClinicalType;
}

function attrs(doc: ClinicalDocument): Attrs {
  return doc.data.attributes;
}

function linkTarget(doc: ClinicalDocument, name: string): string | undefined {
  const self = doc.data.relationships?.[name]?.links.self;
  return self ? self.replace(/^\.\.\//, '') + '.json' : undefined;
}

function ofType(records: ClinicalRecords, type: ClinicalType) {
  return [...records].filter(([, doc]) => typeOf(doc) === type);
}

function jqSortKey(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(' ') : String(value);
}

export function expectedVitals(doc: ClinicalDocument): Attrs {
  const a = attrs(doc);
  return {
    critical: a.heartRate > 120 || a.spo2 < 90 || a.systolic > 180,
  };
}

export function expectedSummary(records: ClinicalRecords, path: string): Attrs {
  const owner = attrs(records.get(path)!);
  const patients = ofType(records, 'PatientRecord')
    .filter(([, doc]) => attrs(doc).patientId === owner.patientId)
    .map(([, doc]) => doc);
  const patient = patients[0];
  const attending = patient && linkTarget(patient, 'attending');
  const attendingDoc = attending ? records.get(attending) : undefined;
  const sameDay = (type: ClinicalType) =>
    ofType(records, type)
      .filter(
        ([, doc]) =>
          attrs(doc).patientId === owner.patientId &&
          attrs(doc).date === owner.date,
      )
      .map(([, doc]) => attrs(doc));
  const vitals = sameDay('VitalsReading');
  const doses = sameDay('DoseEvent');
  const notes = sameDay('ShiftNote');
  const criticalCount = vitals.filter(
    (v) => v.heartRate > 120 || v.spo2 < 90 || v.systolic > 180,
  ).length;
  const dosesDue = doses.filter((d) => d.status === 'due').length;
  const latest = vitals.reduce<Attrs | undefined>(
    (best, v) => (!best || v.takenAt >= best.takenAt ? v : best),
    undefined,
  );
  const versions = notes.map((n) => n.version as number);
  return {
    ward: patient ? attrs(patient).ward : '',
    patientName: patient ? attrs(patient).name : '',
    attendingName: attendingDoc ? attrs(attendingDoc).displayName : '',
    admitted: (patient ? attrs(patient).status : '') === 'admitted',
    vitalsCount: vitals.length,
    criticalCount,
    lastHeartRate: latest?.heartRate ?? 0,
    dosesDue,
    dosesGiven: doses.filter((d) => d.status === 'given').length,
    dosesHeld: doses.filter((d) => d.status === 'held').length,
    marComplete: dosesDue === 0,
    latestNoteVersion: versions.length ? Math.max(...versions) : 0,
    noteSigned: notes.some((n) => n.status === 'signed'),
    rowStatus:
      criticalCount > 0 ? 'critical' : dosesDue > 0 ? 'attention' : 'stable',
  };
}

export function expectedBoard(records: ClinicalRecords, path: string): Attrs {
  const owner = attrs(records.get(path)!);
  const census = ofType(records, 'PatientRecord')
    .filter(
      ([, doc]) =>
        attrs(doc).ward === owner.ward && attrs(doc).status === 'admitted',
    )
    .map(([, doc]) => attrs(doc));
  const days = ofType(records, 'PatientDaySummary')
    .map(([summaryPath, doc]) => ({
      ...attrs(doc),
      ...expectedSummary(records, summaryPath),
    }))
    .filter((day) => day.ward === owner.ward && day.date === owner.date);
  const rows = days
    .filter((day) => day.admitted === true)
    .sort((a, b) => {
      const ka = jqSortKey([a.rowStatus, a.patientId]);
      const kb = jqSortKey([b.rowStatus, b.patientId]);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map(
      (day) =>
        `${day.patientId} ${day.patientName} ${day.attendingName} ${day.rowStatus} ${day.criticalCount}/${day.vitalsCount}`,
    );
  return {
    censusCount: census.length,
    highSeverity: census.filter(
      (p) => p.severity === 'High' || p.severity === 'Critical',
    ).length,
    criticalPatients: days.filter((day) => day.criticalCount > 0).length,
    dueDoses: days.reduce((sum, day) => sum + day.dosesDue, 0),
    unsignedNotes: days.filter(
      (day) => day.admitted === true && day.noteSigned === false,
    ).length,
    rowLines: rows,
  };
}

export function expectedCensus(records: ClinicalRecords, path: string): Attrs {
  const owner = attrs(records.get(path)!);
  const boards = ofType(records, 'WardBoard')
    .map(([boardPath, doc]) => ({
      ...attrs(doc),
      ...expectedBoard(records, boardPath),
    }))
    .filter((board) => board.date === owner.date);
  return {
    admittedTotal: boards.reduce((sum, b) => sum + b.censusCount, 0),
    criticalTotal: boards.reduce((sum, b) => sum + b.criticalPatients, 0),
    wardsNeedingSignatures: [
      ...new Set(
        boards.filter((b) => b.unsignedNotes > 0).map((b) => b.ward as string),
      ),
    ].sort(),
  };
}

export function expectedOwner(records: ClinicalRecords, path: string): Attrs {
  switch (typeOf(records.get(path)!)) {
    case 'PatientDaySummary':
      return expectedSummary(records, path);
    case 'WardBoard':
      return expectedBoard(records, path);
    case 'FacilityCensus':
      return expectedCensus(records, path);
    default:
      throw new Error(`${path} is not a Lattice owner`);
  }
}

export function expectedOwners(records: ClinicalRecords): Map<string, Attrs> {
  return new Map(
    [...records]
      .filter(([, doc]) => CLINICAL_OWNER_TYPES.includes(typeOf(doc)))
      .map(([path]) => [path, expectedOwner(records, path)]),
  );
}

// Every computed attribute a card of this type publishes, as the indexer
// serializes it (authored attributes plus computed values).
export function expectedAttributes(
  records: ClinicalRecords,
  path: string,
): Attrs {
  const doc = records.get(path)!;
  const base = { ...attrs(doc) };
  switch (typeOf(doc)) {
    case 'VitalsReading':
      return { ...base, ...expectedVitals(doc) };
    case 'PatientDaySummary':
    case 'WardBoard':
    case 'FacilityCensus':
      return { ...base, ...expectedOwner(records, path) };
    default:
      return base;
  }
}

export function changedOwners(
  before: Map<string, Attrs>,
  after: Map<string, Attrs>,
): string[] {
  const changed: string[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
      changed.push(path);
  }
  return changed.sort();
}

// ---------------------------------------------------------------------------
// Scenario catalog. Order matters: the publication layer runs the scenarios in
// sequence on one realm, and each claim must hold at its point in the
// sequence (the oracle test checks this). Value-changing scenarios come
// first, then the structural ones (transfer, discharge, board re-date), then
// the page-bound case, whose receipt distinguishes page size from full total.

export interface ClinicalWrite {
  op: 'POST' | 'PATCH' | 'DELETE';
  // Path with `.json`.
  path: string;
  // POST: the full document. PATCH: attributes/relationships to merge.
  document?: ClinicalDocument;
  attributes?: Attrs;
  relationships?: ClinicalDocument['data']['relationships'];
}

export interface ClinicalScenario {
  key: string;
  title: string;
  // The Nucleus LMS event this stands in for.
  parallel: string;
  // The Lattice behaviour the scenario exercises.
  proves: string;
  writes: (ids: ClinicalIds, records: ClinicalRecords) => ClinicalWrite[];
  // Owners whose published output must change (paths with .json).
  affected: (ids: ClinicalIds) => string[];
  // Owners the registry may route to (a member changed) whose output stays the
  // same. Cutoff must stop them from propagating further.
  cutoff?: (ids: ClinicalIds) => string[];
  // Owners the registry must not route to at all.
  unaffected?: (ids: ClinicalIds) => string[];
  // These owners deliberately compute over a page, with its full total in the receipt.
  paged?: (ids: ClinicalIds) => string[];
}

const j = (path: string) => path + '.json';

function newDoc(
  realmURL: string,
  name: ClinicalType,
  attributes: Attrs,
  relationships?: ClinicalDocument['data']['relationships'],
): ClinicalDocument {
  return {
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: { adoptsFrom: clinicalModuleRef(realmURL, name) },
    },
  };
}

export const CLINICAL_SCENARIOS: ClinicalScenario[] = [
  {
    key: 'first-vitals',
    title: 'A first reading arrives for a patient-day that had none',
    parallel:
      'First observation of the day for a student (empty query starts matching)',
    proves:
      'empty-to-first-match invalidation; the census is unchanged and must be cut off',
    writes: (ids) => {
      const patient =
        ids.admitted.cardiology[
          Math.min(2, ids.admitted.cardiology.length - 1)
        ];
      return [
        {
          op: 'POST',
          path: j('VitalsReading/v-first'),
          document: newDoc(ids.realmURL, 'VitalsReading', {
            patientId: ids.patientIdOf(patient),
            date: ids.dates[1],
            takenAt: '09:15',
            recordedBy: 'Nurse on shift',
            note: 'First reading of the day',
            heartRate: 84,
            systolic: 126,
            spo2: 97,
            tempC: 36.8,
          }),
        },
      ];
    },
    affected: (ids) => {
      const patient =
        ids.admitted.cardiology[
          Math.min(2, ids.admitted.cardiology.length - 1)
        ];
      return [
        j(ids.summary(patient, ids.dates[1])),
        j(ids.board('cardiology', ids.dates[1])),
      ];
    },
    cutoff: (ids) => [j(ids.census(ids.dates[1]))],
    unaffected: (ids) => [
      j(ids.board('icu', ids.dates[1])),
      j(ids.board('cardiology', ids.dates[0])),
    ],
  },
  {
    key: 'vitals-turn-critical',
    title: 'An existing reading is corrected to a critical heart rate',
    parallel:
      'An observation score is edited (content change inside membership)',
    proves:
      'matches(old) and matches(new) both route; the change climbs three levels',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.vitalsOf(ids.admitted.cardiology[0], ids.dates[0])[0]),
        attributes: { heartRate: 132 },
      },
    ],
    affected: (ids) => [
      j(ids.summary(ids.admitted.cardiology[0], ids.dates[0])),
      j(ids.board('cardiology', ids.dates[0])),
      j(ids.census(ids.dates[0])),
    ],
    unaffected: (ids) => [
      j(ids.board('icu', ids.dates[0])),
      j(ids.census(ids.dates[1])),
    ],
  },
  {
    key: 'vitals-note-only',
    title: 'A reading gains a free-text note no formula reads',
    parallel:
      'An observation narrative is edited without touching any scored field',
    proves:
      'cutoff: a member changed but every derived value is equal, nothing downstream moves',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.vitalsOf(ids.admitted.cardiology[0], ids.dates[0])[1]),
        attributes: { note: 'Patient resting comfortably' },
      },
    ],
    affected: () => [],
    cutoff: (ids) => [j(ids.summary(ids.admitted.cardiology[0], ids.dates[0]))],
    unaffected: (ids) => [
      j(ids.board('cardiology', ids.dates[0])),
      j(ids.census(ids.dates[0])),
    ],
  },
  {
    key: 'vitals-redated',
    title: 'A reading is moved to the next day',
    parallel: 'An observation is re-dated (leaves one summary, enters another)',
    proves: 'old and new owners both refresh on a key change',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.vitalsOf(ids.admitted.icu[0], ids.dates[0])[0]),
        attributes: { date: ids.dates[1] },
      },
    ],
    affected: (ids) => [
      j(ids.summary(ids.admitted.icu[0], ids.dates[0])),
      j(ids.summary(ids.admitted.icu[0], ids.dates[1])),
      j(ids.board('icu', ids.dates[0])),
      j(ids.board('icu', ids.dates[1])),
      j(ids.census(ids.dates[0])),
      j(ids.census(ids.dates[1])),
    ],
    unaffected: (ids) => [j(ids.board('cardiology', ids.dates[0]))],
  },
  {
    key: 'dose-given',
    title: 'A due dose is recorded as given',
    parallel: 'A BAT tally item is completed',
    proves:
      'a status flip changes a count and a derived row status without changing membership',
    writes: (ids, records) => {
      const patient = ids.admitted.cardiology[0];
      const due = ids
        .dosesOf(patient, ids.dates[0])
        .find((path) => attrs(records.get(j(path))!).status === 'due')!;
      return [{ op: 'PATCH', path: j(due), attributes: { status: 'given' } }];
    },
    affected: (ids) => [
      j(ids.summary(ids.admitted.cardiology[0], ids.dates[0])),
      j(ids.board('cardiology', ids.dates[0])),
    ],
    cutoff: (ids) => [j(ids.census(ids.dates[0]))],
  },
  {
    key: 'dose-deleted',
    title: 'A dose event is deleted',
    parallel: 'A tally row is removed',
    proves: 'deletion refreshes the previous audience',
    writes: (ids, records) => {
      const patient = ids.admitted.icu[0];
      const held = ids
        .dosesOf(patient, ids.dates[1])
        .find((path) => attrs(records.get(j(path))!).status === 'held')!;
      return [{ op: 'DELETE', path: j(held) }];
    },
    affected: (ids) => [j(ids.summary(ids.admitted.icu[0], ids.dates[1]))],
    cutoff: (ids) => [j(ids.board('icu', ids.dates[1]))],
    unaffected: (ids) => [j(ids.census(ids.dates[1]))],
  },
  {
    key: 'note-signed',
    title: 'A signed second version of a shift note is filed',
    parallel:
      'A daily report is regenerated and approved (new version supersedes the draft)',
    proves:
      'max-by-version and any-signed derive from a new member; the unsigned count falls',
    writes: (ids) => [
      {
        op: 'POST',
        path: j('ShiftNote/n-signed'),
        document: newDoc(ids.realmURL, 'ShiftNote', {
          patientId: ids.patientIdOf(ids.admittedInOrder[1]),
          date: ids.dates[0],
          author: 'Attending',
          category: 'Shift handoff',
          status: 'signed',
          version: 2,
        }),
      },
    ],
    // At scale 1 the target is the ward's only unsigned admitted patient, so
    // the census's list of wards needing signatures changes; at larger
    // scales the ward still has other unsigned patients and the census is a
    // cutoff case.
    affected: (ids) => {
      const target = ids.admittedInOrder[1];
      const ward = ids.admitted.cardiology.includes(target)
        ? 'cardiology'
        : 'icu';
      return [
        j(ids.summary(target, ids.dates[0])),
        j(ids.board(ward, ids.dates[0])),
        ...(ids.admitted[ward].length === 1
          ? [j(ids.census(ids.dates[0]))]
          : []),
      ];
    },
    cutoff: (ids) => {
      const target = ids.admittedInOrder[1];
      const ward = ids.admitted.cardiology.includes(target)
        ? 'cardiology'
        : 'icu';
      return ids.admitted[ward].length === 1
        ? []
        : [j(ids.census(ids.dates[0]))];
    },
  },
  {
    key: 'attending-renamed',
    title: 'An attending physician’s display name is corrected',
    parallel:
      'A staff member is renamed (transitive input through a link, not a query)',
    proves:
      'a concrete dependency reached through a projected link invalidates without any membership change',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.attendingOf(ids.admitted.cardiology[0])),
        attributes: { displayName: 'Dr. Aisha Tahir-Grant' },
      },
    ],
    affected: (ids) => {
      const attending = ids.attendingOf(ids.admitted.cardiology[0]);
      const patients = [...ids.admitted.cardiology, ...ids.discharged].filter(
        (p) => ids.attendingOf(p) === attending,
      );
      return [
        ...patients.flatMap((p) =>
          ids.dates.map((date) => j(ids.summary(p, date))),
        ),
        ...ids.dates.map((date) => j(ids.board('cardiology', date))),
      ];
    },
    cutoff: (ids) => ids.dates.map((date) => j(ids.census(date))),
    unaffected: (ids) => ids.dates.map((date) => j(ids.board('icu', date))),
  },
  {
    key: 'unrelated-ward',
    title: 'A routine reading arrives on the other ward',
    parallel: 'An observation in another classroom',
    proves:
      'blast radius: the cardiology board and both censuses are never routed',
    writes: (ids) => [
      {
        op: 'POST',
        path: j('VitalsReading/v-icu-routine'),
        document: newDoc(ids.realmURL, 'VitalsReading', {
          patientId: ids.patientIdOf(ids.admitted.icu[0]),
          date: ids.dates[1],
          takenAt: '18:00',
          recordedBy: 'Nurse on shift',
          note: 'Evening reading',
          heartRate: 76,
          systolic: 121,
          spo2: 98,
          tempC: 36.7,
        }),
      },
    ],
    affected: (ids) => [
      j(ids.summary(ids.admitted.icu[0], ids.dates[1])),
      j(ids.board('icu', ids.dates[1])),
    ],
    cutoff: (ids) => [j(ids.census(ids.dates[1]))],
    unaffected: (ids) => [
      j(ids.board('cardiology', ids.dates[1])),
      j(ids.board('icu', ids.dates[0])),
      j(ids.census(ids.dates[0])),
    ],
  },
  {
    key: 'burst',
    title: 'A round of readings lands for every cardiology patient at once',
    parallel: 'Bulk observation capture at the end of a session',
    proves:
      'many writes to one board coalesce into complete, correct outputs; each summary refreshes once per batch',
    writes: (ids) =>
      ids.admitted.cardiology.map((patient, index) => ({
        op: 'POST' as const,
        path: j(`VitalsReading/v-round-${index}`),
        document: newDoc(ids.realmURL, 'VitalsReading', {
          patientId: ids.patientIdOf(patient),
          date: ids.dates[0],
          takenAt: '20:00',
          recordedBy: 'Night nurse',
          note: 'Evening round',
          heartRate: 80 + index,
          systolic: 124,
          spo2: 97,
          tempC: 36.9,
        }),
      })),
    affected: (ids) => [
      ...ids.admitted.cardiology.map((p) => j(ids.summary(p, ids.dates[0]))),
      j(ids.board('cardiology', ids.dates[0])),
    ],
    cutoff: (ids) => [j(ids.census(ids.dates[0]))],
    unaffected: (ids) => [j(ids.board('icu', ids.dates[0]))],
  },
  {
    key: 'patient-transfer',
    title: 'A patient transfers from cardiology to the ICU',
    parallel:
      'A student moves to another classroom (feeder output re-keys the parent query)',
    proves:
      'a feeder’s computed attribute drives the parent membership; both wards refresh on both days',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.admitted.cardiology[0]),
        attributes: { ward: 'icu' },
      },
    ],
    affected: (ids) => [
      ...ids.dates.map((date) =>
        j(ids.summary(ids.admitted.cardiology[0], date)),
      ),
      ...ids.dates.flatMap((date) => [
        j(ids.board('cardiology', date)),
        j(ids.board('icu', date)),
      ]),
    ],
    cutoff: (ids) => ids.dates.map((date) => j(ids.census(date))),
  },
  {
    key: 'discharge',
    title: 'A patient is discharged',
    parallel: 'A student is withdrawn from the roster',
    proves: 'membership leaves the census; the facility total drops',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.admitted.icu[0]),
        attributes: { status: 'discharged' },
      },
    ],
    affected: (ids) => [
      ...ids.dates.map((date) => j(ids.summary(ids.admitted.icu[0], date))),
      ...ids.dates.map((date) => j(ids.board('icu', date))),
      ...ids.dates.map((date) => j(ids.census(date))),
    ],
    unaffected: (ids) =>
      ids.dates.map((date) => j(ids.board('cardiology', date))),
  },
  {
    key: 'board-redated',
    title: 'A ward board is pointed at the other day',
    parallel:
      'A dashboard’s date parameter changes (owner interpolation dependency)',
    proves:
      'changing a query parameter re-resolves membership and moves the board between censuses',
    writes: (ids) => [
      {
        op: 'PATCH',
        path: j(ids.board('icu', ids.dates[0])),
        attributes: { date: ids.dates[1] },
      },
    ],
    affected: (ids) => [
      j(ids.board('icu', ids.dates[0])),
      j(ids.census(ids.dates[0])),
      j(ids.census(ids.dates[1])),
    ],
    unaffected: (ids) =>
      ids.dates.map((date) => j(ids.board('cardiology', date))),
  },
  {
    key: 'truncated-vitals',
    title:
      'More readings arrive than the query page can hold (discharged patient, so no board row changes)',
    parallel: 'A day with more observations than the loader’s page limit',
    proves:
      'a completed query page publishes its count and preserves the full match total',
    writes: (ids) =>
      Array.from({ length: 9 }, (_, index) => ({
        op: 'POST' as const,
        path: j(`VitalsReading/v-overflow-${index}`),
        document: newDoc(ids.realmURL, 'VitalsReading', {
          patientId: ids.patientIdOf(ids.discharged[0]),
          date: ids.dates[1],
          takenAt: `1${index}:30`,
          recordedBy: 'Telemetry',
          note: 'Automated capture',
          heartRate: 90,
          systolic: 130,
          spo2: 96,
          tempC: 37,
        }),
      })),
    affected: (ids) => [j(ids.summary(ids.discharged[0], ids.dates[1]))],
    cutoff: (ids) => [j(ids.board('cardiology', ids.dates[1]))],
    unaffected: (ids) => [j(ids.census(ids.dates[1]))],
    paged: (ids) => [j(ids.summary(ids.discharged[0], ids.dates[1]))],
  },
];

export function applyWrites(
  records: ClinicalRecords,
  writes: ClinicalWrite[],
): ClinicalRecords {
  const next: ClinicalRecords = new Map(
    [...records].map(([path, doc]) => [path, structuredClone(doc)]),
  );
  for (const write of writes) {
    switch (write.op) {
      case 'POST':
        if (!write.document)
          throw new Error(`POST ${write.path} needs a document`);
        if (next.has(write.path))
          throw new Error(`POST ${write.path} already exists`);
        next.set(write.path, structuredClone(write.document));
        break;
      case 'PATCH': {
        const doc = next.get(write.path);
        if (!doc) throw new Error(`PATCH ${write.path} does not exist`);
        Object.assign(doc.data.attributes, write.attributes ?? {});
        if (write.relationships)
          doc.data.relationships = {
            ...doc.data.relationships,
            ...write.relationships,
          };
        break;
      }
      case 'DELETE':
        if (!next.delete(write.path))
          throw new Error(`DELETE ${write.path} does not exist`);
        break;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Loaderless definitions and watches for the registry layer. These mirror what
// Chrome captures from the source above, in the shape the SQL predicate
// compiler reads; the publication layer captures the real ones instead.

export function clinicalDefinitions(realmURL: string): Map<string, Definition> {
  const ref = (name: ClinicalType) => clinicalModuleRef(realmURL, name);
  const primitive = (
    scalar: 'string' | 'number' | 'boolean',
  ): FieldDefinition => ({
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: { module: rri(realmURL + 'primitives'), name: scalar },
    nativeCodec:
      scalar === 'number'
        ? { kind: 'primitive', serializer: 'number' }
        : scalar === 'string'
          ? { kind: 'primitive', scalar: 'string' }
          : { kind: 'primitive' },
    ...(scalar === 'number' ? { serializerName: 'number' } : {}),
  });
  const linksTo = (name: ClinicalType): FieldDefinition => ({
    type: 'linksTo',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: ref(name),
    nativeCodec: { kind: 'compound', resourceType: 'card' },
  });
  const linksToMany = (name: ClinicalType, query?: Query): FieldDefinition => ({
    type: 'linksToMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: ref(name),
    nativeCodec: { kind: 'compound', resourceType: 'card' },
    ...(query ? { query } : {}),
  });
  const definition = (
    name: ClinicalType,
    fieldDefs: Definition['fieldDefs'],
    materialized = false,
  ): Definition => ({
    type: 'card-def',
    codeRef: ref(name),
    displayName: name,
    fields: Object.fromEntries(Object.keys(fieldDefs).map((f) => [f, f])),
    fieldDefs,
    nativeCodec: { kind: 'compound', resourceType: 'card' },
    ...(materialized
      ? {
          nativeIndex: {
            types: [ref(name)],
            displayNames: [name],
            cardType: name,
            materialized: true,
          },
        }
      : {}),
  });
  const s = primitive('string'),
    n = primitive('number'),
    b = { ...primitive('boolean'), isComputed: true };
  const computed = (base: FieldDefinition): FieldDefinition => ({
    ...base,
    isComputed: true,
  });
  return new Map<string, Definition>([
    [
      'Principal',
      definition('Principal', {
        partyId: s,
        displayName: s,
        role: s,
        department: s,
        members: linksToMany('Principal'),
      }),
    ],
    [
      'PatientRecord',
      definition('PatientRecord', {
        patientId: s,
        name: s,
        ward: s,
        status: s,
        severity: s,
        admittedOn: s,
        attending: linksTo('Principal'),
        careTeam: linksTo('Principal'),
      }),
    ],
    [
      'VitalsReading',
      definition('VitalsReading', {
        patientId: s,
        date: s,
        takenAt: s,
        recordedBy: s,
        note: s,
        heartRate: n,
        systolic: n,
        spo2: n,
        tempC: n,
        critical: b,
      }),
    ],
    [
      'DoseEvent',
      definition('DoseEvent', {
        patientId: s,
        date: s,
        medication: s,
        dueAt: s,
        status: s,
      }),
    ],
    [
      'ShiftNote',
      definition('ShiftNote', {
        patientId: s,
        date: s,
        author: s,
        category: s,
        status: s,
        version: n,
      }),
    ],
    [
      'PatientDaySummary',
      definition(
        'PatientDaySummary',
        {
          patientId: s,
          date: s,
          patients: linksToMany('PatientRecord'),
          vitals: linksToMany('VitalsReading'),
          doses: linksToMany('DoseEvent'),
          notes: linksToMany('ShiftNote'),
          ward: computed(s),
          patientName: computed(s),
          attendingName: computed(s),
          admitted: b,
          vitalsCount: computed(n),
          criticalCount: computed(n),
          lastHeartRate: computed(n),
          dosesDue: computed(n),
          dosesGiven: computed(n),
          dosesHeld: computed(n),
          marComplete: b,
          latestNoteVersion: computed(n),
          noteSigned: b,
          rowStatus: computed(s),
        },
        true,
      ),
    ],
    [
      'WardBoard',
      definition(
        'WardBoard',
        {
          ward: s,
          date: s,
          census: linksToMany('PatientRecord'),
          days: linksToMany('PatientDaySummary'),
          censusCount: computed(n),
          highSeverity: computed(n),
          criticalPatients: computed(n),
          dueDoses: computed(n),
          unsignedNotes: computed(n),
          rowLines: { ...computed(s), type: 'containsMany' },
        },
        true,
      ),
    ],
    [
      'FacilityCensus',
      definition(
        'FacilityCensus',
        {
          date: s,
          boards: linksToMany('WardBoard'),
          admittedTotal: computed(n),
          criticalTotal: computed(n),
          wardsNeedingSignatures: { ...computed(s), type: 'containsMany' },
        },
        true,
      ),
    ],
  ]);
}

// The watches an owner registers, with `$this` interpolation resolved from the
// oracle. Page bounds are carried through; they never narrow routing.
export function clinicalWatches(
  realmURL: string,
  records: ClinicalRecords,
  ownerPath: string,
): Array<{ fieldPath: string; query: Query }> {
  const ref = (name: ClinicalType) => clinicalModuleRef(realmURL, name);
  const doc = records.get(ownerPath)!;
  const own = { ...attrs(doc), ...expectedOwner(records, ownerPath) };
  switch (typeOf(doc)) {
    case 'PatientDaySummary':
      return [
        {
          fieldPath: 'patients',
          query: {
            filter: {
              on: ref('PatientRecord'),
              eq: { patientId: own.patientId },
            },
            page: { size: 5 },
          },
        },
        {
          fieldPath: 'vitals',
          query: {
            filter: {
              on: ref('VitalsReading'),
              eq: { patientId: own.patientId, date: own.date },
            },
            page: { size: 8 },
          },
        },
        {
          fieldPath: 'doses',
          query: {
            filter: {
              on: ref('DoseEvent'),
              eq: { patientId: own.patientId, date: own.date },
            },
            page: { size: 20 },
          },
        },
        {
          fieldPath: 'notes',
          query: {
            filter: {
              on: ref('ShiftNote'),
              eq: { patientId: own.patientId, date: own.date },
            },
            page: { size: 20 },
          },
        },
      ];
    case 'WardBoard':
      return [
        {
          fieldPath: 'census',
          query: {
            filter: {
              on: ref('PatientRecord'),
              eq: { ward: own.ward, status: 'admitted' },
            },
            page: { size: 50 },
          },
        },
        {
          fieldPath: 'days',
          query: {
            filter: {
              on: ref('PatientDaySummary'),
              eq: { ward: own.ward, date: own.date },
            },
            page: { size: 50 },
          },
        },
      ];
    case 'FacilityCensus':
      return [
        {
          fieldPath: 'boards',
          query: {
            filter: { on: ref('WardBoard'), eq: { date: own.date } },
            page: { size: 20 },
          },
        },
      ];
    default:
      throw new Error(`${ownerPath} is not a Lattice owner`);
  }
}

// Cards an owner reads through a projected link rather than a query. The
// registry's watches cover query membership; these are the concrete
// dependencies the index writer records, so a change to one of them must
// invalidate the owner even though no membership changes.
export function clinicalDependencies(
  records: ClinicalRecords,
  ownerPath: string,
): string[] {
  const doc = records.get(ownerPath)!;
  if (typeOf(doc) !== 'PatientDaySummary') return [];
  const owner = attrs(doc);
  return ofType(records, 'PatientRecord')
    .filter(([, patient]) => attrs(patient).patientId === owner.patientId)
    .flatMap(([, patient]) => {
      const attending = linkTarget(patient, 'attending');
      return attending ? [attending] : [];
    });
}

// The search document the indexer would persist for a card: authored and
// computed attributes, links reduced to `{ id }`.
export function clinicalSearchDoc(
  realmURL: string,
  records: ClinicalRecords,
  path: string,
): Record<string, unknown> {
  const doc = records.get(path)!;
  const searchDoc: Record<string, unknown> = {
    id: realmURL + path.replace(/\.json$/, ''),
    ...expectedAttributes(records, path),
  };
  for (const [name, value] of Object.entries(doc.data.relationships ?? {})) {
    if (!value.links.self) continue;
    const id = realmURL + value.links.self.replace(/^\.\.\//, '');
    const [field, index] = name.split('.');
    if (index === undefined) searchDoc[field] = { id };
    else ((searchDoc[field] ??= []) as unknown[])[Number(index)] = { id };
  }
  return searchDoc;
}

export function clinicalTypeOf(
  records: ClinicalRecords,
  path: string,
): ClinicalType {
  return typeOf(records.get(path)!);
}
