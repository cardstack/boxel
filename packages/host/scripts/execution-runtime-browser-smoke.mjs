/**
 * Commit-group browser smoke test for the Boxel execution runtime.
 *
 * This module deliberately does not launch Playwright. It is imported by the
 * Codex in-app-browser runtime and receives that browser handle, so the smoke
 * test runs in the same real, signed-in browser surface used for manual
 * product verification.
 */

const DEFAULT_REFERENCE_ORIGIN = 'https://realms-staging.stack.cards';

const FATAL_TEXT = [
  'Unable to render this card',
  'Cannot load card',
  'This card contains an error',
  'RUNTIME ERROR',
  'SYNTAX ERROR',
];

const FATAL_SANDBOX_LOG_TEXT = [
  'Timed out connecting to the Sandbox child',
  'render acked but produced no visible output',
];

export const executionRuntimeSmokeCases = [
  {
    id: 'release-composition',
    path: '/ctse/execution-runtime-suite/Release/opening-night',
    expectedExecution: 'capsule',
    mustContain: [
      'Opening Night',
      '18446744073709551617',
      'Marguerite Vance',
      '$24.00',
      'Catalogue readiness',
    ],
    minimumHeadings: 8,
    interaction: {
      kind: 'edit-scroll',
      expectedExecution: 'direct',
    },
    visual: true,
    purpose:
      'Deep authored composition through trusted Base portals, Guide, theme, relationships, and computed values.',
  },
  {
    id: 'nested-field-default-edit',
    path: '/ctse/sandbox-compatibility-corpus-20260803/NestedFieldHost/sample',
    expectedExecution: 'capsule',
    mustContain: ['Northlight Test Kitchen', '18 Orchard Lane', 'Hudson, NY'],
    minimumHeadings: 1,
    interaction: {
      kind: 'default-edit',
      expectedValues: [
        'Northlight Test Kitchen',
        '18 Orchard Lane',
        'Hudson',
        'NY',
      ],
      textEntryValue: 'Northlight Test Kitchen',
    },
    purpose:
      'Capsule isolated rendering followed by the trusted Direct default edit template and nested FieldDef controls.',
  },
  {
    id: 'rich-markdown-graph',
    path: '/ctse/sandbox-compatibility-corpus-20260803/MarkdownArticle/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'The boundary should disappear',
      'Inline and block card formats',
      'Harbor relay 7',
      'Diagram',
      'Footnotes',
    ],
    minimumHeadings: 10,
    minimumHealthyImages: 1,
    purpose:
      'Trusted Rich Markdown portal with linked cards rendered at atom, embedded, fitted, and isolated formats.',
  },
  {
    id: 'computed-flight-projection',
    path: '/ctse/sandbox-compatibility-corpus-20260803/ComputedFlightPlan/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'BX4500 · ORD → LHR',
      '$21,406',
      '$119345.79999999999',
      '$943639.2',
      '88.8%',
      'MARGIN',
    ],
    minimumHeadings: 4,
    purpose:
      'Deep computed and BXL-shaped projection across nested FieldDefs with scoped CSS and theme presentation.',
  },
  {
    id: 'sandbox-media-player',
    path: '/ctse/execution-runtime-suite/Track/corridor-take-one',
    expectedExecution: 'sandbox',
    mustContain: [
      'Corridor, Take One',
      'corridor-take-one.mp3',
      'audio/mpeg',
      '0:18',
    ],
    minimumHeadings: 2,
    // Count authored images only. Host chrome (the realm icon) stays outside
    // the cross-origin document and must not inflate this assertion.
    minimumHealthyImages: 1,
    minimumInputs: 2,
    interaction: { kind: 'media-play' },
    visual: true,
    purpose:
      'Browser-dependent media renderer, real iframe lifecycle, image delivery, controls, and user input.',
  },
  {
    id: 'poster-board-layout',
    path: '/ctse/sandbox-compatibility-corpus-20260803/PosterBoard/sample',
    expectedExecution: 'sandbox',
    mustContain: [
      'After Dark',
      'x1 y1 · 5×3',
      'Signal bloom',
      'x7 y1 · 6×4',
      'Last bowls',
    ],
    minimumHeadings: 4,
    minimumHealthyImages: 1,
    interaction: {
      kind: 'edit-scroll',
      expectedExecution: 'direct',
    },
    purpose:
      'Surface layout coordinates, image projection, and poster composition; dynamic inline geometry remains Sandbox-only until surfaceStyle ships.',
  },
];

