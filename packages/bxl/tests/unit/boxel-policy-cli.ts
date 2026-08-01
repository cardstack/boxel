import { readFileSync } from 'node:fs';
import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareBoxelPolicySafe,
  type BoxelAuthorizeRequest,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '../../src/authorization/index.js';

interface CapabilityCheck extends BoxelAuthorizeRequest {
  domain: string;
  allowed: boolean;
}

interface CapabilityListExpectation {
  domain: string;
  party: string;
  card: string;
  capabilities: string[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../authorization/fixtures/realm-collaboration/capability-scenarios.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  document: BoxelPolicyDocument;
  snapshot: BoxelPolicySnapshot;
  checks: CapabilityCheck[];
  capabilityLists: CapabilityListExpectation[];
};

const prepared = prepareBoxelPolicySafe(fixture.document, fixture.snapshot);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);
const policy = prepared.value;

strictEqual(fixture.checks.length, 32);
const domains = new Set(fixture.checks.map((check) => check.domain));
deepStrictEqual([...domains].sort(), [
  'attendance',
  'connected-app',
  'judging',
  'turn-game',
]);

const decisions = policy.authorizeMany(
  fixture.checks.map(({ allowed: _allowed, domain: _domain, ...request }) => ({
    ...request,
    trace: true,
  })),
);
let decodedUsersetTraceFound = false;
for (let index = 0; index < decisions.length; index++) {
  const decision = decisions[index]!;
  const expected = fixture.checks[index]!;
  const label = `${expected.domain}: ${expected.party} ${expected.capability} ${expected.card}`;
  strictEqual(decision.ok, true, label);
  if (!decision.ok) continue;
  strictEqual(decision.value.allowed, expected.allowed, label);
  strictEqual(decision.value.decision, expected.allowed ? 'allow' : 'refuse', label);
  strictEqual(decision.value.metrics.steps > 0, true, label);
  strictEqual(decision.value.trace.length > 0, true, label);
  strictEqual(
    decision.value.trace.every((event) => !event.card.startsWith('scope_')),
    true,
    label,
  );
  strictEqual(
    decision.value.trace.every((event) => !event.party.startsWith('party:')),
    true,
    label,
  );
  strictEqual(
    decision.value.trace.every((event) => !event.card.startsWith('party:')),
    true,
    label,
  );
  decodedUsersetTraceFound ||= decision.value.trace.some(
    (event) => event.card === '../Team/spring-judges',
  );
}
strictEqual(decodedUsersetTraceFound, true, 'userset trace card is realm-native');

for (const expectation of fixture.capabilityLists) {
  const listed = policy.listCapabilities({
    party: expectation.party,
    card: expectation.card,
  });
  strictEqual(listed.ok, true, `${expectation.domain}: listCapabilities`);
  if (!listed.ok) continue;
  deepStrictEqual(
    listed.value.capabilities,
    expectation.capabilities,
    `${expectation.domain}: ${expectation.party} on ${expectation.card}`,
  );

  const card = fixture.snapshot.cards.find(
    (candidate) => candidate.card === expectation.card,
  )!;
  const scope = fixture.document.scopes.find(
    (candidate) => candidate.adoptsFrom === card.adoptsFrom,
  )!;
  for (const capability of scope.capabilities) {
    const checked = policy.authorize({
      party: expectation.party,
      capability: capability.name,
      card: expectation.card,
    });
    strictEqual(checked.ok, true);
    if (!checked.ok) continue;
    strictEqual(
      listed.value.capabilities.includes(capability.name),
      checked.value.allowed,
      `listCapabilities parity: ${expectation.party} ${capability.name} ${expectation.card}`,
    );
  }
}

const playerGames = policy.listCards({
  party: '../Person/player-x',
  capability: 'MakeMove',
  adoptsFrom: '../games/TurnGame',
});
strictEqual(playerGames.ok, true);
if (playerGames.ok) {
  deepStrictEqual(playerGames.value.cards, ['../TurnGame/match-1']);
}

const attendanceKiosks = policy.listParties({
  card: '../AttendanceLedger/main',
  capability: 'RecordPunch',
});
strictEqual(attendanceKiosks.ok, true);
if (attendanceKiosks.ok) {
  deepStrictEqual(attendanceKiosks.value.parties, ['../Device/front-desk-1']);
}

const nestedJudge = policy.authorize({
  party: '../Person/judge-a',
  capability: 'SubmitScore',
  card: '../JudgingContest/spring-2026',
});
strictEqual(nestedJudge.ok, true);
if (nestedJudge.ok) strictEqual(nestedJudge.value.allowed, true);

const appTargetIsolation = policy.authorize({
  party: '../Service/fulfillment-bot',
  capability: 'PerformAppAction',
  card: '../ConnectedApp/analytics-bot',
});
strictEqual(appTargetIsolation.ok, true);
if (appTargetIsolation.ok) strictEqual(appTargetIsolation.value.allowed, false);

const invalidEnumerationLimit = policy.listCapabilities({
  party: '../Person/player-x',
  card: '../TurnGame/match-1',
  limits: { maxCandidates: Number.NaN },
});
strictEqual(invalidEnumerationLimit.ok, false);
if (!invalidEnumerationLimit.ok) {
  strictEqual(invalidEnumerationLimit.error.kind, 'invalid-model');
}

const unknownCard = policy.listCapabilities({
  party: '../Person/player-x',
  card: '../TurnGame/missing',
});
strictEqual(unknownCard.ok, false);
if (!unknownCard.ok) {
  strictEqual(unknownCard.error.kind, 'invalid-identifier');
}

console.log(
  'Boxel Policy v2: 32 generalized coordination decisions across attendance, turn games, connected apps, and judging passed',
);
