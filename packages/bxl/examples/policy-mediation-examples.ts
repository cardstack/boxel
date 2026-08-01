import {
  assertValidBxlProfile,
  compileBxl,
  prepareBxl,
  type BxlProfile,
  type PreparedBxl,
} from '../src/index.js';

export type PolicyOperation =
  | 'read'
  | 'search'
  | 'write'
  | 'command'
  | 'projection';

export type ExecutionStrategy = 'on-demand' | 'materialized';
export type PolicyDecision = 'allow' | 'deny';
export type TraceStatus = 'allow' | 'deny' | 'info';

export interface PolicySubject {
  id: string;
  label: string;
  kind: 'anonymous' | 'user' | 'service';
  userId: string | null;
  groups: string[];
  roles: string[];
  memberships: Array<{ realm: string; seats: string[] }>;
}

export interface StudentRecord {
  type: 'student-record';
  id: string;
  generation: number;
  attributes: {
    ownerUserId: string;
    fullName: string;
    preferredName: string;
    email: string;
    dateOfBirth: string;
    program: 'Physics' | 'History' | 'Biology' | 'Studio Art';
    year: number;
    directoryOptIn: boolean;
    publicListing: boolean;
    advisorId: string;
    advisorNotes: string;
    accommodations: string;
    financialHold: boolean;
    courses: Array<{ code: string; credits: number; grade: string }>;
    displayName: string;
    completedCredits: number;
    academicStanding: 'good-standing' | 'administrative-review';
  };
}

export interface PolicyDataDiff {
  representativeId: string;
  sourceToCanonical: {
    computedFields: string[];
  };
  canonicalToMediated: {
    removedFields: string[];
    addedFields: string[];
    changedFields: string[];
  };
  rows: {
    stored: number;
    canonical: number;
    mediated: number;
    filtered: number;
    excludedIds: string[];
    mediatedIds: string[];
  };
}

export interface PolicyScenario {
  id: string;
  title: string;
  description: string;
  subjectId: keyof typeof policySubjects;
  operation: PolicyOperation;
  recordId?: string;
  query?: string;
  changed?: string[];
  proposed?: Record<string, unknown>;
  command?: string;
  args?: Record<string, unknown>;
  defaultStrategy: ExecutionStrategy;
  expectedDecision: PolicyDecision;
}

export interface PolicyTraceStep {
  name: string;
  status: TraceStatus;
  detail: string;
  durationMs: number;
}

export interface ExecutedProgram {
  slot: 'grant' | 'where' | 'view' | 'authorize';
  profile: BxlProfile;
  source: string;
  compiledSource: string;
}

export interface PrivateFacetBucket {
  value: string;
  rawCount: number;
  count: number | null;
  status: 'visible' | 'suppressed-small-cell' | 'suppressed-complement';
}

export interface AggregatePrivacyResult {
  minimumCohort: number;
  rawTotal: number;
  safeTotal: number | null;
  totalStatus: 'visible-rounded' | 'suppressed';
  facets: PrivateFacetBucket[];
}

export interface PolicyRunResult {
  scenario: PolicyScenario;
  subject: PolicySubject;
  operation: PolicyOperation;
  decision: PolicyDecision;
  reason: string;
  audience: string;
  strategy: ExecutionStrategy;
  cacheHit: boolean | null;
  policyHash: string;
  output?: unknown;
  source?: unknown;
  sourceDocument?: unknown;
  dataDiff?: PolicyDataDiff;
  redactedFields: string[];
  privacy?: AggregatePrivacyResult;
  trace: PolicyTraceStep[];
  programs: ExecutedProgram[];
  durationMs: number;
}

interface AudienceDefinition {
  id: string;
  label: string;
  priority: number;
  group: string;
  grant: string;
  where: string;
  view: string;
  writeAuthorize: string;
  commandAuthorize: string;
}

interface PreparedAudience extends AudienceDefinition {
  prepared: {
    grant: PreparedBxl;
    where: PreparedBxl;
    view: PreparedBxl;
    writeAuthorize: PreparedBxl;
    commandAuthorize: PreparedBxl;
  };
}

const DIRECTORY_REALM = 'https://example.edu/directory/';
const STUDENT_REALM = 'https://example.edu/students/';
const STAFF_REALM = 'https://example.edu/staff/';
const POLICY_HASH = 'student-records-policy:v7:8d4f2a1';
const MINIMUM_COHORT = 3;
const COUNT_ROUNDING = 5;

const publicView = `
  .record.attributes.completedCredits as $credits
  | {
      type: "directory-student",
      id: .record.id,
      attributes: {
        displayName: (.record.attributes.preferredName // .record.attributes.fullName),
        program: .record.attributes.program,
        year: .record.attributes.year,
        creditBand: (
          if $credits < 30 then "0-29"
          elif $credits < 60 then "30-59"
          elif $credits < 90 then "60-89"
          else "90+"
          end
        )
      }
    }
`.trim();