function urlFor(origin, path) {
  return `${origin.replace(/\/$/, '')}${path}`;
}

async function settle(tab, expectedText, timeoutMs) {
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = await tab.playwright.evaluate(
      ({ expectedText, fatalText }) => {
        let text = document.body?.innerText ?? '';
        let normalizedText = text.toLocaleLowerCase();
        return {
          fatal: fatalText.some((value) => text.includes(value)),
          ready:
            expectedText.every((value) =>
              normalizedText.includes(value.toLocaleLowerCase()),
            ) && text.trim() !== 'Loading…',
          signIn: text.includes('Sign in to your Boxel Account'),
        };
      },
      { expectedText, fatalText: FATAL_TEXT },
    );
    if (state.ready || state.fatal || state.signIn) {
      return state;
    }
    await tab.playwright.waitForTimeout(250);
  }
  return { fatal: false, ready: false, signIn: false };
}

async function settleSandboxHandoff(tab, timeoutMs) {
  let startedAt = performance.now();
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = await tab.playwright.evaluate((fatalText) => {
      let text = document.body?.innerText ?? '';
      return {
        booting: Boolean(
          document.querySelector('[aria-label="Loading interactive card"]'),
        ),
        fatal: fatalText.some((value) => text.includes(value)),
        signIn: text.includes('Sign in to your Boxel Account'),
      };
    }, FATAL_TEXT);
    if (!state.booting || state.fatal || state.signIn) {
      return {
        ...state,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    }
    await tab.playwright.waitForTimeout(100);
  }
  return {
    booting: true,
    elapsedMs: Math.round(performance.now() - startedAt),
    fatal: false,
    signIn: false,
  };
}

