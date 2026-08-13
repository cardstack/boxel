import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationCheckRequest,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '../src/authorization/index.ts';

interface CapabilityFixture {
  document: BxlAuthorizationDocument;
  snapshot: BxlAuthorizationSnapshot;
  checks: Array<
    BxlAuthorizationCheckRequest & { domain: string; allowed: boolean }
  >;
}

interface ReleaseGovernanceFixture {
  document: BxlAuthorizationDocument;
  snapshot: BxlAuthorizationSnapshot;
  checks: Array<BxlAuthorizationCheckRequest & { allowed: boolean }>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../tests/authorization/fixtures/realm-collaboration/capability-scenarios.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as CapabilityFixture;
const releaseGovernanceFixture = JSON.parse(
  readFileSync(
    new URL(
      '../tests/authorization/fixtures/software-release/release-governance.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as ReleaseGovernanceFixture;

function benchmark(
  name: string,
  iterations: number,
  operation: () => void,
): void {
  for (let index = 0; index < Math.min(iterations, 100); index++) operation();
  const started = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  const elapsed = performance.now() - started;
  console.log(
    `${name.padEnd(24)} ${iterations.toString().padStart(7)} iterations  ` +
      `${(elapsed / iterations).toFixed(4)} ms/op`,
  );
}

const prepared = prepareBxlAuthorizationSafe(
  fixture.document,
  fixture.snapshot,
);
if (!prepared.ok) throw new Error(prepared.error.message);
const checks = fixture.checks.map(
  ({ allowed: _allowed, domain: _domain, ...request }) => request,
);
const releaseGovernancePrepared = prepareBxlAuthorizationSafe(
  releaseGovernanceFixture.document,
  releaseGovernanceFixture.snapshot,
);
if (!releaseGovernancePrepared.ok) {
  throw new Error(releaseGovernancePrepared.error.message);
}
const releaseGovernanceChecks = releaseGovernanceFixture.checks.map(
  ({ allowed: _allowed, ...request }) => request,
);

benchmark('cold prepare', 1_000, () => {
  const result = prepareBxlAuthorizationSafe(
    fixture.document,
    fixture.snapshot,
  );
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm checkCapability', 20_000, () => {
  const result = prepared.value.checkCapability(checks[0]!);
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm checkCapabilities(32)', 2_000, () => {
  const results = prepared.value.checkCapabilities(checks);
  if (results.some((result) => !result.ok)) throw new Error('checkMany failed');
});

benchmark('warm checkCapabilities(40)', 2_000, () => {
  const results = releaseGovernancePrepared.value.checkCapabilities(
    releaseGovernanceChecks,
  );
  if (results.some((result) => !result.ok)) {
    throw new Error('release-governance checkMany failed');
  }
});

benchmark('nested userset check', 20_000, () => {
  const result = releaseGovernancePrepared.value.checkCapability({
    party: '../Person/security-reviewer',
    capability: 'ReviewSecurity',
    resource: '../ChangeRequest/change-a',
  });
  if (!result.ok || !result.value.allowed) {
    throw new Error('nested userset decision failed');
  }
});

benchmark('warm ListResources', 2_000, () => {
  const result = prepared.value.listResources({
    party: '../Person/player-x',
    capability: 'MakeMove',
    type: 'TurnGame',
  });
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm ListParties', 2_000, () => {
  const result = prepared.value.listParties({
    resource: '../InventoryLedger/main',
    capability: 'RecordScan',
  });
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm ListCapabilities', 2_000, () => {
  const result = prepared.value.listCapabilities({
    party: '../Person/inventory-supervisor',
    resource: '../InventoryLedger/main',
  });
  if (!result.ok) throw new Error(result.error.message);
});