const studentView = `
  {
    type: "directory-student",
    id: .record.id,
    attributes: {
      displayName: (.record.attributes.preferredName // .record.attributes.fullName),
      email: .record.attributes.email,
      program: .record.attributes.program,
      year: .record.attributes.year,
      completedCredits: .record.attributes.completedCredits
    }
  }
`.trim();

const facultyView = `
  {
    type: "faculty-student-view",
    id: .record.id,
    attributes: {
      fullName: .record.attributes.fullName,
      preferredName: .record.attributes.preferredName,
      email: .record.attributes.email,
      program: .record.attributes.program,
      year: .record.attributes.year,
      advisorId: .record.attributes.advisorId,
      advisorNotes: .record.attributes.advisorNotes,
      courses: [.record.attributes.courses[] | {code, credits, grade}]
    }
  }
`.trim();

const audiences: AudienceDefinition[] = [
  {
    id: 'registrar-full',
    label: 'Registrar · canonical record',
    priority: 100,
    group: 'registrar',
    grant: '.subject.groups | any(. == "registrar")',
    where: 'true',
    view: '.record',
    writeAuthorize: 'true',
    commandAuthorize: 'true',
  },
  {
    id: 'directory-service',
    label: 'Directory projection service',
    priority: 90,
    group: 'directory-service',
    grant: '.subject.groups | any(. == "directory-service")',
    where: '.attributes.publicListing == true',
    view: publicView,
    writeAuthorize: 'false',
    commandAuthorize: 'false',
  },
  {
    id: 'faculty-advising',
    label: 'Faculty · advising view',
    priority: 60,
    group: 'faculty',
    grant: '.subject.groups | any(. == "faculty")',
    where: 'true',
    view: facultyView,
    writeAuthorize:
      '.record.attributes.advisorId == .subject.userId and (.changed | all(. == "advisorNotes"))',
    commandAuthorize:
      '.command == "record-advising-note" and .record.attributes.advisorId == .subject.userId',
  },
  {
    id: 'student-directory',
    label: 'Student · member directory',
    priority: 30,
    group: 'student',
    grant: '.subject.groups | any(. == "student")',
    where: '.attributes.directoryOptIn == true',
    view: studentView,
    writeAuthorize:
      '.record.attributes.ownerUserId == .subject.userId and (.changed | all(. == "preferredName" or . == "directoryOptIn"))',
    commandAuthorize:
      '.command == "update-directory-preferences" and .record.attributes.ownerUserId == .subject.userId and .args.studentId == .record.id',
  },
  {
    id: 'public-directory',
    label: 'Public guest · coarse directory',
    priority: 10,
    group: 'public',
    grant: '.subject.groups | any(. == "public")',
    where: '.attributes.publicListing == true',
    view: publicView,
    writeAuthorize: 'false',
    commandAuthorize: 'false',
  },
];

export const policySubjects = {
  anonymous: {
    id: 'anonymous',
    label: 'Anonymous guest',
    kind: 'anonymous',
    userId: null,
    groups: ['public', 'guest'],
    roles: [],
    memberships: [],
  },
  alice: {
    id: 'alice',
    label: 'Alice · student member',
    kind: 'user',
    userId: '@alice:example.edu',
    groups: ['public', 'student'],
    roles: ['student'],
    memberships: [{ realm: STUDENT_REALM, seats: ['student'] }],
  },
  ben: {
    id: 'ben',
    label: 'Ben · student member',
    kind: 'user',
    userId: '@ben:example.edu',
    groups: ['public', 'student'],
    roles: ['student'],
    memberships: [{ realm: STUDENT_REALM, seats: ['student'] }],
  },
  professor: {
    id: 'professor',
    label: 'Prof. Rivera · faculty',
    kind: 'user',
    userId: '@rivera:example.edu',
    groups: ['public', 'faculty'],
    roles: ['faculty', 'advisor'],
    memberships: [{ realm: STAFF_REALM, seats: ['faculty', 'advisor'] }],
  },
  registrar: {
    id: 'registrar',
    label: 'Morgan · registrar',
    kind: 'user',
    userId: '@registrar:example.edu',
    groups: ['public', 'faculty', 'registrar'],
    roles: ['registrar'],
    memberships: [{ realm: STAFF_REALM, seats: ['registrar'] }],
  },
  projectionService: {
    id: 'projectionService',
    label: 'Directory projection worker',
    kind: 'service',
    userId: '@directory-service:example.edu',
    groups: ['directory-service'],
    roles: ['projection-worker'],
    memberships: [{ realm: DIRECTORY_REALM, seats: ['writer'] }],
  },
} as const satisfies Record<string, PolicySubject>;

