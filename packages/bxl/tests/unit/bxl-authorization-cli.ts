import { readFileSync } from 'node:fs';
import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationCheckRequest,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '../../src/authorization/index.ts';

interface CapabilityCheck extends BxlAuthorizationCheckRequest {
  domain: string;
  allowed: boolean;
}

interface CapabilityListExpectation {
  domain: string;
  party: string;
  resource: string;
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
  document: BxlAuthorizationDocument;
  snapshot: BxlAuthorizationSnapshot;
  checks: CapabilityCheck[];
  capabilityLists: CapabilityListExpectation[];
};

const prepared = prepareBxlAuthorizationSafe(
  fixture.document,
  fixture.snapshot,
);
if (!prepared.ok) throw new Error(prepared.error.message);
const authorization = prepared.value;

strictEqual(fixture.checks.length, 32);
const domains = new Set(fixture.checks.map((check) => check.domain));
deepStrictEqual([...domains].sort(), [
  'connected-app',
  'inventory',
  'judging',
  'turn-game',
]);

const decisions = authorization.checkCapabilities(
  fixture.checks.map(({ allowed: _allowed, domain: _domain, ...request }) => ({
    ...request,
    trace: true,
  })),
);
let decodedUsersetTraceFound = false;
for (let index = 0; index < decisions.length; index++) {
  const decision = decisions[index]!;
  const expected = fixture.checks[index]!;
  const label = `${expected.domain}: ${expected.party} ${expected.capability} ${expected.resource}`;
  strictEqual(decision.ok, true, label);
  if (!decision.ok) continue;
  strictEqual(decision.value.allowed, expected.allowed, label);
  strictEqual(
    decision.value.decision,
    expected.allowed ? 'allow' : 'refuse',
    label,
  );
  strictEqual(decision.value.metrics.steps > 0, true, label);
  strictEqual(decision.value.trace.length > 0, true, label);
  strictEqual(
    decision.value.trace.every((event) => !event.resource.startsWith('scope_')),
    true,
    label,
  );
  strictEqual(
    decision.value.trace.every((event) => !event.party.startsWith('party:')),
    true,
    label,
  );
  strictEqual(
    decision.value.trace.every((event) => !event.resource.startsWith('party:')),
    true,
    label,
  );
  decodedUsersetTraceFound ||= decision.value.trace.some(
    (event) => event.resource === '../Team/spring-judges',
  );
}
strictEqual(
  decodedUsersetTraceFound,
  true,
  'userset trace exposes the original resource identifier',
);

for (const expectation of fixture.capabilityLists) {
  const listed = authorization.listCapabilities({
    party: expectation.party,
    resource: expectation.resource,
  });
  strictEqual(listed.ok, true, `${expectation.domain}: listCapabilities`);
  if (!listed.ok) continue;
  deepStrictEqual(
    listed.value.capabilities,
    expectation.capabilities,
    `${expectation.domain}: ${expectation.party} on ${expectation.resource}`,
  );

  const resource = fixture.snapshot.resources.find(
    (candidate) => candidate.resource === expectation.resource,
  )!;
  const scope = fixture.document.scopes.find(
    (candidate) => candidate.name === resource.type,
  )!;
  for (const capability of scope.capabilities) {
    const checked = authorization.checkCapability({
      party: expectation.party,
      capability: capability.name,
      resource: expectation.resource,
    });
    strictEqual(checked.ok, true);
    if (!checked.ok) continue;
    strictEqual(
      listed.value.capabilities.includes(capability.name),
      checked.value.allowed,
      `listCapabilities parity: ${expectation.party} ${capability.name} ${expectation.resource}`,
    );
  }
}

const playerGames = authorization.listResources({
  party: '../Person/player-x',
  capability: 'MakeMove',
  type: 'TurnGame',
});
strictEqual(playerGames.ok, true);
if (playerGames.ok) {
  deepStrictEqual(playerGames.value.resources, ['../TurnGame/match-1']);
}

const inventoryScanners = authorization.listParties({
  resource: '../InventoryLedger/main',
  capability: 'RecordScan',
});
strictEqual(inventoryScanners.ok, true);
if (inventoryScanners.ok) {
  deepStrictEqual(inventoryScanners.value.parties, [
    '../Device/loading-dock-scanner',
  ]);
}

const nestedJudge = authorization.checkCapability({
  party: '../Person/judge-a',
  capability: 'SubmitScore',
  resource: '../JudgingContest/spring-2026',
});
strictEqual(nestedJudge.ok, true);
if (nestedJudge.ok) strictEqual(nestedJudge.value.allowed, true);

const appTargetIsolation = authorization.checkCapability({
  party: '../Service/fulfillment-bot',
  capability: 'PerformAppAction',
  resource: '../ConnectedApp/analytics-bot',
});
strictEqual(appTargetIsolation.ok, true);
if (appTargetIsolation.ok) strictEqual(appTargetIsolation.value.allowed, false);

const invalidEnumerationLimit = authorization.listCapabilities({
  party: '../Person/player-x',
  resource: '../TurnGame/match-1',
  limits: { maxCandidates: Number.NaN },
});
strictEqual(invalidEnumerationLimit.ok, false);
if (!invalidEnumerationLimit.ok) {
  strictEqual(invalidEnumerationLimit.error.kind, 'invalid-model');
}

const unknownObject = authorization.listCapabilities({
  party: '../Person/player-x',
  resource: '../TurnGame/missing',
});
strictEqual(unknownObject.ok, false);
if (!unknownObject.ok) {
  strictEqual(unknownObject.error.kind, 'invalid-identifier');
}

console.log(
  'BXL Authorization: 32 generalized coordination decisions across inventory, turn games, connected apps, and judging passed',
);