async function probe(tab, smokeCase, origin, timeoutMs, checkExecution) {
  let url = urlFor(origin, smokeCase.path);
  let startedAt = performance.now();
  await tab.goto(url);
  await tab.playwright.waitForLoadState({
    state: 'domcontentloaded',
    timeoutMs,
  });
  let settled = await settle(tab, smokeCase.mustContain, timeoutMs);
  // The prerender placeholder deliberately contains the same semantic text
  // as the live Sandbox child. Text parity therefore proves only that the
  // fast placeholder worked, not that the iframe booted or became
  // interactive. Candidate Sandbox cases must cross that second barrier
  // before we inspect controls or run an interaction.
  let sandboxHandoff =
    checkExecution && smokeCase.expectedExecution === 'sandbox'
      ? await settleSandboxHandoff(tab, timeoutMs)
      : undefined;
  let result = await tab.playwright.evaluate(
    ({ expectedText, fatalText }) => {
      let text = document.body?.innerText ?? '';
      let normalizedText = text.toLocaleLowerCase();
      let headings = [...document.querySelectorAll('h1,h2,h3')]
        .map((element) => element.textContent?.trim())
        .filter(Boolean);
      let images = [...document.images].map((image) => ({
        alt: image.alt,
        complete: image.complete,
        height: image.naturalHeight,
        width: image.naturalWidth,
      }));
      let executionSlots = [
        ...document.querySelectorAll('[data-boxel-execution]'),
      ]
        .map((element) => ({
          mode: element.getAttribute('data-boxel-execution'),
          reason: element.getAttribute('data-boxel-execution-reason'),
        }))
        .filter((value) => value.mode && value.mode !== 'prerender');
      let card = document.querySelector(
        '[data-boxel-card-id], [data-boxel-card-container]',
      );
      let cardRect = card?.getBoundingClientRect();
      let submode = document.querySelector(
        '.submode-switcher-dropdown-trigger',
      );
      let newFile = document.querySelector('.new-file-dropdown-trigger');
      return {
        cardRect: cardRect
          ? { height: cardRect.height, width: cardRect.width }
          : null,
        executionReasons: [
          ...new Set(executionSlots.map((slot) => slot.reason).filter(Boolean)),
        ],
        executions: [
          ...new Set(executionSlots.map((slot) => slot.mode).filter(Boolean)),
        ],
        fatalText: fatalText.filter((value) => text.includes(value)),
        headingCount: headings.length,
        headings,
        hostChrome: {
          newFileBackground: newFile
            ? getComputedStyle(newFile).backgroundColor
            : null,
          submodeBackground: submode
            ? getComputedStyle(submode).backgroundColor
            : null,
        },
        imageCount: images.length,
        images,
        inputCount: document.querySelectorAll(
          'input, textarea, select, [contenteditable="true"]',
        ).length,
        missingText: expectedText.filter(
          (value) => !normalizedText.includes(value.toLocaleLowerCase()),
        ),
        signIn: text.includes('Sign in to your Boxel Account'),
        sandboxBooting: Boolean(
          document.querySelector('[aria-label="Loading interactive card"]'),
        ),
        textSample: text.replace(/\s+/g, ' ').slice(0, 600),
        title: document.title,
      };
    },
    { expectedText: smokeCase.mustContain, fatalText: FATAL_TEXT },
  );
  if (
    checkExecution &&
    smokeCase.expectedExecution === 'sandbox' &&
    !sandboxHandoff?.booting &&
    !sandboxHandoff?.fatal &&
    !sandboxHandoff?.signIn
  ) {
    let frame = tab.playwright.frameLocator('iframe.boxel-sandbox-process');
    let frameText = await frame.locator('body').innerText({ timeoutMs });
    let normalizedFrameText = frameText.toLocaleLowerCase();
    let frameHeadings = await frame
      .locator('h1,h2,h3')
      .allTextContents({ timeoutMs });
    let frameImages = await frame.locator('img').evaluateAll((images) =>
      images.map((image) => ({
        alt: image.alt,
        complete: image.complete,
        height: image.naturalHeight,
        width: image.naturalWidth,
      })),
    );
    let frameCardRect = await frame.locator('main').evaluate((element) => {
      let rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    });
    result = {
      ...result,
      cardRect: frameCardRect,
      fatalText: FATAL_TEXT.filter((value) => frameText.includes(value)),
      headingCount: frameHeadings.length,
      headings: frameHeadings,
      imageCount: frameImages.length,
      images: frameImages,
      inputCount: await frame
        .locator('input, textarea, select, [contenteditable="true"]')
        .count(),
      missingText: smokeCase.mustContain.filter(
        (value) => !normalizedFrameText.includes(value.toLocaleLowerCase()),
      ),
      textSample: frameText.replace(/\s+/g, ' ').slice(0, 600),
    };
  }
  return {
    ...result,
    elapsedMs: Math.round(performance.now() - startedAt),
    ready: settled.ready,
    sandboxHandoff,
    url: await tab.url(),
  };
}

