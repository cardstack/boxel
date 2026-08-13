import { readFileSync } from 'node:fs';
import { strictEqual } from 'node:assert';
import { performance } from 'node:perf_hooks';
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationCheckRequest,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '../../src/authorization/index.ts';

interface Fixture {
  document: BxlAuthorizationDocument;
  snapshot: BxlAuthorizationSnapshot;
  checks: Array<BxlAuthorizationCheckRequest & { allowed: boolean }>;
}

function load(relative: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), 'utf8'),
  ) as Fixture;
}

function measure(iterations: number, operation: () => void): number {
  for (let index = 0; index < Math.min(iterations, 100); index++) operation();
  const started = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  return (performance.now() - started) / iterations;
}

function assertBudget(name: string, actual: number, budget: number): void {
  strictEqual(
    actual <= budget,
    true,
    `${name} took ${actual.toFixed(4)} ms/op; regression budget is ${budget.toFixed(4)} ms/op`,
  );
}

const coordination = load(
  '../authorization/fixtures/realm-collaboration/capability-scenarios.json',
);
const releaseGovernance = load(
  '../authorization/fixtures/software-release/release-governance.json',
);
const multiplier = Number(process.env.BXL_AUTH_PERF_BUDGET_MULTIPLIER ?? '1');
strictEqual(Number.isFinite(multiplier) && multiplier > 0, true);

const preparedCoordination = prepareBxlAuthorizationSafe(
  coordination.document,
  coordination.snapshot,
);
if (!preparedCoordination.ok) {
  throw new Error(preparedCoordination.error.message);
}
const preparedReleaseGovernance = prepareBxlAuthorizationSafe(
  releaseGovernance.document,
  releaseGovernance.snapshot,
);
if (!preparedReleaseGovernance.ok) {
  throw new Error(preparedReleaseGovernance.error.message);
}

const coordinationRequests = coordination.checks.map(
  ({ allowed: _allowed, ...request }) => request,
);
const nestedReviewTeamRequest: BxlAuthorizationCheckRequest = {
  party: '../Person/security-reviewer',
  capability: 'ReviewSecurity',
  resource: '../ChangeRequest/change-a',
};

const metrics = {
  coldPrepareMs: measure(200, () => {
    const result = prepareBxlAuthorizationSafe(
      coordination.document,
      coordination.snapshot,
    );
    if (!result.ok) throw new Error(result.error.message);
  }),
  warmCheckCapabilityMs: measure(20_000, () => {
    const result = preparedCoordination.value.checkCapability(
      coordinationRequests[0]!,
    );
    if (!result.ok) throw new Error(result.error.message);
  }),
  batch32Ms: measure(1_000, () => {
    const results =
      preparedCoordination.value.checkCapabilities(coordinationRequests);
    if (results.some((result) => !result.ok)) {
      throw new Error('checkCapabilities failed');
    }
  }),
  nestedUsersetCheckMs: measure(10_000, () => {
    const result = preparedReleaseGovernance.value.checkCapability(
      nestedReviewTeamRequest,
    );
    if (!result.ok || !result.value.allowed) {
      throw new Error('nested userset decision failed');
    }
  }),
};

// These are deliberately broad CI regression budgets, not production SLOs.
// They sit well above the checked-in benchmark baseline so a noisy shared
// runner does not fail while still catching accidental algorithmic blow-ups.
assertBudget('cold prepare', metrics.coldPrepareMs, 50 * multiplier);
assertBudget(
  'warm checkCapability',
  metrics.warmCheckCapabilityMs,
  2 * multiplier,
);
assertBudget('checkCapabilities(32)', metrics.batch32Ms, 10 * multiplier);
assertBudget(
  'nested userset check',
  metrics.nestedUsersetCheckMs,
  2 * multiplier,
);

console.log(
  `Authorization performance gate: prepare=${metrics.coldPrepareMs.toFixed(4)} ms/op ` +
    `check=${metrics.warmCheckCapabilityMs.toFixed(4)} ms/op ` +
    `batch32=${metrics.batch32Ms.toFixed(4)} ms/op ` +
    `nested=${metrics.nestedUsersetCheckMs.toFixed(4)} ms/op`,
);
