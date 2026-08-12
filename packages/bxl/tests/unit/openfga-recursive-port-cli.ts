import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  OPENFGA_RECURSIVE_PORT_INFO,
  prepareAuthorizationGraphSafe,
  prepareBxlAuthorizationSafe,
  type AuthorizationGraphModel,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
  type RelationshipTuple,
} from '../../src/index.js';

const model: AuthorizationGraphModel = {
  schema: 'bxl-authorization-ir/1',
  types: {
    user: {},
    group: {
      relations: {
        member: ['user', 'group#member'],
      },
    },
    change_request: {
      relations: {
        reviewer: ['group#member'],
      },
      permissions: {
        review_security: 'userset("reviewer")',
      },
    },
  },
};

const tuples: RelationshipTuple[] = [
  // Reviewer A belongs to a security team, that team belongs to Change A's
  // review group, and the group userset holds the change-scoped relation.
  { subject: 'user:reviewer-a', relation: 'member', object: 'group:product-security' },
  {
    subject: 'group:product-security#member',
    relation: 'member',
    object: 'group:change-a-reviewers',
  },
  {
    subject: 'group:change-a-reviewers#member',
    relation: 'reviewer',
    object: 'change_request:change-a',
  },

  { subject: 'user:reviewer-b', relation: 'member', object: 'group:change-b-reviewers' },
  {
    subject: 'group:change-b-reviewers#member',
    relation: 'reviewer',
    object: 'change_request:change-b',
  },

  // A deliberately cyclic userset proves visited-userset pruning terminates.
  { subject: 'group:cycle-b#member', relation: 'member', object: 'group:cycle-a' },
  { subject: 'group:cycle-a#member', relation: 'member', object: 'group:cycle-b' },
  {
    subject: 'group:cycle-a#member',
    relation: 'reviewer',
    object: 'change_request:cycle-change',
  },
];

const prepared = prepareAuthorizationGraphSafe(model, tuples);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);

const check = (subject: string, object: string) =>
  prepared.value.check({
    subject,
    relation: 'review_security',
    object,
    trace: true,
  });

const reviewerAChangeA = check('user:reviewer-a', 'change_request:change-a');
strictEqual(reviewerAChangeA.ok, true);
if (!reviewerAChangeA.ok) throw new Error(reviewerAChangeA.error.message);
strictEqual(reviewerAChangeA.value.allowed, true);
strictEqual(reviewerAChangeA.value.metrics.maxDepth, 3);
const recursiveTrace = reviewerAChangeA.value.trace.filter(
  (event) => event.operation === 'openfga-recursive-userset',
);
deepStrictEqual(
  recursiveTrace.map((event) => `${event.object}#${event.relation}`),
  ['group:product-security#member', 'group:change-a-reviewers#member'],
);
strictEqual(
  recursiveTrace.every((event) =>
    event.detail?.includes('breadthFirstRecursiveMatch'),
  ),
  true,
);

const reviewerAChangeB = check('user:reviewer-a', 'change_request:change-b');
strictEqual(reviewerAChangeB.ok, true);
if (reviewerAChangeB.ok) strictEqual(reviewerAChangeB.value.allowed, false);

const reviewerBChangeB = check('user:reviewer-b', 'change_request:change-b');
strictEqual(reviewerBChangeB.ok, true);
if (reviewerBChangeB.ok) strictEqual(reviewerBChangeB.value.allowed, true);

const cyclic = check('user:nobody', 'change_request:cycle-change');
strictEqual(cyclic.ok, true);
if (!cyclic.ok) throw new Error(cyclic.error.message);
strictEqual(cyclic.value.allowed, false);
strictEqual(
  cyclic.value.trace.some((event) => event.detail?.includes('revisits pruned')),
  true,
);

const depthLimited = prepared.value.check({
  subject: 'user:reviewer-a',
  relation: 'review_security',
  object: 'change_request:change-a',
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

const bxlDocument: BxlAuthorizationDocument = {
  schema: 'bxl-authorization/1',
  scopes: [
    {
      name: 'ChangeReviewAccess',
      seats: [{ name: 'ReviewTeam', from: 'Resource.ReviewTeam' }],
      capabilities: [
        {
          name: 'ReviewSecurity',
          where: 'Seat.ReviewTeam',
        },
      ],
    },
  ],
};

const bxlSnapshot: BxlAuthorizationSnapshot = {
  resources: [
    {
      resource: '../ChangeRequest/change-a',
      type: 'ChangeReviewAccess',
      links: { reviewTeam: '../Group/change-a-reviewers' },
    },
  ],
  parties: [
    { party: '../Person/reviewer-a' },
    { party: '../Group/product-security', members: ['../Person/reviewer-a'] },
    {
      party: '../Group/change-a-reviewers',
      members: ['../Group/product-security'],
    },
  ],
};

strictEqual(
  bxlDocument.scopes[0]!.capabilities[0]!.where,
  'Seat.ReviewTeam',
  'the BXL authorization names the relationship without embedding traversal syntax',
);
const preparedBxl = prepareBxlAuthorizationSafe(bxlDocument, bxlSnapshot);
strictEqual(preparedBxl.ok, true);
if (!preparedBxl.ok) throw new Error(preparedBxl.error.message);
const bxlDecision = preparedBxl.value.checkCapability({
  party: '../Person/reviewer-a',
  capability: 'ReviewSecurity',
  resource: '../ChangeRequest/change-a',
  trace: true,
});
strictEqual(bxlDecision.ok, true);
if (!bxlDecision.ok) throw new Error(bxlDecision.error.message);
strictEqual(bxlDecision.value.allowed, true);
strictEqual(
  bxlDecision.value.trace.some(
    (event) => event.operation === 'openfga-recursive-userset',
  ),
  true,
  'a userset-valued ReviewTeam relationship invokes the synchronous recursive port',
);

console.log(
  'OpenFGA recursive port: Zanzibar-style implicit userset recursion, target isolation, cycle pruning, depth limit, provenance passed',
);
