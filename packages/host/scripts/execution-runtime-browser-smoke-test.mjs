import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assessReferenceParity,
  classifySmokeOutcome,
  normalizeVisibleText,
  summarizeExecutionStages,
  summarizeExecutionRuntimeSmokeRun,
} from './execution-runtime-browser-smoke.mjs';
import {
  executionRuntimeMirrorCohort,
  mirrorCohortPlanes,
  validateMirrorCohort,
} from './execution-runtime-mirror-cohort.mjs';
import {
  executionRuntimeWildCorpusCases,
  executionRuntimeWildUrlMatrix,
  parseWildCorpusTable,
  validateWildCorpus,
  wildCorpusDocPath,
} from './execution-runtime-wild-corpus.mjs';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

function page(overrides = {}) {
  return {
    headingCount: 2,
    images: [
      { complete: true, height: 100, width: 100 },
      { complete: true, height: 100, width: 100 },
    ],
    inputCount: 2,
    semanticTokens: ['alpha', 'beta', 'gamma', 'workspace'],
    ...overrides,
  };
}

test('the wild corpus remains fifty unique, intentional CTSE cards', () => {
  assert.doesNotThrow(() =>
    validateWildCorpus(executionRuntimeWildCorpusCases),
  );
  assert.equal(executionRuntimeWildCorpusCases.length, 50);
  assert.equal(
    new Set(executionRuntimeWildCorpusCases.map(({ id }) => id)).size,
    50,
  );
  assert.equal(
    new Set(executionRuntimeWildCorpusCases.map(({ path }) => path)).size,
    50,
  );
  assert.equal(executionRuntimeWildUrlMatrix.length, 50);
  for (let entry of executionRuntimeWildUrlMatrix) {
    assert.equal(
      new URL(entry.referenceUrl).pathname,
      new URL(entry.candidateUrl).pathname,
    );
    assert.equal(
      new URL(entry.referenceUrl).origin,
      'https://realms-staging.stack.cards',
    );
    assert.ok(entry.category);
    assert.ok(entry.sourceUrl);
  }
  assert.equal(
    executionRuntimeWildCorpusCases.find(({ id }) => id === 'tier-fast-food')
      .minimumHealthyImages,
    20,
  );
  assert.equal(
    executionRuntimeWildCorpusCases.find(({ id }) => id === 'adorn-showcase')
      .minimumHealthyImages,
    51,
  );
});

test('every wild corpus row shares one candidate origin so a port change is one edit', () => {
  assert.equal(
    new Set(
      executionRuntimeWildUrlMatrix.map(
        (entry) => new URL(entry.candidateUrl).origin,
      ),
    ).size,
    1,
  );
});

test('the wild corpus does not claim a tier it has not observed', () => {
  assert.ok(
    executionRuntimeWildCorpusCases.every(
      ({ expectedExecution }) => expectedExecution === 'discover',
    ),
  );
});

test('the wild corpus rejects a duplicated card', () => {
  let duplicated = [
    ...executionRuntimeWildCorpusCases,
    executionRuntimeWildCorpusCases[0],
  ];
  assert.throws(() => validateWildCorpus(duplicated), /exactly 50 cards/);
});

test('the wild corpus rejects a row with no visible signature', () => {
  let cases = executionRuntimeWildCorpusCases.map((entry, index) =>
    index === 0 ? { ...entry, mustContain: [] } : entry,
  );
  assert.throws(() => validateWildCorpus(cases), /visible staging signature/);
});

test('the doc renders the manifest, so the two lists cannot drift apart', () => {
  let documentText = readFileSync(join(repoRoot, wildCorpusDocPath), 'utf8');
  assert.deepEqual(
    parseWildCorpusTable(documentText),
    executionRuntimeWildCorpusCases.map((smokeCase, index) => ({
      category: smokeCase.category,
      id: smokeCase.id,
      path: smokeCase.path,
      position: index + 1,
      purpose: smokeCase.purpose,
    })),
    `${wildCorpusDocPath} is stale — run \`pnpm --dir packages/host run corpus:write-docs\``,
  );
});

test('the mirror cohort is the ten numbered scenarios and covers every evidence plane', () => {
  assert.doesNotThrow(() => validateMirrorCohort(executionRuntimeMirrorCohort));
  assert.deepEqual(
    executionRuntimeMirrorCohort.map(({ id }) => id),
    [
      'M-01',
      'M-02',
      'M-03',
      'M-04',
      'M-05',
      'M-06',
      'M-07',
      'M-08',
      'M-09',
      'M-10',
    ],
  );
  assert.deepEqual(
    [
      ...new Set(executionRuntimeMirrorCohort.flatMap(({ planes }) => planes)),
    ].sort(),
    [...mirrorCohortPlanes].sort(),
  );
  for (let entry of executionRuntimeMirrorCohort) {
    assert.ok(entry.requiredProof.length > 0);
    if (entry.subjectUrl) {
      assert.ok(entry.subjectUrl.startsWith(entry.realmUrl));
    }
  }
});

test('the mirror cohort rejects a scenario with an unknown evidence plane', () => {
  let scenarios = executionRuntimeMirrorCohort.map((entry, index) =>
    index === 0 ? { ...entry, planes: ['vibes'] } : entry,
  );
  assert.throws(
    () => validateMirrorCohort(scenarios),
    /unknown evidence plane/,
  );
});

test('the mirror cohort rejects a scenario renumbered out of order', () => {
  let scenarios = executionRuntimeMirrorCohort.map((entry, index) =>
    index === 3 ? { ...entry, id: 'M-11' } : entry,
  );
  assert.throws(() => validateMirrorCohort(scenarios), /numbered in order/);
});

