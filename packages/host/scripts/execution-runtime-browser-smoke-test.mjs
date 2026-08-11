import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assessReferenceParity,
  normalizeVisibleText,
  summarizeExecutionStages,
  summarizeExecutionRuntimeSmokeRun,
} from './execution-runtime-browser-smoke.mjs';
import {
  executionRuntimeWildCorpusCases,
  executionRuntimeWildUrlMatrix,
  validateWildCorpus,
} from './execution-runtime-wild-corpus.mjs';
import {
  executionRuntimeFileResearchCases,
  executionRuntimeFileTwinCases,
  executionRuntimeFileTwinUrlMatrix,
  executionRuntimeLiveFileCases,
  validateFileTwinCorpus,
} from './execution-runtime-file-twin-corpus.mjs';

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
    assert.equal(new URL(entry.candidateUrl).origin, 'https://localhost:4200');
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

test('the FileTwin lane covers every persisted format and lifecycle twin', () => {
  assert.doesNotThrow(() =>
    validateFileTwinCorpus(executionRuntimeFileTwinCases),
  );
  assert.equal(executionRuntimeFileTwinCases.length, 27);
  assert.equal(
    new Set(executionRuntimeFileTwinCases.map(({ id }) => id)).size,
    27,
  );
  assert.equal(executionRuntimeFileTwinUrlMatrix.length, 27);

  for (let entry of executionRuntimeFileTwinUrlMatrix) {
    assert.equal(
      new URL(entry.referenceUrl).pathname,
      new URL(entry.candidateUrl).pathname,
    );
    assert.equal(
      new URL(entry.referenceUrl).origin,
      'https://realms-staging.stack.cards',
    );
    assert.equal(
      new URL(entry.candidateUrl).origin,
      'https://host.codex-execution-runtime.localhost',
    );
    assert.equal(entry.sourceUrl.endsWith('/file-twin.gts'), true);
  }

  assert.deepEqual(
    [
      ...new Set(executionRuntimeFileTwinCases.map(({ state }) => state)),
    ].sort(),
    [
      'empty',
      'failed',
      'generating',
      'loading',
      'malformed',
      'normal',
      'stale',
      'unsupported',
    ],
  );
  assert.ok(
    new Set(executionRuntimeFileTwinCases.map(({ family }) => family)).size >=
      12,
  );
  assert.ok(
    executionRuntimeFileTwinCases.every(
      ({ expectedExecution }) => expectedExecution === 'sandbox',
    ),
  );
});

test('the FileDef research lane covers every live adapter without changing the immutable twin inventory', () => {
  assert.equal(executionRuntimeFileTwinCases.length, 27);
  assert.equal(executionRuntimeLiveFileCases.length, 17);
  assert.equal(executionRuntimeFileResearchCases.length, 44);
  assert.equal(
    new Set(executionRuntimeLiveFileCases.map(({ path }) => path)).size,
    17,
  );
  assert.ok(
    executionRuntimeLiveFileCases.every(
      ({ expectedExecution, referenceParity }) =>
        expectedExecution === 'sandbox' && referenceParity,
    ),
  );
  assert.deepEqual(
    executionRuntimeLiveFileCases.find(({ id }) => id === 'live-midi-prelude'),
    {
      id: 'live-midi-prelude',
      path: '/ctse/filedef-format-research/live/live-midi-prelude',
      expectedExecution: 'sandbox',
      mustContain: [
        'beethoven-egmont-overture.mid',
        '14 tracks',
        '10681 notes',
        '7:59',
      ],
      interaction: {
        kind: 'media-play',
        playName: 'Play MIDI sequence',
        pauseName: 'Pause MIDI sequence',
        requireProgress: true,
      },
      purpose:
        'authenticated resourceUrl projection, MIDI parsing, Web Audio unlock, and a live playback clock',
      referenceParity: true,
    },
  );
  assert.deepEqual(
    executionRuntimeLiveFileCases
      .filter(({ requiredSelectors }) => requiredSelectors)
      .map(({ id }) => id),
    [
      'live-annual-report-2025',
      'live-cardstack-mark',
      'live-chair-lounge',
      'live-ep-114-systems',
      'live-harbor-at-dawn',
      'live-loading-loop',
      'live-master-take-3',
      'live-product-tour-v2',
      'live-q4-revenue',
    ],
  );
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

test('the smoke summary preserves reference, execution, and diagnosis', () => {
  let referenceResult = {
    assessment: { failures: [], pass: true },
    id: 'alpha',
    page: {
      elapsedMs: 120,
      images: [{ complete: true, height: 100, width: 100 }],
      missingText: [],
    },
  };
  let candidateResult = {
    assessment: { failures: [], pass: true },
    id: 'alpha',
    page: {
      elapsedMs: 80,
      executions: ['capsule'],
      images: [{ complete: true, height: 100, width: 100 }],
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
        },
        diagnosis: 'pass',
        id: 'alpha',
        reference: {
          elapsedMs: 120,
          failures: [],
          healthyImages: 1,
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