async function runInteraction(tab, smokeCase, timeoutMs, checkExecution) {
  if (!smokeCase.interaction) {
    return { pass: true, skipped: true };
  }
  async function enterEdit() {
    await tab.playwright
      .getByRole('button', { exact: true, name: 'Edit' })
      .click({ force: true, timeoutMs });
    await tab.playwright
      .getByRole('button', { exact: true, name: 'Finish Editing' })
      .waitFor({ state: 'visible', timeoutMs });
  }

  async function executionModes() {
    return tab.playwright.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[data-boxel-execution]')]
          .map((element) => element.getAttribute('data-boxel-execution'))
          .filter((value) => value && value !== 'prerender'),
      ),
    ]);
  }

  if (smokeCase.interaction.kind === 'default-edit') {
    await enterEdit();
    let values = await tab.playwright.evaluate(() =>
      [...document.querySelectorAll('input, textarea')]
        .map((element) => element.value)
        .filter(Boolean),
    );
    let missingValues = smokeCase.interaction.expectedValues.filter(
      (value) => !values.includes(value),
    );
    let textEntry;
    if (smokeCase.interaction.textEntryValue) {
      let original = smokeCase.interaction.textEntryValue;
      let inputs = tab.playwright.locator('input, textarea');
      let inputIndex = await inputs.evaluateAll(
        (elements, expected) =>
          elements.findIndex((element) => element.value === expected),
        original,
      );
      if (inputIndex >= 0) {
        let input = inputs.nth(inputIndex);
        let sentinel = `${original} [browser smoke]`;
        // This is intentionally a real browser fill, not a direct property
        // assignment. Wait for the intermediate autosave to settle before
        // restoring the shared corpus fixture; otherwise two writes can race
        // and leave the reference card containing the smoke-test sentinel.
        let accepted;
        let restored;
        try {
          await input.fill(sentinel, { timeoutMs });
          accepted = await input.evaluate((element) => element.value);
          await tab.playwright.waitForTimeout(2500);
        } finally {
          await input.fill(original, { timeoutMs });
          await tab.playwright.waitForTimeout(5000);
          restored = await input.evaluate((element) => element.value);
        }
        textEntry = {
          accepted: accepted === sentinel,
          restored: restored === original,
        };
      } else {
        textEntry = { accepted: false, restored: false };
      }
    }
    let executions = await executionModes();
    return {
      executions,
      kind: 'default-edit',
      missingValues,
      pass:
        missingValues.length === 0 &&
        (!textEntry || (textEntry.accepted && textEntry.restored)) &&
        (!checkExecution || executions.includes('direct')),
      textEntry,
      values,
    };
  }
  if (smokeCase.interaction.kind === 'edit-scroll') {
    await enterEdit();
    let scrollRoot = tab.playwright.locator(
      '.boxel-card-container.edit-format',
    );
    let scroll = await scrollRoot.evaluate((element) => {
      let overflowY = getComputedStyle(element).overflowY;
      let maximum = element.scrollHeight - element.clientHeight;
      let rect = element.getBoundingClientRect();
      return {
        clientHeight: element.clientHeight,
        maximum,
        overflowY,
        point: {
          x: Math.max(rect.left + 8, Math.min(rect.right - 8, rect.left + 40)),
          y: Math.max(
            rect.top + 8,
            Math.min(rect.bottom - 8, window.innerHeight / 2),
          ),
        },
        scrollHeight: element.scrollHeight,
      };
    });
    if (scroll) {
      // Exercise the actual wheel path at a point inside the card, not a
      // synthetic scrollTop assignment. This catches lost overflow/layout
      // attributes even when programmatic scrolling would still be allowed.
      await tab.cua.scroll({
        scrollX: 0,
        scrollY: Math.min(scroll.maximum, 900),
        x: scroll.point.x,
        y: scroll.point.y,
      });
      await tab.playwright.waitForTimeout(250);
      scroll.reached = await scrollRoot.evaluate(
        (element) => element.scrollTop,
      );
      await tab.cua.scroll({
        scrollX: 0,
        scrollY: -scroll.reached,
        x: scroll.point.x,
        y: scroll.point.y,
      });
    }
    let executions = await executionModes();
    let expectedExecution = smokeCase.interaction.expectedExecution;
    return {
      executions,
      kind: 'edit-scroll',
      pass:
        Boolean(
          scroll &&
          ['auto', 'scroll'].includes(scroll.overflowY) &&
          scroll.maximum > 100 &&
          scroll.reached > 100,
        ) &&
        (!checkExecution ||
          !expectedExecution ||
          executions.includes(expectedExecution)),
      scroll,
    };
  }
  if (smokeCase.interaction.kind === 'media-play') {
    // Once a Sandbox is interactive its prerender placeholder is gone, so
    // the control lives only in the cross-origin child. Frame-scoping this
    // action is intentional: clicking a same-looking placeholder control
    // would be a false positive for the exact capability being tested.
    let interactionRoot =
      checkExecution && smokeCase.expectedExecution === 'sandbox'
        ? tab.playwright.frameLocator('iframe.boxel-sandbox-process')
        : tab.playwright;
    let play = interactionRoot.getByRole('button', {
      exact: true,
      name: 'Play',
    });
    await play.click({ timeoutMs });
    await tab.playwright.waitForTimeout(500);
    let pauseVisible = await interactionRoot
      .getByRole('button', { exact: true, name: 'Pause' })
      .isVisible();
    return { kind: 'media-play', pass: pauseVisible, pauseVisible };
  }
  throw new Error(`Unknown smoke interaction: ${smokeCase.interaction.kind}`);
}

