/**
 * Control-flow tests for the browser smoke runner.
 *
 * These drive the runner against a fake browser handle rather than a real one.
 * The three properties under test — per-case persistence, per-case
 * cancellation, and the two-part readiness record — are exactly the properties
 * that only matter during a long unsupervised batch, which is when nobody is
 * watching and a real browser is the least available thing to test against.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runExecutionRuntimeCandidateSmoke } from './execution-runtime-browser-smoke.mjs';

const HOST_CHROME = {
  '.new-file-dropdown-trigger': 'rgb(0, 255, 186)',
  '.submode-switcher-dropdown-trigger': 'rgb(0, 0, 0)',
};

/**
 * A DOM stand-in answering only the selectors the runner actually asks for.
 *
 * Anything unlisted answers empty, which is what the runner treats as absent.
 * Keeping it selector-shaped rather than tree-shaped means a runner change
 * that asks a new question fails loudly here instead of silently reading a
 * default.
 */
function fakeDocument({ text = '', headings = [], mounted = true } = {}) {
  let element = (name) => ({
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 400, width: 800 }),
    textContent: name,
  });
  let cardSelectors = [
    '[data-boxel-card-id], [data-boxel-card-container], .boxel-card-container',
    '[data-boxel-card-id], [data-boxel-card-container], .boxel-card-container, [aria-label="Loading card"]',
    '[data-boxel-card-id], [data-boxel-card-container]',
  ];
  let bySelector = new Map(
    cardSelectors.map((selector) => [
      selector,
      mounted ? [element('card')] : [],
    ]),
  );
  for (let selector of Object.keys(HOST_CHROME)) {
    bySelector.set(selector, [element(selector)]);
  }
  bySelector.set(
    'h1,h2,h3',
    headings.map((heading) => element(heading)),
  );

  return {
    body: { innerText: text },
    documentElement: { scrollHeight: 400 },
    images: [],
    querySelector: (selector) => bySelector.get(selector)?.[0] ?? null,
    querySelectorAll: (selector) => bySelector.get(selector) ?? [],
    title: 'fake',
  };
}

/**
 * @param {object} options
 * @param {(caseIndex: number) => object} options.documentFor page state per case
 * @param {number} [options.hangOnCase] index whose page work never resolves
 */
function fakeTab({ documentFor, hangOnCase }) {
  let navigations = [];
  let currentUrl = 'about:blank';
  let caseIndex = -1;

  async function withGlobals(run) {
    if (caseIndex === hangOnCase) {
      await new Promise(() => {});
    }
    let previous = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
    };
    globalThis.document = documentFor(caseIndex);
    globalThis.getComputedStyle = (target) => ({
      backgroundColor: HOST_CHROME[target.textContent] ?? 'rgb(1, 1, 1)',
      overflowY: 'auto',
    });
    try {
      return await run();
    } finally {
      globalThis.document = previous.document;
      globalThis.getComputedStyle = previous.getComputedStyle;
    }
  }

  return {
    navigations,
    startCase(index) {
      caseIndex = index;
    },
    async url() {
      return currentUrl;
    },
    async goto(url) {
      navigations.push(url);
      currentUrl = url;
    },
    dev: { logs: async () => [] },
    playwright: {
      evaluate: (fn, argument) => withGlobals(() => fn(argument)),
      waitForLoadState: async () => {},
      waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  };
}

function smokeCase(id, signature) {
  return {
    id,
    path: `/example-account/example-realm/Example/${id}`,
    expectedExecution: 'discover',
    mustContain: [signature],
    purpose: `fake case ${id}`,
  };
}

async function runFake({ cases, documentFor, hangOnCase, caseTimeoutMs }) {
  let tab = fakeTab({ documentFor, hangOnCase });
  let persisted = [];
  // The runner does not know about case indices; the fake follows along by
  // watching which case each persisted result belongs to.
  let index = 0;
  tab.startCase(index);
  let run = await runExecutionRuntimeCandidateSmoke({
    browser: {},
    candidateTab: tab,
    candidateOrigin: 'https://localhost:4200',
    caseTimeoutMs,
    cases,
    onCaseComplete: async (result) => {
      persisted.push(result);
      tab.startCase(++index);
    },
    timeoutMs: 2_000,
  });
  return { persisted, run, tab };
}

