import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  OPENFGA_RECURSIVE_PORT_INFO,
  prepareAuthorizationModelSafe,
  prepareBoxelPolicySafe,
  type BxlAuthorizationModel,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
  type RelationshipTuple,
} from '../../src/index.js';

const model: BxlAuthorizationModel = {
  schema: 'bxl-authorization/1',
  types: {
    user: {},
    group: {
      relations: {
        member: ['user', 'group#member'],
      },
    },
    student_access: {
      relations: {
        provider: ['group#member'],
      },
      permissions: {
        view_student_classroom: 'userset("provider")',
      },
    },
  },
};

const tuples: RelationshipTuple[] = [
  // Provider A belongs to a team, the team belongs to Student A's provider group, and
  // that provider-group userset holds the student-scoped provider relation.
  { subject: 'user:provider-a', relation: 'member', object: 'group:related-services' },
  {
    subject: 'group:related-services#member',
    relation: 'member',
    object: 'group:student-a-providers',
  },
  {
    subject: 'group:student-a-providers#member',
    relation: 'provider',
    object: 'student_access:student-a',
  },

  { subject: 'user:provider-b', relation: 'member', object: 'group:student-b-providers' },
  {
    subject: 'group:student-b-providers#member',
    relation: 'provider',
    object: 'student_access:student-b',
  },

  // A deliberately cyclic userset proves visited-userset pruning terminates.
  { subject: 'group:cycle-b#member', relation: 'member', object: 'group:cycle-a' },
  { subject: 'group:cycle-a#member', relation: 'member', object: 'group:cycle-b' },
  {
    subject: 'group:cycle-a#member',
    relation: 'provider',
    object: 'student_access:cycle-classroom',
  },
];

const prepared = prepareAuthorizationModelSafe(model, tuples);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);

const check = (subject: string, object: string) =>
  prepared.value.check({
    subject,
    relation: 'view_student_classroom',
    object,
    trace: true,
  });

const providerAStudentA = check('user:provider-a', 'student_access:student-a');
strictEqual(providerAStudentA.ok, true);
if (!providerAStudentA.ok) throw new Error(providerAStudentA.error.message);
strictEqual(providerAStudentA.value.allowed, true);
strictEqual(providerAStudentA.value.metrics.maxDepth, 3);
const recursiveTrace = providerAStudentA.value.trace.filter(
  (event) => event.operation === 'openfga-recursive-userset',
);
deepStrictEqual(
  recursiveTrace.map((event) => `${event.object}#${event.relation}`),
  ['group:related-services#member', 'group:student-a-providers#member'],
);
strictEqual(
  recursiveTrace.every((event) =>
    event.detail?.includes('breadthFirstRecursiveMatch'),
  ),
  true,
);

const providerAStudentB = check('user:provider-a', 'student_access:student-b');
strictEqual(providerAStudentB.ok, true);
if (providerAStudentB.ok) strictEqual(providerAStudentB.value.allowed, false);

const providerBStudentB = check('user:provider-b', 'student_access:student-b');
strictEqual(providerBStudentB.ok, true);
if (providerBStudentB.ok) strictEqual(providerBStudentB.value.allowed, true);

const cyclic = check('user:nobody', 'student_access:cycle-classroom');
strictEqual(cyclic.ok, true);
if (!cyclic.ok) throw new Error(cyclic.error.message);
strictEqual(cyclic.value.allowed, false);
strictEqual(
  cyclic.value.trace.some((event) => event.detail?.includes('revisits pruned')),
  true,
);

const depthLimited = prepared.value.check({
  subject: 'user:provider-a',
  relation: 'view_student_classroom',
  object: 'student_access:student-a',
  limits: { maxDepth: 2 },
});
strictEqual(depthLimited.ok, false);
if (!depthLimited.ok) {
  strictEqual(depthLimited.error.kind, 'resolution-depth-exceeded');
}

strictEqual(
  OPENFGA_RECURSIVE_PORT_INFO.commit,
  '2c19e265fc73858fc0a5468fc517dc3bbf727e94',
);
deepStrictEqual(OPENFGA_RECURSIVE_PORT_INFO.upstreamFunctions, [
  'processUsersetMessage',
  'breadthFirstRecursiveMatch',
]);
strictEqual(OPENFGA_RECURSIVE_PORT_INFO.execution, 'synchronous-in-memory');

const boxelDocument: BoxelPolicyDocument = {
  schema: 'boxel-policy/2',
  scopes: [
    {
      name: 'StudentClassroomAccess',
      adoptsFrom: '../StudentClassroomAccess',
      seats: [{ name: 'Provider', from: 'Card.Provider' }],
      capabilities: [
        {
          name: 'ViewStudentClassroom',
          where: 'Seat.Provider',
        },
      ],
    },
  ],
};

const boxelSnapshot: BoxelPolicySnapshot = {
  cards: [
    {
      card: '../StudentAccess/student-a',
      adoptsFrom: '../StudentClassroomAccess',
      links: { provider: '../Group/student-a-providers' },
    },
  ],
  parties: [
    { party: '../Staff/provider-a' },
    { party: '../Group/related-services', members: ['../Staff/provider-a'] },
    {
      party: '../Group/student-a-providers',
      members: ['../Group/related-services'],
    },
  ],
};

strictEqual(
  boxelDocument.scopes[0]!.capabilities[0]!.where,
  'Seat.Provider',
  'the Boxel policy names the relationship without embedding traversal syntax',
);
const preparedBoxel = prepareBoxelPolicySafe(boxelDocument, boxelSnapshot);
strictEqual(preparedBoxel.ok, true);
if (!preparedBoxel.ok) throw new Error(preparedBoxel.error.message);
const boxelDecision = preparedBoxel.value.authorize({
  party: '../Staff/provider-a',
  capability: 'ViewStudentClassroom',
  card: '../StudentAccess/student-a',
  trace: true,
});
strictEqual(boxelDecision.ok, true);
if (!boxelDecision.ok) throw new Error(boxelDecision.error.message);
strictEqual(boxelDecision.value.allowed, true);
strictEqual(
  boxelDecision.value.trace.some(
    (event) => event.operation === 'openfga-recursive-userset',
  ),
  true,
  'a userset-valued Provider relationship invokes the synchronous recursive port',
);

console.log(
  'OpenFGA recursive port: Zanzibar-style implicit userset recursion, target isolation, cycle pruning, depth limit, provenance passed',
);