function record(
  id: string,
  fullName: string,
  preferredName: string,
  program: StudentRecord['attributes']['program'],
  year: number,
  ownerUserId: string,
  opts: {
    publicListing: boolean;
    directoryOptIn: boolean;
    credits: number[];
    advisorId?: string;
    financialHold?: boolean;
  },
): StudentRecord {
  const completedCredits = opts.credits.reduce((total, credits) => total + credits, 0);
  const financialHold = opts.financialHold ?? false;
  return {
    type: 'student-record',
    id,
    generation: 41 + Number(id.replace(/\D/g, '')),
    attributes: {
      ownerUserId,
      fullName,
      preferredName,
      email: `${preferredName.toLowerCase().replace(/\s/g, '.')}@example.edu`,
      dateOfBirth: `200${year}-0${(year % 8) + 1}-14`,
      program,
      year,
      directoryOptIn: opts.directoryOptIn,
      publicListing: opts.publicListing,
      advisorId: opts.advisorId ?? '@rivera:example.edu',
      advisorNotes: `${preferredName} is making steady progress; discuss next-term research placement.`,
      accommodations: year % 2 === 0 ? 'Extended exam time' : 'None recorded',
      financialHold,
      courses: opts.credits.map((credits, index) => ({
        code: `${program.slice(0, 3).toUpperCase()}-${110 + index * 20}`,
        credits,
        grade: ['A', 'B+', 'A-', 'B'][index % 4],
      })),
      displayName: preferredName || fullName,
      completedCredits,
      academicStanding: financialHold ? 'administrative-review' : 'good-standing',
    },
  };
}

export const studentRecords: StudentRecord[] = [
  record('student-01', 'Alice Ng', 'Alice', 'Physics', 2, '@alice:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [4, 4, 3, 4],
  }),
  record('student-02', 'Benjamin Ortiz', 'Ben', 'History', 3, '@ben:example.edu', {
    publicListing: false,
    directoryOptIn: true,
    credits: [3, 3, 4, 3, 3],
    financialHold: true,
  }),
  record('student-03', 'Cora Mensah', 'Cora', 'Biology', 1, '@cora:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [4, 3, 4],
  }),
  record('student-04', 'Diego Santos', 'Diego', 'Studio Art', 4, '@diego:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [3, 3, 3, 4, 4, 3],
  }),
  record('student-05', 'Elena Petrova', 'Elena', 'Physics', 3, '@elena:example.edu', {
    publicListing: false,
    directoryOptIn: false,
    credits: [4, 4, 4, 3, 4],
  }),
  record('student-06', 'Farah Khan', 'Farah', 'History', 2, '@farah:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [3, 4, 3, 3],
  }),
  record('student-07', 'Grace Liu', 'Grace', 'Biology', 4, '@grace:example.edu', {
    publicListing: false,
    directoryOptIn: true,
    credits: [4, 4, 3, 4, 3, 4],
  }),
  record('student-08', 'Hassan Ali', 'Hassan', 'Studio Art', 1, '@hassan:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [3, 3, 4],
  }),
  record('student-09', 'Inez Martin', 'Inez', 'Physics', 4, '@inez:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [4, 4, 4, 4, 3, 3],
  }),
  record('student-10', 'Jon Bell', 'Jon', 'History', 1, '@jon:example.edu', {
    publicListing: false,
    directoryOptIn: false,
    credits: [3, 3, 3],
  }),
  record('student-11', 'Kira Davis', 'Kira', 'Biology', 2, '@kira:example.edu', {
    publicListing: true,
    directoryOptIn: true,
    credits: [4, 3, 4, 4],
  }),
  record('student-12', 'Luis Romero', 'Luis', 'Studio Art', 3, '@luis:example.edu', {
    publicListing: false,
    directoryOptIn: true,
    credits: [3, 4, 3, 3, 4],
  }),
];