function assess(probeResult, interaction, smokeCase, checkExecution) {
  let healthyImages = probeResult.images.filter(
    (image) => image.complete && image.width > 0 && image.height > 0,
  ).length;
  let failures = [];
  if (probeResult.signIn) failures.push('authentication-required');
  if (!probeResult.ready) failures.push('did-not-settle');
  if (probeResult.fatalText.length) failures.push('fatal-card-error');
  if (probeResult.missingText.length) failures.push('missing-semantic-text');
  if (probeResult.headingCount < (smokeCase.minimumHeadings ?? 0)) {
    failures.push('missing-heading-structure');
  }
  if (healthyImages < (smokeCase.minimumHealthyImages ?? 0)) {
    failures.push('missing-or-broken-image');
  }
  if (probeResult.inputCount < (smokeCase.minimumInputs ?? 0)) {
    failures.push('missing-interactive-control');
  }
  if (
    !probeResult.cardRect ||
    probeResult.cardRect.width === 0 ||
    probeResult.cardRect.height === 0
  ) {
    failures.push('blank-card-slot');
  }
  if (
    checkExecution &&
    !probeResult.executions.includes(smokeCase.expectedExecution)
  ) {
    failures.push('wrong-execution-tier');
  }
  if (
    checkExecution &&
    smokeCase.expectedExecution === 'sandbox' &&
    probeResult.sandboxBooting
  ) {
    failures.push('sandbox-not-interactive');
  }
  if (!interaction.pass) failures.push('interaction-failed');
  if (
    probeResult.hostChrome.submodeBackground !== 'rgb(0, 0, 0)' ||
    probeResult.hostChrome.newFileBackground !== 'rgb(0, 255, 186)'
  ) {
    failures.push('host-chrome-style-drift');
  }
  return { failures, pass: failures.length === 0 };
}

async function auditSandboxLifecycle(tab, smokeCases) {
  if (
    !smokeCases.some((smokeCase) => smokeCase.expectedExecution === 'sandbox')
  ) {
    return { failures: [], matchingLogs: [] };
  }
  let logs = await tab.dev.logs();
  let matchingLogs = logs
    .map((entry) => JSON.stringify(entry))
    .filter((entry) =>
      FATAL_SANDBOX_LOG_TEXT.some((fatalText) => entry.includes(fatalText)),
    );
  return {
    failures: matchingLogs.length ? ['sandbox-lifecycle-log-failure'] : [],
    matchingLogs,
  };
}

