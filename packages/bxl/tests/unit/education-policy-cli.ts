import { readFileSync } from 'node:fs';
import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareBoxelPolicySafe,
  type BoxelAuthorizeRequest,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '../../src/authorization/index.js';

interface ExpectedDecision extends BoxelAuthorizeRequest {
  allowed: boolean;
}

interface ExpectedCapabilityList {
  party: string;
  card: string;
  capabilities: string[];
}

interface EducationFixture {
  provenance: { generalized: boolean; source: string; boundary: string };
  document: BoxelPolicyDocument;
  snapshot: BoxelPolicySnapshot;
  checks: ExpectedDecision[];
  capabilityLists: ExpectedCapabilityList[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../authorization/fixtures/education/classroom-report.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as EducationFixture;

strictEqual(fixture.provenance.generalized, true);
strictEqual(fixture.checks.length, 40);

const prepared = prepareBoxelPolicySafe(fixture.document, fixture.snapshot);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);

const decisions = prepared.value.authorizeMany(
  fixture.checks.map(({ allowed: _allowed, ...request }) => ({
    ...request,
    trace: true,
  })),
);

for (let index = 0; index < fixture.checks.length; index++) {
  const expected = fixture.checks[index]!;
  const actual = decisions[index]!;
  const label = `${expected.party} ${expected.capability} ${expected.card}`;
  strictEqual(actual.ok, true, label);
  if (!actual.ok) continue;
  strictEqual(actual.value.allowed, expected.allowed, label);
  strictEqual(actual.value.decision, expected.allowed ? 'allow' : 'refuse', label);
}

for (const expected of fixture.capabilityLists) {
  const actual = prepared.value.listCapabilities({
    party: expected.party,
    card: expected.card,
  });
  strictEqual(actual.ok, true, `${expected.party} capabilities on ${expected.card}`);
  if (!actual.ok) continue;
  deepStrictEqual(actual.value.capabilities, expected.capabilities);
}

const nestedProvider = prepared.value.authorize({
  party: '../Staff/provider',
  capability: 'ViewStudentInternalNote',
  card: '../StudentReportAccess/student-a',
  trace: true,
});
strictEqual(nestedProvider.ok, true);
if (!nestedProvider.ok) throw new Error(nestedProvider.error.message);
strictEqual(nestedProvider.value.allowed, true);
strictEqual(
  nestedProvider.value.trace.some(
    (event) => event.operation === 'openfga-recursive-userset',
  ),
  true,
  'nested provider membership uses the bounded synchronous userset resolver',
);

const wrongStudent = prepared.value.authorize({
  party: '../Staff/provider',
  capability: 'ViewStudentInternalNote',
  card: '../StudentReportAccess/student-c',
});
strictEqual(wrongStudent.ok, true);
if (wrongStudent.ok) {
  strictEqual(
    wrongStudent.value.allowed,
    false,
    'provider authority remains scoped to the student card',
  );
}

const policy = fixture.snapshot.policy!;
const withoutGeneralStaff: BoxelPolicySnapshot = {
  ...fixture.snapshot,
  policy: {
    ...policy,
    links: {
      ...policy.links,
      staffMembers: [],
    },
  },
};
const membershipChanged = prepareBoxelPolicySafe(
  fixture.document,
  withoutGeneralStaff,
);
strictEqual(membershipChanged.ok, true);
if (!membershipChanged.ok) throw new Error(membershipChanged.error.message);
const removedStaff = membershipChanged.value.authorize({
  party: '../Staff/general',
  capability: 'ViewClassroom',
  card: '../ClassroomReport/current-week',
});
strictEqual(removedStaff.ok, true);
if (removedStaff.ok) {
  strictEqual(
    removedStaff.value.allowed,
    false,
    're-preparing from edited membership changes the authorization decision',
  );
}

console.log(
  'Generalized education policy: 40 report decisions, 10 capability lists, recursive provider isolation, and membership reactivity passed',
);