export const policyScenarios: PolicyScenario[] = [
  {
    id: 'anonymous-public-search',
    title: 'Guest searches the public directory',
    description: 'Publicly listed students are transformed to a coarse view; small facet cells and exact totals are protected.',
    subjectId: 'anonymous',
    operation: 'search',
    query: '',
    defaultStrategy: 'materialized',
    expectedDecision: 'allow',
  },
  {
    id: 'anonymous-public-card',
    title: 'Guest opens a public student card',
    description: 'The response keeps name, program, year, and a credit band while removing contact, birth, advising, accommodation, and financial data.',
    subjectId: 'anonymous',
    operation: 'read',
    recordId: 'student-01',
    defaultStrategy: 'materialized',
    expectedDecision: 'allow',
  },
  {
    id: 'anonymous-private-card',
    title: 'Guest requests a non-public student',
    description: 'The row predicate denies existence before the view transform runs.',
    subjectId: 'anonymous',
    operation: 'read',
    recordId: 'student-02',
    defaultStrategy: 'on-demand',
    expectedDecision: 'deny',
  },
  {
    id: 'student-member-search',
    title: 'Student searches the member directory',
    description: 'A shared student audience key exposes opted-in email and exact completed credits, but no administrative fields.',
    subjectId: 'alice',
    operation: 'search',
    query: 'physics',
    defaultStrategy: 'materialized',
    expectedDecision: 'allow',
  },
  {
    id: 'faculty-advising-card',
    title: 'Faculty opens an advising view',
    description: 'The faculty view includes course progress and advisor notes while removing accommodations, date of birth, and financial hold.',
    subjectId: 'professor',
    operation: 'read',
    recordId: 'student-02',
    defaultStrategy: 'materialized',
    expectedDecision: 'allow',
  },
  {
    id: 'registrar-canonical-card',
    title: 'Registrar opens the canonical record',
    description: 'The high-priority registrar audience receives the identity view and remains an intentionally rare on-demand request.',
    subjectId: 'registrar',
    operation: 'read',
    recordId: 'student-02',
    defaultStrategy: 'on-demand',
    expectedDecision: 'allow',
  },
  {
    id: 'student-own-preferences-write',
    title: 'Student updates their directory preferences',
    description: 'The same student group used for reads may update only preferredName and directoryOptIn on its own record.',
    subjectId: 'alice',
    operation: 'write',
    recordId: 'student-01',
    changed: ['preferredName', 'directoryOptIn'],
    proposed: { preferredName: 'Ali', directoryOptIn: true },
    defaultStrategy: 'on-demand',
    expectedDecision: 'allow',
  },
  {
    id: 'student-sensitive-write',
    title: 'Student attempts to clear a financial hold',
    description: 'The write authorization fails because financialHold is outside the student field allowlist.',
    subjectId: 'alice',
    operation: 'write',
    recordId: 'student-01',
    changed: ['financialHold'],
    proposed: { financialHold: false },
    defaultStrategy: 'on-demand',
    expectedDecision: 'deny',
  },
  {
    id: 'faculty-advising-write',
    title: 'Advisor records a note',
    description: 'Faculty may update advisorNotes only for a record assigned to them.',
    subjectId: 'professor',
    operation: 'write',
    recordId: 'student-03',
    changed: ['advisorNotes'],
    proposed: { advisorNotes: 'Approved for the summer field program.' },
    defaultStrategy: 'on-demand',
    expectedDecision: 'allow',
  },
  {
    id: 'student-own-command',
    title: 'Student calls the preference command',
    description: 'The named command and arguments are authorized against the same subject and record facts.',
    subjectId: 'alice',
    operation: 'command',
    recordId: 'student-01',
    command: 'update-directory-preferences',
    args: { studentId: 'student-01', directoryOptIn: false },
    defaultStrategy: 'on-demand',
    expectedDecision: 'allow',
  },
  {
    id: 'student-cross-record-command',
    title: 'Student targets another student’s preferences',
    description: 'The command is denied before its host implementation can run.',
    subjectId: 'alice',
    operation: 'command',
    recordId: 'student-02',
    command: 'update-directory-preferences',
    args: { studentId: 'student-02', directoryOptIn: false },
    defaultStrategy: 'on-demand',
    expectedDecision: 'deny',
  },
  {
    id: 'directory-projection',
    title: 'Projection worker refreshes the directory realm',
    description: 'The public view runs row by row and emits deterministic cards for the lower-privilege directory realm.',
    subjectId: 'projectionService',
    operation: 'projection',
    defaultStrategy: 'on-demand',
    expectedDecision: 'allow',
  },
];

const runtimeLimits = {
  maxSteps: 25_000,
  maxMillis: 25,
  maxOutputs: 1,
  maxOutputBytes: 256 * 1024,
};

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJsonApiResource(record: StudentRecord) {
  return {
    type: record.type,
    id: record.id,
    attributes: cloneJson(record.attributes),
    links: {
      self: `${STUDENT_REALM}${record.id}.json`,
    },
    meta: {
      realmURL: STUDENT_REALM,
      generation: record.generation,
    },
  };
}

function storedSourceDocument(record: StudentRecord) {
  const {
    displayName: _displayName,
    completedCredits: _completedCredits,
    academicStanding: _academicStanding,
    ...storedAttributes
  } = record.attributes;
  return {
    jsonapi: { version: '1.1' },
    links: {
      self: `${STUDENT_REALM}${record.id}.json`,
    },
    data: {
      type: record.type,
      id: record.id,
      attributes: cloneJson(storedAttributes),
      meta: {
        adoptsFrom: {
          module: `${STUDENT_REALM}student-record`,
          name: 'StudentRecord',
        },
      },
    },
  };
}