async function runOrigin(browser, origin, smokeCases, options) {
  let tab = await browser.tabs.new();
  let results = [];
  for (let smokeCase of smokeCases) {
    let page;
    try {
      page = await probe(
        tab,
        smokeCase,
        origin,
        options.timeoutMs,
        options.checkExecution,
      );
    } catch (error) {
      results.push({
        id: smokeCase.id,
        page: {
          elapsedMs: null,
          runnerError:
            error instanceof Error
              ? (error.stack ?? error.message)
              : `${error}`,
          url: await tab.url(),
        },
        assessment: {
          failures: ['browser-probe-error'],
          pass: false,
        },
        interaction: { pass: false, skipped: true },
      });
      break;
    }
    if (page.signIn) {
      results.push({
        id: smokeCase.id,
        page,
        assessment: {
          failures: ['authentication-required'],
          pass: false,
        },
        interaction: { pass: false, skipped: true },
      });
      break;
    }
    let interaction;
    try {
      interaction = await runInteraction(
        tab,
        smokeCase,
        options.timeoutMs,
        options.checkExecution,
      );
    } catch (error) {
      interaction = {
        error:
          error instanceof Error ? (error.stack ?? error.message) : `${error}`,
        pass: false,
        skipped: false,
      };
    }
    results.push({
      id: smokeCase.id,
      page,
      interaction,
      assessment: assess(page, interaction, smokeCase, options.checkExecution),
    });
  }
  return { origin, results, tab };
}

/**
 * Run the curated smoke cohort against staging/main and the current branch.
 *
 * The caller owns tab cleanup. This lets the in-app-browser agent keep a
 * failed page open for visual diagnosis and finalize it after review.
 */
export async function runExecutionRuntimeBrowserSmoke({
  browser,
  candidateOrigin,
  cases = executionRuntimeSmokeCases,
  referenceOrigin = DEFAULT_REFERENCE_ORIGIN,
  timeoutMs = 20_000,
}) {
  if (!browser) throw new Error('browser is required');
  if (!candidateOrigin) throw new Error('candidateOrigin is required');

  let reference = await runOrigin(browser, referenceOrigin, cases, {
    checkExecution: false,
    timeoutMs,
  });
  if (reference.results.some((result) => !result.assessment.pass)) {
    return {
      candidate: null,
      reference,
      status: 'reference-drift',
    };
  }

  let candidate = await runOrigin(browser, candidateOrigin, cases, {
    checkExecution: true,
    timeoutMs,
  });
  let failures = candidate.results.filter((result) => !result.assessment.pass);
  let sandboxLifecycle = await auditSandboxLifecycle(candidate.tab, cases);
  let stoppedAtAuthentication = failures.some((result) =>
    result.assessment.failures.includes('authentication-required'),
  );
  let performanceWarnings = candidate.results.flatMap((result) => {
    let referenceResult = reference.results.find(
      (candidateReference) => candidateReference.id === result.id,
    );
    if (!referenceResult) {
      return [];
    }
    if (
      typeof result.page.elapsedMs !== 'number' ||
      typeof referenceResult.page.elapsedMs !== 'number'
    ) {
      return [];
    }
    let ratio = result.page.elapsedMs / referenceResult.page.elapsedMs;
    if (ratio < 2.5 && result.page.elapsedMs < 8_000) {
      return [];
    }
    return [
      {
        candidateElapsedMs: result.page.elapsedMs,
        id: result.id,
        ratio: Number(ratio.toFixed(2)),
        referenceElapsedMs: referenceResult.page.elapsedMs,
        sandboxHandoffMs: result.page.sandboxHandoff?.elapsedMs,
      },
    ];
  });
  return {
    candidate,
    performanceWarnings,
    reference,
    sandboxLifecycle,
    status: stoppedAtAuthentication
      ? 'candidate-authentication-required'
      : failures.length || sandboxLifecycle.failures.length
        ? 'candidate-regression'
        : 'pass',
  };
}

/**
 * Release the two real app tabs created by a smoke run.
 *
 * Sandbox tabs own persistent iframes, loaders, media elements, and message
 * channels. Leaving many completed runs open can exhaust the browser and
 * manufacture the exact startup failures this gate is meant to detect.
 * Keep a failed tab only while diagnosing it; close every completed run.
 */
export async function closeExecutionRuntimeSmokeTabs(result) {
  await Promise.all(
    [result?.reference?.tab, result?.candidate?.tab]
      .filter(Boolean)
      .map((tab) => tab.close()),
  );
}
