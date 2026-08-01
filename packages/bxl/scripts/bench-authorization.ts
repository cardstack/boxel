import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import {
  prepareBoxelPolicySafe,
  type BoxelAuthorizeRequest,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '../src/authorization/index.js';

interface CapabilityFixture {
  document: BoxelPolicyDocument;
  snapshot: BoxelPolicySnapshot;
  checks: Array<BoxelAuthorizeRequest & { domain: string; allowed: boolean }>;
}

interface EducationFixture {
  document: BoxelPolicyDocument;
  snapshot: BoxelPolicySnapshot;
  checks: Array<BoxelAuthorizeRequest & { allowed: boolean }>;
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
const educationFixture = JSON.parse(
  readFileSync(
    new URL(
      '../tests/authorization/fixtures/education/classroom-report.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as EducationFixture;

function benchmark(name: string, iterations: number, operation: () => void): void {
  for (let index = 0; index < Math.min(iterations, 100); index++) operation();
  const started = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  const elapsed = performance.now() - started;
  console.log(
    `${name.padEnd(24)} ${iterations.toString().padStart(7)} iterations  ` +
      `${(elapsed / iterations).toFixed(4)} ms/op`,
  );
}

const prepared = prepareBoxelPolicySafe(fixture.document, fixture.snapshot);
if (!prepared.ok) throw new Error(prepared.error.message);
const checks = fixture.checks.map(
  ({ allowed: _allowed, domain: _domain, ...request }) => request,
);
const educationPrepared = prepareBoxelPolicySafe(
  educationFixture.document,
  educationFixture.snapshot,
);
if (!educationPrepared.ok) throw new Error(educationPrepared.error.message);
const educationChecks = educationFixture.checks.map(
  ({ allowed: _allowed, ...request }) => request,
);

benchmark('cold prepare', 1_000, () => {
  const result = prepareBoxelPolicySafe(fixture.document, fixture.snapshot);
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm authorize', 20_000, () => {
  const result = prepared.value.authorize(checks[0]!);
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm authorizeMany(32)', 2_000, () => {
  const results = prepared.value.authorizeMany(checks);
  if (results.some((result) => !result.ok)) throw new Error('checkMany failed');
});

benchmark('warm authorizeMany(40)', 2_000, () => {
  const results = educationPrepared.value.authorizeMany(educationChecks);
  if (results.some((result) => !result.ok)) throw new Error('education checkMany failed');
});

benchmark('nested userset authorize', 20_000, () => {
  const result = educationPrepared.value.authorize({
    party: '../Staff/provider',
    capability: 'ViewStudentInternalNote',
    card: '../StudentReportAccess/student-a',
  });
  if (!result.ok || !result.value.allowed) {
    throw new Error('nested userset decision failed');
  }
});

benchmark('warm ListCards', 2_000, () => {
  const result = prepared.value.listCards({
    party: '../Person/player-x',
    capability: 'MakeMove',
    adoptsFrom: '../games/TurnGame',
  });
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm ListParties', 2_000, () => {
  const result = prepared.value.listParties({
    card: '../AttendanceLedger/main',
    capability: 'RecordPunch',
  });
  if (!result.ok) throw new Error(result.error.message);
});

benchmark('warm ListCapabilities', 2_000, () => {
  const result = prepared.value.listCapabilities({
    party: '../Person/attendance-admin',
    card: '../AttendanceLedger/main',
  });
  if (!result.ok) throw new Error(result.error.message);
});
