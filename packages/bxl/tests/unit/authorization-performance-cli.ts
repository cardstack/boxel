import { readFileSync } from 'node:fs';
import { strictEqual } from 'node:assert';
import { performance } from 'node:perf_hooks';
import {
  prepareBoxelPolicySafe,
  type BoxelAuthorizeRequest,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '../../src/authorization/index.js';

interface Fixture {
  document: BoxelPolicyDocument;
  snapshot: BoxelPolicySnapshot;
  checks: Array<BoxelAuthorizeRequest & { allowed: boolean }>;
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
const education = load(
  '../authorization/fixtures/education/classroom-report.json',
);
const multiplier = Number(process.env.BXL_AUTH_PERF_BUDGET_MULTIPLIER ?? '1');
strictEqual(Number.isFinite(multiplier) && multiplier > 0, true);

const preparedCoordination = prepareBoxelPolicySafe(
  coordination.document,
  coordination.snapshot,
);
strictEqual(preparedCoordination.ok, true);
if (!preparedCoordination.ok) {
  throw new Error(preparedCoordination.error.message);
}
const preparedEducation = prepareBoxelPolicySafe(
  education.document,
  education.snapshot,
);
strictEqual(preparedEducation.ok, true);
if (!preparedEducation.ok) throw new Error(preparedEducation.error.message);

const coordinationRequests = coordination.checks.map(
  ({ allowed: _allowed, ...request }) => request,
);
const nestedProviderRequest: BoxelAuthorizeRequest = {
  party: '../Staff/provider',
  capability: 'ViewStudentInternalNote',
  card: '../StudentReportAccess/student-a',
};

const metrics = {
  coldPrepareMs: measure(200, () => {
    const result = prepareBoxelPolicySafe(
      coordination.document,
      coordination.snapshot,
    );
    if (!result.ok) throw new Error(result.error.message);
  }),
  warmAuthorizeMs: measure(20_000, () => {
    const result = preparedCoordination.value.authorize(
      coordinationRequests[0]!,
    );
    if (!result.ok) throw new Error(result.error.message);
  }),
  batch32Ms: measure(1_000, () => {
    const results = preparedCoordination.value.authorizeMany(
      coordinationRequests,
    );
    if (results.some((result) => !result.ok)) {
      throw new Error('authorizeMany failed');
    }
  }),
  nestedUsersetMs: measure(10_000, () => {
    const result = preparedEducation.value.authorize(nestedProviderRequest);
    if (!result.ok || !result.value.allowed) {
      throw new Error('nested userset decision failed');
    }
  }),
};

// These are deliberately broad CI regression budgets, not production SLOs.
// They sit well above the checked-in benchmark baseline so a noisy shared
// runner does not fail while still catching accidental algorithmic blow-ups.
assertBudget('cold prepare', metrics.coldPrepareMs, 50 * multiplier);
assertBudget('warm authorize', metrics.warmAuthorizeMs, 2 * multiplier);
assertBudget('authorizeMany(32)', metrics.batch32Ms, 10 * multiplier);
assertBudget('nested userset authorize', metrics.nestedUsersetMs, 2 * multiplier);

console.log(
  `Authorization performance gate: prepare=${metrics.coldPrepareMs.toFixed(4)} ms/op ` +
    `authorize=${metrics.warmAuthorizeMs.toFixed(4)} ms/op ` +
    `batch32=${metrics.batch32Ms.toFixed(4)} ms/op ` +
    `nested=${metrics.nestedUsersetMs.toFixed(4)} ms/op`,
);
