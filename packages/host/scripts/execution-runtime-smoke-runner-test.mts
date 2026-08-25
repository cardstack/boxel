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

import {
  APPLICATION_READY_SELECTOR,
  CARD_SURFACE_SELECTOR,
  leaseTab,
  runExecutionRuntimeCandidateSmoke,
} from './execution-runtime-browser-smoke.mts';

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
    CARD_SURFACE_SELECTOR,
    APPLICATION_READY_SELECTOR,
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
 * @param {number} [options.hangOnCase] index whose page work stalls
 * @param {number} [options.stallMs] how long that stall lasts; omit for forever.
 *   A finite stall models the case the deadline exists for: work that outlives
 *   its bound and then wakes up while a later case owns the tab.
 */
function fakeTab({ documentFor, hangOnCase, stallMs }) {
  let navigations = [];
  let currentUrl = 'about:blank';
  let caseIndex = -1;

  async function withGlobals(run) {
    if (caseIndex === hangOnCase) {
      await new Promise((resolve) =>
        stallMs === undefined ? undefined : setTimeout(resolve, stallMs),
      );
    }
    let previous = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      window: globalThis.window,
    };
    globalThis.document = documentFor(caseIndex);
    // The runner reads the page's performance diagnostics through `window`
    // when a caller asks for warm samples. A page that carries no diagnostics
    // is the ordinary case, so the stub simply has none.
    globalThis.window = { innerHeight: 800, scrollX: 0, scrollY: 0 };
    globalThis.getComputedStyle = (target) => ({
      backgroundColor: HOST_CHROME[target.textContent] ?? 'rgb(1, 1, 1)',
      overflowY: 'auto',
    });
    try {
      return await run();
    } finally {
      globalThis.document = previous.document;
      globalThis.getComputedStyle = previous.getComputedStyle;
      globalThis.window = previous.window;
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

async function runFake({
  cases,
  documentFor,
  hangOnCase,
  caseTimeoutMs,
  performanceRepeats,
  stallMs,
}) {
  let tab = fakeTab({ documentFor, hangOnCase, stallMs });
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
    performanceRepeats,
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

test('a case that throws in an unexpected place does not take the batch with it', async () => {
  let tab = fakeTab({
    documentFor: () => fakeDocument({ headings: ['h'], text: 'Beta' }),
  });
  let originalGoto = tab.goto;
  let first = true;
  tab.goto = async (url) => {
    if (first && url.endsWith('/boom')) {
      first = false;
      throw new Error('navigation exploded');
    }
    return originalGoto(url);
  };
  let persisted = [];
  let run = await runExecutionRuntimeCandidateSmoke({
    browser: {},
    candidateTab: tab,
    candidateOrigin: 'https://localhost:4200',
    cases: [smokeCase('boom', 'Alpha'), smokeCase('fine', 'Beta')],
    onCaseComplete: (result) => persisted.push(result.id),
    timeoutMs: 2_000,
  });

  assert.deepEqual(persisted, ['boom', 'fine']);
  assert.deepEqual(run.candidate.results[0].assessment.failures, [
    'browser-probe-error',
  ]);
  assert.match(
    run.candidate.results[0].page.runnerError,
    /navigation exploded/,
  );
  assert.equal(run.candidate.results[1].assessment.pass, true);
});

test('a revoked lease refuses every further operation, however deeply reached', async () => {
  let clicks = [];
  let realTab = {
    goto: async (url) => clicks.push(`goto:${url}`),
    playwright: {
      evaluate: async () => 'read',
      getByRole: (role) => ({
        click: async () => clicks.push(`click:${role}`),
      }),
    },
  };
  let { revoke, tab } = leaseTab(realTab);

  // Before revocation the lease is transparent.
  assert.equal(await tab.playwright.evaluate(), 'read');
  // A handle taken before revocation is the dangerous case: the abandoned
  // coroutine is usually already holding one.
  let buttonHeldFromBefore = tab.playwright.getByRole('button');
  await buttonHeldFromBefore.click();
  assert.deepEqual(clicks, ['click:button']);

  revoke();

  await assert.rejects(
    async () => tab.goto('https://localhost:4200/anything'),
    /cut loose/,
  );
  await assert.rejects(async () => tab.playwright.evaluate(), /cut loose/);
  await assert.rejects(async () => buttonHeldFromBefore.click(), /cut loose/);
  assert.deepEqual(
    clicks,
    ['click:button'],
    'a revoked lease let an operation through',
  );
  // The underlying tab is untouched and still usable by whoever owns it next.
  await realTab.goto('https://localhost:4200/next-case');
  assert.deepEqual(clicks, [
    'click:button',
    'goto:https://localhost:4200/next-case',
  ]);
});

test('a case cut loose by the deadline leaves the batch able to continue', async () => {
  // The stall outlives the bound and then wakes up, which is exactly the
  // situation the bound exists for: the abandoned coroutine resumes while the
  // next case is reading the same tab.
  let { run, tab } = await runFake({
    caseTimeoutMs: 900,
    cases: [smokeCase('abandoned', 'Alpha'), smokeCase('next', 'Beta')],
    documentFor: () => fakeDocument({ headings: ['h'], text: 'Beta' }),
    hangOnCase: 0,
    stallMs: 1_200,
  });

  assert.equal(
    run.candidate.results[0].assessment.status,
    'pre-routing-failure',
  );
  assert.equal(run.candidate.results[1].assessment.pass, true);
  // Whether the abandoned work can still reach the tab is the lease's
  // guarantee, pinned directly above; here the point is only that the batch
  // survives and the next case is measured on its own terms.
  let blankAt = tab.navigations.indexOf('about:blank');
  let nextAt = tab.navigations.findIndex((url) => url.endsWith('/next'));
  assert.ok(blankAt >= 0 && nextAt > blankAt);
});

test('each warm sample is a real navigation, not a re-read of the same document', async () => {
  let { run, tab } = await runFake({
    cases: [smokeCase('one', 'Alpha')],
    documentFor: () => fakeDocument({ headings: ['h'], text: 'Alpha' }),
    performanceRepeats: 2,
  });

  let cardUrl = (url) => new URL(url).pathname.endsWith('/one');
  // One cold navigation plus one per warm repeat. A warm sample that skipped
  // the navigation would measure re-reading an already-rendered document.
  assert.equal(
    tab.navigations.filter(cardUrl).length,
    3,
    `expected 3 navigations to the card, saw: ${tab.navigations.join(', ')}`,
  );
  assert.equal(run.candidate.results[0].page.warmSamplesMs.length, 2);
});