test('visible signatures ignore layout whitespace and Unicode presentation', () => {
  assert.equal(
    normalizeVisibleText('  Japan Airlines\nJL 001  '),
    normalizeVisibleText('Japan Airlines JL 001'),
  );
  assert.equal(normalizeVisibleText('ＡＡ４５００'), 'aa4500');
});

test('reference parity detects semantic, structural, control, and media loss', () => {
  let result = assessReferenceParity(
    page({
      headingCount: 0,
      images: [],
      inputCount: 0,
      semanticTokens: ['alpha'],
    }),
    page(),
    { referenceParity: true },
  );

  assert.deepEqual(result.failures, [
    'reference-image-parity',
    'reference-heading-parity',
    'reference-control-parity',
    'reference-semantic-parity',
  ]);
});

test('reference parity tolerates Host chrome outside a Sandbox document', () => {
  let result = assessReferenceParity(
    page({
      headingCount: 1,
      images: [{ complete: true, height: 100, width: 100 }],
      inputCount: 2,
      semanticTokens: ['alpha', 'beta', 'gamma'],
    }),
    page(),
    { referenceParity: true },
  );

  assert.deepEqual(result.failures, []);
  assert.equal(result.tokenCoverage, 1);
});

test('reference parity is explicit per smoke case', () => {
  assert.deepEqual(
    assessReferenceParity(page(), page(), { referenceParity: false }),
    { failures: [], skipped: true },
  );
});

test('an outcome keeps its own finding rather than collapsing into red or green', () => {
  assert.equal(classifySmokeOutcome([], 1_000), 'pass');
  assert.equal(
    classifySmokeOutcome(['authentication-required'], 1_000),
    'pre-routing-failure',
  );
  assert.equal(
    classifySmokeOutcome(['application-not-ready'], 1_000),
    'pre-routing-failure',
  );
  assert.equal(
    classifySmokeOutcome(['case-deadline-exceeded'], undefined),
    'pre-routing-failure',
  );
  assert.equal(
    classifySmokeOutcome(['fatal-card-error'], 1_000),
    'runtime-failure',
  );
  assert.equal(
    classifySmokeOutcome(['missing-semantic-text'], 1_000),
    'semantic-mismatch',
  );
  assert.equal(
    classifySmokeOutcome(['missing-required-selector'], 1_000),
    'capability-gap',
  );
  assert.equal(
    classifySmokeOutcome(['interaction-failed'], 1_000),
    'interaction-failure',
  );
});

test('a case that never reached routing is not reported as a semantic mismatch', () => {
  assert.equal(
    classifySmokeOutcome(
      ['authentication-required', 'missing-semantic-text', 'did-not-settle'],
      1_000,
    ),
    'pre-routing-failure',
  );
});

test('correct but slow output is its own status, distinct from passing', () => {
  assert.equal(classifySmokeOutcome([], 14_999), 'pass');
  assert.equal(classifySmokeOutcome([], 15_000), 'slow-but-correct');
  // A missing execution timing must never manufacture a slow verdict.
  assert.equal(classifySmokeOutcome([], undefined), 'pass');
});

test('the smoke summary preserves reference, execution, readiness, and diagnosis', () => {
  let referenceResult = {
    assessment: { failures: [], pass: true, status: 'pass' },
    id: 'alpha',
    page: {
      elapsedMs: 120,
      images: [{ complete: true, height: 100, width: 100 }],
      missingText: [],
      readiness: { applicationMs: 90, executionMs: 30 },
    },
  };
  let candidateResult = {
    assessment: { failures: [], pass: true, status: 'pass' },
    id: 'alpha',
    page: {
      elapsedMs: 80,
      executions: ['capsule'],
      images: [{ complete: true, height: 100, width: 100 }],
      readiness: { applicationMs: 60, executionMs: 20 },
      warmReadiness: { applicationMs: 30, executionMs: 10 },
    },
    referenceParity: { failures: [], tokenCoverage: 1 },
  };

  assert.deepEqual(
    summarizeExecutionRuntimeSmokeRun({
      candidate: { results: [candidateResult] },
      reference: { results: [referenceResult] },
    }),
    [
      {
        candidate: {
          elapsedMs: 80,
          executions: ['capsule'],
          failures: [],
          healthyImages: 1,
          parity: { failures: [], tokenCoverage: 1 },
          readiness: { applicationMs: 60, executionMs: 20 },
          status: 'pass',
          warmReadiness: { applicationMs: 30, executionMs: 10 },
        },
        diagnosis: 'pass',
        id: 'alpha',
        reference: {
          elapsedMs: 120,
          failures: [],
          healthyImages: 1,
          readiness: { applicationMs: 90, executionMs: 30 },
          signatureReady: true,
        },
      },
    ],
  );
});

test('execution stage summaries preserve tiers and calculate median and p95', () => {
  let result = (samples) => ({
    page: {
      executionPerformance: {
        droppedRecords: 0,
        records: samples.map((durationMs, index) => ({
          durationMs,
          occurrenceId: `surface:${index}`,
          operationId: `operation:${index}`,
          sequence: index + 1,
          stage: 'runtime-create',
          startedAt: 0,
          endedAt: durationMs,
          status: 'ok',
          tier: 'sandbox',
        })),
      },
    },
  });

  assert.deepEqual(summarizeExecutionStages([result([5, 10, 20, 40])]), {
    'sandbox:runtime-create': {
      medianMs: 20,
      p95Ms: 40,
      samples: 4,
    },
  });
});