test('every case is persisted as it completes, not held until the batch ends', async () => {
  let cases = [
    smokeCase('one', 'Alpha'),
    smokeCase('two', 'Beta'),
    smokeCase('three', 'Gamma'),
  ];
  let signatures = ['Alpha', 'Beta', 'Gamma'];
  let { persisted, run } = await runFake({
    cases,
    documentFor: (index) =>
      fakeDocument({ headings: ['h'], text: signatures[index] ?? '' }),
  });

  assert.deepEqual(
    persisted.map((result) => result.id),
    ['one', 'two', 'three'],
  );
  assert.deepEqual(
    run.candidate.results.map((result) => result.assessment.status),
    ['pass', 'pass', 'pass'],
  );
});

test('a persistence failure is recorded against the run and never discards a result', async () => {
  let tab = fakeTab({
    documentFor: () => fakeDocument({ headings: ['h'], text: 'Alpha' }),
  });
  let run = await runExecutionRuntimeCandidateSmoke({
    browser: {},
    candidateTab: tab,
    candidateOrigin: 'https://localhost:4200',
    cases: [smokeCase('one', 'Alpha')],
    onCaseComplete: () => {
      throw new Error('disk full');
    },
    timeoutMs: 2_000,
  });

  assert.equal(run.candidate.results.length, 1);
  assert.equal(run.candidate.results[0].assessment.pass, true);
  assert.equal(run.candidate.persistenceErrors.length, 1);
  assert.match(run.candidate.persistenceErrors[0].error, /disk full/);
});

test('a case that exceeds its bound is cut loose and the batch continues', async () => {
  let cases = [smokeCase('slow', 'Alpha'), smokeCase('fast', 'Beta')];
  let signatures = ['Alpha', 'Beta'];
  let { persisted, run, tab } = await runFake({
    caseTimeoutMs: 1_500,
    cases,
    documentFor: (index) =>
      fakeDocument({ headings: ['h'], text: signatures[index] ?? '' }),
    hangOnCase: 0,
  });

  assert.deepEqual(
    persisted.map((result) => result.id),
    ['slow', 'fast'],
  );
  assert.deepEqual(run.candidate.results[0].assessment.failures, [
    'case-deadline-exceeded',
  ]);
  assert.equal(
    run.candidate.results[0].assessment.status,
    'pre-routing-failure',
  );
  assert.equal(run.candidate.results[1].assessment.pass, true);
  // The abandoned page work is detached before the next case observes the tab.
  assert.ok(tab.navigations.includes('about:blank'));
  assert.ok(
    tab.navigations.indexOf('about:blank') <
      tab.navigations.findIndex((url) => url.endsWith('/fast')),
  );
});

test('a bounded case does not poison the following case with its own status', async () => {
  let { run } = await runFake({
    caseTimeoutMs: 1_500,
    cases: [smokeCase('slow', 'Alpha'), smokeCase('fast', 'Beta')],
    documentFor: () => fakeDocument({ headings: ['h'], text: 'Beta' }),
    hangOnCase: 0,
  });

  assert.equal(run.status, 'candidate-regression');
  assert.equal(run.candidate.results[1].assessment.failures.length, 0);
});

test('readiness is recorded as application and execution parts, not one total', async () => {
  let { run } = await runFake({
    cases: [smokeCase('one', 'Alpha')],
    documentFor: () => fakeDocument({ headings: ['h'], text: 'Alpha' }),
  });

  let { readiness, elapsedMs } = run.candidate.results[0].page;
  assert.equal(typeof readiness.applicationMs, 'number');
  assert.equal(typeof readiness.executionMs, 'number');
  // Both parts are measured inside the navigation, so neither can exceed it.
  assert.ok(readiness.applicationMs <= elapsedMs);
  assert.ok(readiness.executionMs <= elapsedMs);
});

test('a Host that never mounts is a pre-routing finding, not a semantic one', async () => {
  let { run } = await runFake({
    cases: [smokeCase('one', 'Alpha')],
    documentFor: () => fakeDocument({ mounted: false, text: '' }),
  });

  let { assessment } = run.candidate.results[0];
  assert.ok(assessment.failures.includes('application-not-ready'));
  assert.equal(assessment.status, 'pre-routing-failure');
});
