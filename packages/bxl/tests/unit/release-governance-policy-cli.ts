import { readFileSync } from 'node:fs';
import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationCheckRequest,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '../../src/authorization/index.ts';

interface ExpectedDecision extends BxlAuthorizationCheckRequest {
  allowed: boolean;
}

interface ExpectedCapabilityList {
  party: string;
  resource: string;
  capabilities: string[];
}

interface ReleaseGovernanceFixture {
  provenance: { generalized: boolean; source: string; boundary: string };
  document: BxlAuthorizationDocument;
  snapshot: BxlAuthorizationSnapshot;
  checks: ExpectedDecision[];
  capabilityLists: ExpectedCapabilityList[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../authorization/fixtures/software-release/release-governance.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as ReleaseGovernanceFixture;

strictEqual(fixture.provenance.generalized, true);
strictEqual(fixture.checks.length, 40);

const prepared = prepareBxlAuthorizationSafe(
  fixture.document,
  fixture.snapshot,
);
if (!prepared.ok) throw new Error(prepared.error.message);

const decisions = prepared.value.checkCapabilities(
  fixture.checks.map(({ allowed: _allowed, ...request }) => ({
    ...request,
    trace: true,
  })),
);

for (let index = 0; index < fixture.checks.length; index++) {
  const expected = fixture.checks[index]!;
  const actual = decisions[index]!;
  const label = `${expected.party} ${expected.capability} ${expected.resource}`;
  strictEqual(actual.ok, true, label);
  if (!actual.ok) continue;
  strictEqual(actual.value.allowed, expected.allowed, label);
  strictEqual(
    actual.value.decision,
    expected.allowed ? 'allow' : 'refuse',
    label,
  );
}

for (const expected of fixture.capabilityLists) {
  const actual = prepared.value.listCapabilities({
    party: expected.party,
    resource: expected.resource,
  });
  strictEqual(
    actual.ok,
    true,
    `${expected.party} capabilities on ${expected.resource}`,
  );
  if (!actual.ok) continue;
  deepStrictEqual(actual.value.capabilities, expected.capabilities);
}

const nestedReviewer = prepared.value.checkCapability({
  party: '../Person/security-reviewer',
  capability: 'ReviewSecurity',
  resource: '../ChangeRequest/change-a',
  trace: true,
});
if (!nestedReviewer.ok) throw new Error(nestedReviewer.error.message);
strictEqual(nestedReviewer.value.allowed, true);
strictEqual(
  nestedReviewer.value.trace.some(
    (event) => event.operation === 'openfga-recursive-userset',
  ),
  true,
  'nested review-team membership uses the bounded synchronous userset resolver',
);

const wrongChange = prepared.value.checkCapability({
  party: '../Person/security-reviewer',
  capability: 'ReviewSecurity',
  resource: '../ChangeRequest/change-c',
});
strictEqual(wrongChange.ok, true);
if (wrongChange.ok) {
  strictEqual(
    wrongChange.value.allowed,
    false,
    'review authority remains scoped to the assigned change request',
  );
}

const policy = fixture.snapshot.policy!;
const withoutContributors: BxlAuthorizationSnapshot = {
  ...fixture.snapshot,
  policy: {
    ...policy,
    links: {
      ...policy.links,
      contributors: [],
    },
  },
};
const membershipChanged = prepareBxlAuthorizationSafe(
  fixture.document,
  withoutContributors,
);
if (!membershipChanged.ok) throw new Error(membershipChanged.error.message);
const removedContributor = membershipChanged.value.checkCapability({
  party: '../Person/contributor',
  capability: 'ViewDashboard',
  resource: '../ReleaseDashboard/current',
});
strictEqual(removedContributor.ok, true);
if (removedContributor.ok) {
  strictEqual(
    removedContributor.value.allowed,
    false,
    're-preparing from edited membership changes the authorization decision',
  );
}

console.log(
  'Software-release governance: 40 decisions, 10 capability lists, recursive review-team isolation, and membership reactivity passed',
);
