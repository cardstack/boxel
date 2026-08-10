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
      expectedExecution: 'direct',
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

// The broad lane is intentionally separate from the six-card commit gate.
// One card mounts five representative authored cards at all seven formats,
// which makes a single navigation exercise 35 delegated render boundaries.
// Keep this lane cheap enough to run before CI while retaining substantially
// more format/composition pressure than the commit cohort alone.
export const executionRuntimeBroadCorpusCases = [
  {
    id: 'format-preview-batch-one',
    path: '/ctse/sandbox-compatibility-corpus-20260803/FormatPreviewBatchOne/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Format gauntlet · cards 1–5',
      'Avery Rivera',
      'Launch room activity',
      'The boundary should disappear',
      'Harbor relay 7',
      'A Market Made of Light',
    ],
    minimumHeadings: 40,
    minimumHealthyImages: 2,
    minimumInputs: 20,
    purpose:
      'Five representative cards mounted simultaneously at isolated, embedded, fitted, atom, edit, head, and markdown: 35 delegated boundaries in one real page.',
  },
];

// This lane broadens the commit gate by mechanism rather than by visual
// variety. Each card contributes a boundary behavior that is not already
// isolated by the six-card cohort or the 35-slot format gauntlet. It remains
// small enough for regular local runs while exercising real workspace code.
export const executionRuntimeExtendedCorpusCases = [
  {
    id: 'activity-timeline',
    path: '/ctse/sandbox-compatibility-corpus-20260803/ActivityTimeline/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Launch room activity',
      'Compatibility corpus created',
      'Accessibility review passed',
      'Editorial layout approved',
    ],
    purpose:
      'containsMany projection and authored ordering across a Capsule boundary.',
  },
  {
    id: 'linked-project',
    path: '/ctse/sandbox-compatibility-corpus-20260803/LinkedProject/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Realm boundary compatibility',
      'Mina Okafor',
      'Accessibility',
      'Theo Park',
      'Editorial design',
    ],
    purpose:
      'linksTo and linksToMany projections whose linked values remain visually useful inside Capsule rendering.',
  },
  {
    id: 'recursive-discussion',
    path: '/ctse/sandbox-compatibility-corpus-20260803/RecursiveDiscussion/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Sandbox design review',
      'Stable identity matters as much as capability confinement.',
      'That makes recursive preparation an explicit boundary requirement.',
      'The same source and state should produce the same visual hierarchy in both Hosts.',
    ],
    purpose:
      'Recursive FieldDef graph preparation with stable authored hierarchy.',
  },
  {
    id: 'card-info-recipe',
    path: '/ctse/sandbox-compatibility-corpus-20260803/CardInfoRecipe/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Golden Hour Lemon Beans',
      'Silky white beans',
      '42 min',
      '4 bowls',
    ],
    purpose:
      'Computed cardInfo metadata and authored presentation state across the boundary.',
  },
  {
    id: 'editable-rating',
    path: '/ctse/sandbox-compatibility-corpus-20260803/EditableRating/sample',
    expectedExecution: 'sandbox',
    mustContain: ['A quiet room with excellent boundaries', '128 reviews'],
    requiredSelectors: ['[aria-label="Set rating to 1"]'],
    purpose:
      'Interactive authored controls and modifier-compatible event handling in Sandbox execution.',
  },
  {
    id: 'workflow-studio',
    path: '/ctse/sandbox-compatibility-corpus-20260803/WorkflowStudio/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Night Market Publishing Run',
      'Collect',
      'Shape',
      'Review',
      'Publish',
      'active-index=0',
    ],
    purpose:
      'Tracked local workflow state and multiple authored actions in one Capsule.',
  },
  {
    id: 'video-dispatch',
    path: '/ctse/sandbox-compatibility-corpus-20260803/VideoDispatch/sample',
    expectedExecution: 'capsule',
    mustContain: [
      'Night market field dispatch',
      'MP4 + WebM',
      'metadata preload',
      'Two source formats, one authored media surface.',
    ],
    requiredSelectors: ['video'],
    purpose:
      'Native media markup that should not require a full browser Sandbox.',
  },
  {
    id: 'geo-dispatch-map',
    path: '/ctse/sandbox-compatibility-corpus-20260803/GeoDispatchMap/sample',
    expectedExecution: 'sandbox',
    mustContain: [
      'Canal Street night dispatch',
      'LAT 40.7195',
      'LON -74.0062',
      'map-ready',
    ],
    requiredSelectors: ['.leaflet-container'],
    purpose:
      'Leaflet, external styles, networking, and map DOM inside the cross-origin Sandbox.',
  },
  {
    id: 'fabrication-viewer',
    path: '/ctse/sandbox-compatibility-corpus-20260803/FabricationViewer/sample',
    expectedExecution: 'sandbox',
    mustContain: [
      'Additive bracket · tolerance study',
      'MODEL/3MF',
      'ResizeObserver',
      'explicit disposal',
    ],
    requiredSelectors: ['canvas'],
    purpose:
      'Three.js, 3MF loading, WebGL canvas, ResizeObserver, and explicit resource disposal.',
  },
  {
    id: 'top-layer-studio',
    path: '/ctse/sandbox-compatibility-corpus-20260803/TopLayerStudio/sample',
    expectedExecution: 'sandbox',
    mustContain: [
      'Contained control plane',
      'NATIVE TOP LAYER',
      'Open vendor detail',
      'popover-capability=available',
    ],
    requiredSelectors: ['[popover]'],
    purpose:
      'Native top-layer and popover containment inside the Sandbox document.',
  },
];