function attributeChanges(source: StudentRecord, output: unknown) {
  const mediated = outputAttributes(output) ?? {};
  const canonical = source.attributes as Record<string, unknown>;
  return {
    removedFields: Object.keys(canonical).filter((field) => !(field in mediated)),
    addedFields: Object.keys(mediated).filter((field) => !(field in canonical)),
    changedFields: Object.keys(mediated).filter(
      (field) => field in canonical && JSON.stringify(mediated[field]) !== JSON.stringify(canonical[field]),
    ),
  };
}

function prepareProgram(source: string, profile: BxlProfile): PreparedBxl {
  const ast = compileBxl(source, {
    target: 'ast',
    profile,
    readableSyntax: false,
  });
  assertValidBxlProfile(ast, { profile });
  return prepareBxl(source, { readableSyntax: false, runtimeLimits });
}

function evaluateOne(prepared: PreparedBxl, input: unknown): unknown {
  const result = prepared.evaluate(input, { runtimeLimits });
  if (result.outputs.length !== 1) {
    throw new Error(`Policy program must emit exactly one value; received ${result.outputs.length}`);
  }
  return result.value;
}

function roundCount(count: number): number {
  return Math.max(COUNT_ROUNDING, Math.round(count / COUNT_ROUNDING) * COUNT_ROUNDING);
}

function protectAggregates(records: StudentRecord[]): AggregatePrivacyResult {
  const counts = new Map<string, number>();
  for (const item of records) {
    const program = item.attributes.program;
    counts.set(program, (counts.get(program) ?? 0) + 1);
  }

  const facets: PrivateFacetBucket[] = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, rawCount]) => rawCount < MINIMUM_COHORT
      ? { value, rawCount, count: null, status: 'suppressed-small-cell' as const }
      : { value, rawCount, count: roundCount(rawCount), status: 'visible' as const });

  if (facets.some((facet) => facet.status === 'suppressed-small-cell')) {
    const visible = facets
      .filter((facet) => facet.status === 'visible')
      .sort((left, right) => left.rawCount - right.rawCount || left.value.localeCompare(right.value));
    const complement = visible[0];
    if (complement) {
      complement.count = null;
      complement.status = 'suppressed-complement';
    }
  }

  return {
    minimumCohort: MINIMUM_COHORT,
    rawTotal: records.length,
    safeTotal: records.length < MINIMUM_COHORT ? null : roundCount(records.length),
    totalStatus: records.length < MINIMUM_COHORT ? 'suppressed' : 'visible-rounded',
    facets,
  };
}

function recordById(id: string | undefined): StudentRecord | undefined {
  return studentRecords.find((item) => item.id === id);
}

function outputAttributes(output: unknown): Record<string, unknown> | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const attributes = (output as { attributes?: unknown }).attributes;
  return attributes && typeof attributes === 'object' && !Array.isArray(attributes)
    ? attributes as Record<string, unknown>
    : undefined;
}

function redactedFields(source: StudentRecord | undefined, output: unknown): string[] {
  if (!source) return [];
  const attributes = outputAttributes(output);
  if (!attributes) return [];
  return Object.keys(source.attributes).filter((field) => !(field in attributes));
}

function programResult(
  slot: ExecutedProgram['slot'],
  profile: BxlProfile,
  source: string,
  prepared: PreparedBxl,
): ExecutedProgram {
  return { slot, profile, source, compiledSource: prepared.compiledSource };
}

export class PolicyMediationRuntime {
  readonly policyHash = POLICY_HASH;
  readonly audiences: PreparedAudience[];
  readonly cache = new Map<string, unknown>();

  constructor() {
    this.audiences = audiences.map((audience) => ({
      ...audience,
      prepared: {
        grant: prepareProgram(audience.grant, 'policy'),
        where: prepareProgram(audience.where, 'predicate'),
        view: prepareProgram(audience.view, 'derive'),
        writeAuthorize: prepareProgram(audience.writeAuthorize, 'policy'),
        commandAuthorize: prepareProgram(audience.commandAuthorize, 'policy'),
      },
    }));
  }

  clearMaterializedViews(): void {
    this.cache.clear();
  }

  materializeCommonViews(): number {
    let written = 0;
    for (const audienceId of ['public-directory', 'student-directory', 'faculty-advising']) {
      const audience = this.audiences.find((candidate) => candidate.id === audienceId)!;
      for (const item of studentRecords) {
        if (evaluateOne(audience.prepared.where, item) !== true) continue;
        const key = this.cacheKey(audience, item);
        this.cache.set(key, evaluateOne(audience.prepared.view, { record: item }));
        written++;
      }
    }
    return written;
  }

  runScenario(
    scenario: PolicyScenario,
    strategy: ExecutionStrategy = scenario.defaultStrategy,
  ): PolicyRunResult {
    const started = now();
    const trace: PolicyTraceStep[] = [];
    const programs: ExecutedProgram[] = [];
    const subject = policySubjects[scenario.subjectId];
    const source = recordById(scenario.recordId);

    const step = (name: string, status: TraceStatus, detail: string, since: number) => {
      trace.push({ name, status, detail, durationMs: now() - since });
    };

    let stageStarted = now();
    step(
      'Resolve trusted subject',
      'info',
      `${subject.kind}; groups ${subject.groups.join(', ') || 'none'}; ${subject.memberships.length} trusted realm membership(s)`,
      stageStarted,
    );

    stageStarted = now();
    const audience = this.resolveAudience(subject);
    if (!audience) {
      step('Select audience', 'deny', 'No audience grant matched; policy defaults to deny.', stageStarted);
      return this.finish({ scenario, subject, strategy, trace, programs, started, audience: 'none', reason: 'no-audience', source });
    }
    const grant = evaluateOne(audience.prepared.grant, { subject });
    programs.push(programResult('grant', 'policy', audience.grant, audience.prepared.grant));
    if (grant !== true) {
      step('Select audience', 'deny', `${audience.id} grant did not return true.`, stageStarted);
      return this.finish({ scenario, subject, strategy, trace, programs, started, audience: audience.id, reason: 'grant-denied', source });
    }
    step('Select audience', 'allow', `${audience.label} (priority ${audience.priority})`, stageStarted);

    if (scenario.operation === 'read') {
      return this.runRead({ scenario, subject, audience, source, strategy, trace, programs, started, step });
    }
    if (scenario.operation === 'search') {
      return this.runSearch({ scenario, subject, audience, strategy, trace, programs, started, step });
    }
    if (scenario.operation === 'write') {
      return this.runWrite({ scenario, subject, audience, source, strategy, trace, programs, started, step });
    }
    if (scenario.operation === 'command') {
      return this.runCommand({ scenario, subject, audience, source, strategy, trace, programs, started, step });
    }
    return this.runProjection({ scenario, subject, audience, strategy, trace, programs, started, step });
  }

  private resolveAudience(subject: PolicySubject): PreparedAudience | undefined {
    return this.audiences
      .filter((audience) => subject.groups.includes(audience.group))
      .sort((left, right) => right.priority - left.priority)[0];
  }

  private cacheKey(audience: PreparedAudience, item: StudentRecord): string {
    return [POLICY_HASH, audience.id, audience.view, item.id, item.generation].join(':');
  }

  private viewRecord(
    audience: PreparedAudience,
    item: StudentRecord,
    strategy: ExecutionStrategy,
  ): { output: unknown; cacheHit: boolean } {
    const key = this.cacheKey(audience, item);
    if (strategy === 'materialized' && this.cache.has(key)) {
      return { output: cloneJson(this.cache.get(key)), cacheHit: true };
    }
    const output = evaluateOne(audience.prepared.view, { record: item });
    if (strategy === 'materialized') this.cache.set(key, cloneJson(output));
    return { output, cacheHit: false };
  }

  private runRead(args: any): PolicyRunResult {
    const { scenario, subject, audience, source, strategy, trace, programs, started, step } = args;
    let stageStarted = now();
    if (!source) {
      step('Load canonical row', 'deny', 'The requested student record does not exist.', stageStarted);
      return this.finish({ scenario, subject, strategy, trace, programs, started, audience: audience.id, reason: 'not-found', source });
    }
    step('Load canonical row', 'info', `${source.id} at generation ${source.generation}`, stageStarted);

    stageStarted = now();
    const visible = evaluateOne(audience.prepared.where, source);
    programs.push(programResult('where', 'predicate', audience.where, audience.prepared.where));
    if (visible !== true) {
      step('Apply row predicate', 'deny', 'Record is outside the selected audience before rendering.', stageStarted);
      return this.finish({ scenario, subject, strategy, trace, programs, started, audience: audience.id, reason: 'row-hidden', source });
    }
    step('Apply row predicate', 'allow', 'Record is a member of the audience-safe corpus.', stageStarted);

    stageStarted = now();
    const viewed = this.viewRecord(audience, source, strategy);
    programs.push(programResult('view', 'derive', audience.view, audience.prepared.view));
    step(
      'Produce mediated JSON',
      'allow',
      viewed.cacheHit ? 'Audience-keyed materialized view hit.' : 'Prepared jq transformed the canonical row on demand.',
      stageStarted,
    );

    return {
      scenario,
      subject,
      operation: scenario.operation,
      decision: 'allow',
      reason: 'mediated-view',
      audience: audience.id,
      strategy,
      cacheHit: viewed.cacheHit,
      policyHash: POLICY_HASH,
      output: viewed.output,
      source,
      redactedFields: redactedFields(source, viewed.output),
      trace,
      programs,
      durationMs: now() - started,
    };
  }