// A same-document navigation cohort for lifecycle and retained-DOM checks.
// These buttons all live on the compatibility-corpus workspace card, so the
// runner opens and closes stack items through the product UI instead of using
// page.goto() for every sample. That distinction is essential: hard document
// navigation would discard the app-lifetime runtimes and hide the leaks this
// soak is intended to expose.
export const executionRuntimeNavigationSoakCases = [
  {
    buttonName: '01 Primitive Profile',
    expectedExecution: 'capsule',
    mustContain: ['Avery Rivera', 'Editorial Systems Lead'],
  },
  {
    buttonName: '02 Nested Field Host',
    expectedExecution: 'capsule',
    mustContain: ['Northlight Test Kitchen', '18 Orchard Lane'],
  },
  {
    buttonName: '04 Rich Markdown Article',
    expectedExecution: 'capsule',
    mustContain: ['The boundary should disappear', 'Harbor relay 7'],
  },
  {
    buttonName: '09 Browser Canvas',
    expectedExecution: 'sandbox',
    mustContain: ['IFRAME · DOM/CANVAS CAPABILITY · INTRINSIC HEIGHT'],
  },
  {
    buttonName: '11 Computed Flight Plan',
    expectedExecution: 'capsule',
    mustContain: ['BX4500 · ORD → LHR', '$119345.79999999999'],
  },
  {
    buttonName: '23 Surface Poster Board',
    expectedExecution: 'sandbox',
    mustContain: ['After Dark', 'Signal bloom'],
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
        iframeCount: document.querySelectorAll('iframe.boxel-sandbox-process')
          .length,
        signIn: text.includes('Sign in to your Boxel Account'),
      };
    }, FATAL_TEXT);
    if (
      (state.iframeCount > 0 && !state.booting) ||
      state.fatal ||
      state.signIn
    ) {
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

async function settleSandboxFrame(tab, expectedText, timeoutMs) {
  try {
    let frame = tab.playwright.frameLocator('iframe.boxel-sandbox-process');
    let text = await frame.locator('body').innerText({ timeoutMs });
    let normalizedText = text.toLocaleLowerCase();
    return {
      fatal: FATAL_TEXT.some((value) => text.includes(value)),
      ready: expectedText.every((value) =>
        normalizedText.includes(value.toLocaleLowerCase()),
      ),
      signIn: false,
    };
  } catch {
    return { fatal: false, ready: false, signIn: false };
  }
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
    ({ expectedText, fatalText, requiredSelectors }) => {
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
        missingRequiredSelectors: requiredSelectors.filter(
          (selector) => !document.querySelector(selector),
        ),
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
    {
      expectedText: smokeCase.mustContain,
      fatalText: FATAL_TEXT,
      requiredSelectors: smokeCase.requiredSelectors ?? [],
    },
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
    let frameCardRect = await frame
      .locator('[data-boxel-sandbox-runtime]')
      .first()
      .evaluate((element) => {
        let rect = element.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      });
    let missingRequiredSelectors = [];
    for (let selector of smokeCase.requiredSelectors ?? []) {
      if ((await frame.locator(selector).count()) === 0) {
        missingRequiredSelectors.push(selector);
      }
    }
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
      missingRequiredSelectors,
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
    let startedAt = performance.now();
    await tab.playwright
      .getByRole('button', { exact: true, name: 'Edit' })
      .click({ force: true, timeoutMs });
    await tab.playwright
      .getByRole('button', { exact: true, name: 'Finish Editing' })
      .waitFor({ state: 'visible', timeoutMs });
    return Math.round(performance.now() - startedAt);
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
    let readyElapsedMs = await enterEdit();
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
      readyElapsedMs,
      values,
    };
  }
  if (smokeCase.interaction.kind === 'edit-scroll') {
    let readyElapsedMs = await enterEdit();
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
      readyElapsedMs,
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
    let startedAt = performance.now();
    await play.click({ timeoutMs });
    await tab.playwright.waitForTimeout(500);
    let pauseVisible = await interactionRoot
      .getByRole('button', { exact: true, name: 'Pause' })
      .isVisible();
    return {
      actionElapsedMs: Math.round(performance.now() - startedAt),
      kind: 'media-play',
      pass: pauseVisible,
      pauseVisible,
    };
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
  if (probeResult.missingRequiredSelectors.length) {
    failures.push('missing-required-selector');
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

async function auditSandboxTeardown(tab, origin, smokeCases, timeoutMs) {
  if (
    !smokeCases.some((smokeCase) => smokeCase.expectedExecution === 'sandbox')
  ) {
    return { failures: [], iframeCount: 0, skipped: true };
  }
  let capsuleCase = smokeCases.find(
    (smokeCase) => smokeCase.expectedExecution === 'capsule',
  );
  if (!capsuleCase) {
    return {
      failures: ['sandbox-teardown-needs-capsule-destination'],
      iframeCount: null,
      skipped: false,
    };
  }

  await tab.goto(urlFor(origin, capsuleCase.path));
  await tab.playwright.waitForLoadState({
    state: 'domcontentloaded',
    timeoutMs,
  });
  let settled = await settle(tab, capsuleCase.mustContain, timeoutMs);
  let state = await tab.playwright.evaluate(() => ({
    iframeCount: document.querySelectorAll('iframe.boxel-sandbox-process')
      .length,
    sandboxBooting: Boolean(
      document.querySelector('[aria-label="Loading interactive card"]'),
    ),
  }));
  let failures = [];
  if (!settled.ready || settled.fatal || settled.signIn) {
    failures.push('sandbox-teardown-destination-did-not-settle');
  }
  if (state.iframeCount !== 0) {
    failures.push('sandbox-iframe-survived-navigation');
  }
  if (state.sandboxBooting) {
    failures.push('sandbox-loading-state-survived-navigation');
  }
  return { ...state, failures, skipped: false };
}

async function runOrigin(browser, origin, smokeCases, options) {
  // The in-app browser can deliberately isolate authentication between tabs.
  // Reuse an explicitly supplied signed-in tab for the candidate when the
  // caller has one; otherwise create an owned scratch tab.
  let tab = options.tab ?? (await browser.tabs.new());
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
    let warmSamplesMs = [];
    let warmSandboxHandoffSamplesMs = [];
    for (let repeat = 0; repeat < options.performanceRepeats; repeat++) {
      let warmPage = await probe(
        tab,
        smokeCase,
        origin,
        options.timeoutMs,
        options.checkExecution,
      );
      if (
        !warmPage.ready ||
        warmPage.signIn ||
        warmPage.fatalText.length > 0 ||
        warmPage.missingText.length > 0
      ) {
        break;
      }
      warmSamplesMs.push(warmPage.elapsedMs);
      if (typeof warmPage.sandboxHandoff?.elapsedMs === 'number') {
        warmSandboxHandoffSamplesMs.push(warmPage.sandboxHandoff.elapsedMs);
      }
    }
    if (warmSamplesMs.length) {
      page.warmElapsedMs = median(warmSamplesMs);
      page.warmSamplesMs = warmSamplesMs;
    }
    if (warmSandboxHandoffSamplesMs.length) {
      page.warmSandboxHandoffMs = median(warmSandboxHandoffSamplesMs);
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

function median(values) {
  if (!values.length) return undefined;
  let sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarizePerformance(run, smokeCases) {
  if (!run) return null;
  let casesById = new Map(
    smokeCases.map((smokeCase) => [smokeCase.id, smokeCase]),
  );
  let capsule = [];
  let sandbox = [];
  let direct = [];
  for (let result of run.results) {
    let smokeCase = casesById.get(result.id);
    if (!smokeCase || !result.assessment.pass) continue;
    if (smokeCase.expectedExecution === 'capsule') capsule.push(result);
    if (smokeCase.expectedExecution === 'sandbox') sandbox.push(result);
    if (
      smokeCase.interaction?.expectedExecution === 'direct' &&
      typeof result.interaction.readyElapsedMs === 'number'
    ) {
      direct.push(result.interaction.readyElapsedMs);
    }
  }
  let readySummary = (results) => ({
    coldMedianMs: median(results.map((result) => result.page.elapsedMs)),
    samples: results.length,
    warmMedianMs: median(
      results
        .map((result) => result.page.warmElapsedMs)
        .filter((value) => typeof value === 'number'),
    ),
  });
  return {
    // Direct is entered through the trusted Base edit portal in these cases;
    // this is the click-to-edit-ready transition, not a document navigation.
    direct: {
      samples: direct.length,
      transitionReadyMedianMs: median(direct),
    },
    capsule: readySummary(capsule),
    sandbox: {
      ...readySummary(sandbox),
      coldInteractiveHandoffMedianMs: median(
        sandbox
          .map((result) => result.page.sandboxHandoff?.elapsedMs)
          .filter((value) => typeof value === 'number'),
      ),
      warmInteractiveHandoffMedianMs: median(
        sandbox
          .map((result) => result.page.warmSandboxHandoffMs)
          .filter((value) => typeof value === 'number'),
      ),
    },
  };
}

/**
 * Run the curated smoke cohort against staging/main and the current branch.
 *
 * The caller owns tab cleanup. This lets the in-app-browser agent keep a
 * failed page open for visual diagnosis and finalize it after review.
 */
export async function runExecutionRuntimeBrowserSmoke({
  browser,
  candidateTab,
  candidateOrigin,
  cases = executionRuntimeSmokeCases,
  performanceRepeats = 0,
  referenceTab,
  referenceOrigin = DEFAULT_REFERENCE_ORIGIN,
  timeoutMs = 20_000,
}) {
  if (!browser) throw new Error('browser is required');
  if (!candidateOrigin) throw new Error('candidateOrigin is required');

  let reference = await runOrigin(browser, referenceOrigin, cases, {
    checkExecution: false,
    performanceRepeats,
    tab: referenceTab,
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
    performanceRepeats,
    tab: candidateTab,
    timeoutMs,
  });
  let failures = candidate.results.filter((result) => !result.assessment.pass);
  let sandboxTeardown = await auditSandboxTeardown(
    candidate.tab,
    candidateOrigin,
    cases,
    timeoutMs,
  );
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
    performanceBaseline: {
      candidate: summarizePerformance(candidate, cases),
      reference: summarizePerformance(reference, cases),
    },
    performanceWarnings,
    reference,
    sandboxLifecycle,
    sandboxTeardown,
    status: stoppedAtAuthentication
      ? 'candidate-authentication-required'
      : failures.length ||
          sandboxLifecycle.failures.length ||
          sandboxTeardown.failures.length
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

/**
 * Repeatedly opens and closes representative cards through the real stack UI.
 *
 * This deliberately reports DOM/style/runtime counts instead of inventing a
 * CI heap threshold. Exact heap/CWV collection belongs to Chrome DevTools;
 * these counts are a cheap signed-in browser gate that catches retained
 * iframes, loading affordances, duplicated authored styles, and runaway DOM.
 */
export async function runExecutionRuntimeNavigationSoak({
  tab,
  origin,
  cases = executionRuntimeNavigationSoakCases,
  cycles = 3,
  checkExecution = true,
  timeoutMs = 20_000,
}) {
  if (!tab) throw new Error('tab is required');
  if (!origin) throw new Error('origin is required');
  let indexPath = '/ctse/sandbox-compatibility-corpus-20260803/index';
  await tab.goto(urlFor(origin, indexPath));
  await tab.playwright.waitForLoadState({
    state: 'domcontentloaded',
    timeoutMs,
  });
  let indexReady = await settle(
    tab,
    ['Forty cards. Different boundaries, one visual contract.'],
    timeoutMs,
  );
  if (!indexReady.ready || indexReady.signIn || indexReady.fatal) {
    return {
      failures: [
        indexReady.signIn ? 'authentication-required' : 'index-failed',
      ],
      pass: false,
      samples: [],
    };
  }

  let initial = await navigationSoakSnapshot(tab);
  let samples = [];
  let failures = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let soakCase of cases) {
      await tab.playwright
        .getByRole('button', { name: soakCase.buttonName })
        .click({ timeoutMs });
      let sandboxHandoff =
        checkExecution && soakCase.expectedExecution === 'sandbox'
          ? await settleSandboxHandoff(tab, timeoutMs)
          : undefined;
      let ready = sandboxHandoff
        ? await settleSandboxFrame(tab, soakCase.mustContain, timeoutMs)
        : await settle(tab, soakCase.mustContain, timeoutMs);
      let opened = await navigationSoakSnapshot(tab);
      let caseFailures = [];
      if (!ready.ready || ready.fatal || ready.signIn) {
        caseFailures.push('card-did-not-settle');
      }
      if (
        checkExecution &&
        !opened.executions.includes(soakCase.expectedExecution)
      ) {
        caseFailures.push('wrong-execution-tier');
      }
      if (sandboxHandoff?.booting) {
        caseFailures.push('sandbox-not-interactive');
      }

      let closeButtons = tab.playwright.getByRole('button', {
        exact: true,
        name: 'Close',
      });
      let closeCount = await closeButtons.count();
      if (closeCount < 1) {
        caseFailures.push('opened-stack-item-missing-close');
      } else {
        await closeButtons.nth(closeCount - 1).click({ timeoutMs });
      }
      let returned = await settle(
        tab,
        ['Forty cards. Different boundaries, one visual contract.'],
        timeoutMs,
      );
      let closed = await navigationSoakSnapshot(tab);
      if (!returned.ready || returned.fatal || returned.signIn) {
        caseFailures.push('index-did-not-return');
      }
      if (closed.iframeCount !== 0) {
        caseFailures.push('sandbox-iframe-retained-after-close');
      }
      if (closed.loadingCount !== 0) {
        caseFailures.push('sandbox-loading-state-retained-after-close');
      }
      failures.push(
        ...caseFailures.map((failure) => ({
          caseId: soakCase.buttonName,
          cycle,
          failure,
        })),
      );
      samples.push({
        caseId: soakCase.buttonName,
        closed,
        cycle,
        failures: caseFailures,
        opened,
        sandboxHandoff,
      });
    }
  }

  let closedSamples = samples.map((sample) => sample.closed);
  let finalClosedSample = closedSamples[closedSamples.length - 1];
  let warmClosedSample =
    closedSamples[Math.min(cases.length - 1, closedSamples.length - 1)];
  let priorCycleClosedSample =
    cycles > 1
      ? closedSamples[Math.max(closedSamples.length - cases.length - 1, 0)]
      : warmClosedSample;
  return {
    failures,
    pass: failures.length === 0,
    samples,
    summary: {
      cycles,
      maximumClosedDOMNodes: Math.max(
        ...closedSamples.map((sample) => sample.domNodes),
      ),
      maximumClosedStyleElements: Math.max(
        ...closedSamples.map((sample) => sample.styleElements),
      ),
      coldLoadDOMNodeDelta: warmClosedSample.domNodes - initial.domNodes,
      coldLoadStyleElementDelta:
        warmClosedSample.styleElements - initial.styleElements,
      steadyStateDOMNodeDelta:
        finalClosedSample.domNodes - priorCycleClosedSample.domNodes,
      steadyStateStyleElementDelta:
        finalClosedSample.styleElements - priorCycleClosedSample.styleElements,
    },
  };
}

async function navigationSoakSnapshot(tab) {
  return tab.playwright.evaluate(() => ({
    domNodes: document.querySelectorAll('*').length,
    executions: [...document.querySelectorAll('[data-boxel-execution]')]
      .map((element) => element.getAttribute('data-boxel-execution'))
      .filter(Boolean),
    iframeCount: document.querySelectorAll('iframe.boxel-sandbox-process')
      .length,
    loadingCount: document.querySelectorAll(
      '[aria-label="Loading interactive card"]',
    ).length,
    styleElements: document.querySelectorAll('style').length,
  }));
}