  private runSearch(args: any): PolicyRunResult {
    const { scenario, subject, audience, strategy, trace, programs, started, step } = args;
    let stageStarted = now();
    const eligible = studentRecords.filter((item) => evaluateOne(audience.prepared.where, item) === true);
    programs.push(programResult('where', 'predicate', audience.where, audience.prepared.where));
    step('Push row predicate before pagination', 'allow', `${eligible.length}/${studentRecords.length} rows entered the audience-safe corpus.`, stageStarted);

    stageStarted = now();
    const query = (scenario.query ?? '').trim().toLowerCase();
    const matched = query
      ? eligible.filter((item) => [item.attributes.fullName, item.attributes.preferredName, item.attributes.program]
          .some((value) => value.toLowerCase().includes(query)))
      : eligible;
    step('Search safe corpus', 'info', query ? `${matched.length} rows matched “${query}”.` : `${matched.length} rows matched the unfiltered query.`, stageStarted);

    stageStarted = now();
    const privacy = protectAggregates(matched);
    const suppressed = privacy.facets.filter((facet) => facet.status !== 'visible').length;
    step('Protect counts and facets', 'allow', `k=${privacy.minimumCohort}; ${suppressed} facet bucket(s) suppressed; total ${privacy.totalStatus}.`, stageStarted);

    stageStarted = now();
    let everyCacheHit = strategy === 'materialized';
    const output = matched.map((item) => {
      const viewed = this.viewRecord(audience, item, strategy);
      everyCacheHit &&= viewed.cacheHit;
      return viewed.output;
    });
    programs.push(programResult('view', 'derive', audience.view, audience.prepared.view));
    step('Build bounded search page', 'allow', `${output.length} mediated item(s); ${strategy}${strategy === 'materialized' ? everyCacheHit ? ' cache hit' : ' cache fill' : ''}.`, stageStarted);

    return {
      scenario,
      subject,
      operation: scenario.operation,
      decision: 'allow',
      reason: 'mediated-search',
      audience: audience.id,
      strategy,
      cacheHit: strategy === 'materialized' ? everyCacheHit : false,
      policyHash: POLICY_HASH,
      output: { data: output, meta: { page: { total: privacy.safeTotal, totalStatus: privacy.totalStatus }, facets: privacy.facets.map(({ rawCount: _rawCount, ...facet }) => facet) } },
      source: { query: scenario.query ?? '', canonicalRows: matched },
      redactedFields: redactedFields(matched[0], output[0]),
      privacy,
      trace,
      programs,
      durationMs: now() - started,
    };
  }

  private runWrite(args: any): PolicyRunResult {
    const { scenario, subject, audience, source, strategy, trace, programs, started, step } = args;
    const stageStarted = now();
    if (!source) {
      step('Load canonical row', 'deny', 'The write target does not exist.', stageStarted);
      return this.finish({ scenario, subject, strategy, trace, programs, started, audience: audience.id, reason: 'not-found', source });
    }
    const envelope = { subject, record: source, changed: scenario.changed ?? [], proposed: { ...source.attributes, ...scenario.proposed } };
    const allowed = evaluateOne(audience.prepared.writeAuthorize, envelope) === true;
    programs.push(programResult('authorize', 'policy', audience.writeAuthorize, audience.prepared.writeAuthorize));
    step('Authorize mediated write', allowed ? 'allow' : 'deny', allowed
      ? `Allowed fields: ${(scenario.changed ?? []).join(', ')}. Host would continue to schema validation and an atomic write.`
      : `Changed fields ${(scenario.changed ?? []).join(', ')} are not allowed for ${audience.id}.`, stageStarted);
    return {
      scenario,
      subject,
      operation: scenario.operation,
      decision: allowed ? 'allow' : 'deny',
      reason: allowed ? 'write-authorized' : 'write-denied',
      audience: audience.id,
      strategy,
      cacheHit: null,
      policyHash: POLICY_HASH,
      output: allowed ? { type: source.type, id: source.id, attributes: envelope.proposed } : undefined,
      source: { current: source, proposed: envelope.proposed, changed: envelope.changed },
      redactedFields: [],
      trace,
      programs,
      durationMs: now() - started,
    };
  }

  private runCommand(args: any): PolicyRunResult {
    const { scenario, subject, audience, source, strategy, trace, programs, started, step } = args;
    const stageStarted = now();
    if (!source) {
      step('Load command target', 'deny', 'The command target does not exist.', stageStarted);
      return this.finish({ scenario, subject, strategy, trace, programs, started, audience: audience.id, reason: 'not-found', source });
    }
    const envelope = { subject, record: source, command: scenario.command, args: scenario.args ?? {} };
    const allowed = evaluateOne(audience.prepared.commandAuthorize, envelope) === true;
    programs.push(programResult('authorize', 'policy', audience.commandAuthorize, audience.prepared.commandAuthorize));
    step('Authorize named command', allowed ? 'allow' : 'deny', allowed
      ? 'Policy allows the host-owned command implementation to run; resulting mutations still pass write policy.'
      : 'Command or target is outside this audience grant; no command code runs.', stageStarted);
    return {
      scenario,
      subject,
      operation: scenario.operation,
      decision: allowed ? 'allow' : 'deny',
      reason: allowed ? 'command-authorized' : 'command-denied',
      audience: audience.id,
      strategy,
      cacheHit: null,
      policyHash: POLICY_HASH,
      output: allowed ? { accepted: true, command: scenario.command, args: scenario.args } : undefined,
      source: envelope,
      redactedFields: [],
      trace,
      programs,
      durationMs: now() - started,
    };
  }

  private runProjection(args: any): PolicyRunResult {
    const { scenario, subject, audience, strategy, trace, programs, started, step } = args;
    let stageStarted = now();
    const eligible = studentRecords.filter((item) => evaluateOne(audience.prepared.where, item) === true);
    programs.push(programResult('where', 'predicate', audience.where, audience.prepared.where));
    step('Scan projection membership', 'allow', `${eligible.length}/${studentRecords.length} source rows selected before transformation.`, stageStarted);

    stageStarted = now();
    const output = eligible.map((item) => this.viewRecord(audience, item, strategy).output);
    const representative = eligible[0];
    const representativeOutput = output[0];
    const changes = representative
      ? attributeChanges(representative, representativeOutput)
      : { removedFields: [], addedFields: [], changedFields: [] };
    programs.push(programResult('view', 'derive', audience.view, audience.prepared.view));
    step('Write projection batch', 'allow', `${output.length} deterministic directory card(s) ready for upsert; non-members become tombstones.`, stageStarted);
    return {
      scenario,
      subject,
      operation: scenario.operation,
      decision: 'allow',
      reason: 'projection-ready',
      audience: audience.id,
      strategy,
      cacheHit: false,
      policyHash: POLICY_HASH,
      output: {
        jsonapi: { version: '1.1' },
        links: {
          self: `${DIRECTORY_REALM}_search?filter[type]=directory-student`,
        },
        data: output,
        meta: {
          page: { total: output.length },
          projection: {
            sourceRealm: STUDENT_REALM,
            targetRealm: DIRECTORY_REALM,
            policy: POLICY_HASH,
            tombstoneCandidates: studentRecords.length - eligible.length,
          },
        },
      },
      source: {
        jsonapi: { version: '1.1' },
        links: {
          self: `${STUDENT_REALM}_search?filter[type]=student-record`,
        },
        meta: {
          page: { total: studentRecords.length },
        },
        data: studentRecords.map(canonicalJsonApiResource),
      },
      sourceDocument: representative ? storedSourceDocument(representative) : undefined,
      dataDiff: representative ? {
        representativeId: representative.id,
        sourceToCanonical: {
          computedFields: ['displayName', 'completedCredits', 'academicStanding'],
        },
        canonicalToMediated: {
          ...changes,
          changedFields: [
            ...(representative.type === (representativeOutput as { type?: unknown } | undefined)?.type ? [] : ['type']),
            ...changes.changedFields,
          ],
        },
        rows: {
          stored: studentRecords.length,
          canonical: studentRecords.length,
          mediated: output.length,
          filtered: studentRecords.length - eligible.length,
          excludedIds: studentRecords
            .filter((item) => !eligible.some((eligibleItem) => eligibleItem.id === item.id))
            .map((item) => item.id),
          mediatedIds: eligible.map((item) => item.id),
        },
      } : undefined,
      redactedFields: changes.removedFields,
      trace,
      programs,
      durationMs: now() - started,
    };
  }

  private finish(args: any): PolicyRunResult {
    return {
      scenario: args.scenario,
      subject: args.subject,
      operation: args.scenario.operation,
      decision: 'deny',
      reason: args.reason,
      audience: args.audience,
      strategy: args.strategy,
      cacheHit: null,
      policyHash: POLICY_HASH,
      source: args.source,
      redactedFields: [],
      trace: args.trace,
      programs: args.programs,
      durationMs: now() - args.started,
    };
  }
}

export function createPolicyMediationRuntime(): PolicyMediationRuntime {
  return new PolicyMediationRuntime();
}
