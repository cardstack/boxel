/**
 * Browser smoke runner for the Boxel execution runtime.
 *
 * This module does not launch Playwright. It receives a browser handle from an
 * agent-driven in-app browser, so the smoke run happens in the same real,
 * signed-in browser surface used for manual product verification rather than
 * in a clean automation profile that no user ever has.
 *
 * Three properties of this runner exist because a long unsupervised batch
 * against real workspace cards behaves nothing like a test suite:
 *
 * 1. **Each case is persisted as it completes.** `onCaseComplete` is awaited
 *    after every case. A batch that outlives the browser control deadline
 *    still leaves behind the evidence it already collected; without this, one
 *    slow case at the end discards the whole run.
 * 2. **Cancellation is bounded per case.** `caseTimeoutMs` cuts a single case
 *    loose and moves on, rather than letting it consume the budget for every
 *    case behind it. An abandoned case's page work is cut loose with a blank
 *    navigation so it cannot bleed into the next case's observations.
 * 3. **Readiness is recorded in two parts.** Application/auth readiness (the
 *    Host booted and authentication resolved) is timed separately from
 *    execution readiness (substantive Direct/Capsule/Sandbox output). Those
 *    costs move independently, and a full navigation that reboots Host and
 *    Matrix work otherwise buries the number the execution runtime owns.
 *
 * For the same reason, a case's outcome is a status rather than a boolean.
 * Pre-routing network failure, runtime failure, semantic mismatch, interaction
 * failure, and slow-but-eventually-correct output are different findings and
 * lead to different work; collapsing them into red/green destroys that.
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
  'Timed out loading the Sandbox child',
  'Timed out connecting to the Sandbox child',
  'render acked but produced no visible output',
];

export function normalizeVisibleText(value) {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

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
      'Surface layout coordinates, image projection, and poster composition. Geometry computed at render time is a Sandbox signal, so this composition routes there.',
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
    buttonName: '17 Editable Rating',
    expectedExecution: 'sandbox',
    mustContain: ['A quiet room with excellent boundaries', 'Click a star'],
    requiredSelectors: ['[aria-label="Set rating to 1"]'],
  },
  {
    buttonName: '23 Surface Poster Board',
    expectedExecution: 'sandbox',
    mustContain: ['After Dark', 'Signal bloom'],
  },
];

function urlFor(origin, path, collectPerformance = false) {
  let url = new URL(path, `${origin.replace(/\/$/, '')}/`);
  if (collectPerformance) {
    url.searchParams.set('boxelExecutionPerformance', '1');
  }
  return url.href;
}

async function settle(tab, expectedText, timeoutMs) {
  let normalizedExpectedText = expectedText.map(normalizeVisibleText);
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = await tab.playwright.evaluate(
      ({ fatalText, normalizedExpectedText }) => {
        let text = document.body?.innerText ?? '';
        let normalizedText = text
          .normalize('NFKC')
          .replace(/\s+/g, ' ')
          .trim()
          .toLocaleLowerCase();
        return {
          cardReady: Boolean(
            document.querySelector(
              '[data-boxel-card-id], [data-boxel-card-container], .boxel-card-container',
            ),
          ),
          fatal: fatalText.some((value) => text.includes(value)),
          loadingCard: Boolean(
            document.querySelector('[aria-label="Loading card"]'),
          ),
          ready:
            Boolean(
              document.querySelector(
                '[data-boxel-card-id], [data-boxel-card-container], .boxel-card-container',
              ),
            ) &&
            !document.querySelector('[aria-label="Loading card"]') &&
            (normalizedExpectedText.length === 0 ||
              normalizedExpectedText.every((value) =>
                normalizedText.includes(value),
              )),
          signIn: text.includes('Sign in to your Boxel Account'),
        };
      },
      { fatalText: FATAL_TEXT, normalizedExpectedText },
    );
    if (state.ready || state.fatal || state.signIn) {
      return state;
    }
    await tab.playwright.waitForTimeout(250);
  }
  return { fatal: false, ready: false, signIn: false };
}

/**
 * Wait for the Host application itself, before any card routing.
 *
 * This resolves as soon as authentication has been decided — either the
 * sign-in screen is up, or a card surface (rendered or still loading) exists.
 * Everything measured after this point is the execution runtime's cost; a card
 * still showing "Loading card" here has not reached routing at all, which is a
 * pre-routing environment finding rather than a runtime one.
 */
async function settleApplication(tab, timeoutMs) {
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = await tab.playwright.evaluate((fatalText) => {
      let text = document.body?.innerText ?? '';
      return {
        fatal: fatalText.some((value) => text.includes(value)),
        mounted: Boolean(
          document.querySelector(
            '[data-boxel-card-id], [data-boxel-card-container], .boxel-card-container, [aria-label="Loading card"]',
          ),
        ),
        signIn: text.includes('Sign in to your Boxel Account'),
      };
    }, FATAL_TEXT);
    if (state.mounted || state.fatal || state.signIn) {
      return { ...state, ready: true };
    }
    await tab.playwright.waitForTimeout(100);
  }
  return { fatal: false, mounted: false, ready: false, signIn: false };
}

async function settlePageImages(tab, timeoutMs) {
  let deadline = Date.now() + Math.min(timeoutMs, 8_000);
  let lastPrimedSignature;
  let previousSignature;
  let stableSince = Date.now();
  do {
    let state = await tab.playwright.evaluate(() => {
      let images = [...document.images].filter(
        (image) => image.currentSrc.length > 0 || image.hasAttribute('src'),
      );
      let complete = images.filter((image) => image.complete).length;
      return {
        complete,
        pending: images.length - complete,
        signature: `${images.length}:${complete}`,
      };
    });
    if (state.signature !== previousSignature) {
      previousSignature = state.signature;
      stableSince = Date.now();
    }
    if (state.pending > 0 && state.signature !== lastPrimedSignature) {
      lastPrimedSignature = state.signature;
      await primePageLazyImages(tab);
      stableSince = Date.now();
      continue;
    }
    if (state.pending === 0 && Date.now() - stableSince >= 500) {
      return true;
    }
    await tab.playwright.waitForTimeout(100);
  } while (Date.now() < deadline);
  return false;
}

async function primePageLazyImages(tab) {
  let viewport = await tab.playwright.evaluate(() => ({
    height: window.innerHeight,
    maximum: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ),
    x: window.scrollX,
    y: window.scrollY,
  }));
  let step = Math.max(viewport.height * 0.75, 320);
  for (let position = 0; position < viewport.maximum; position += step) {
    await tab.playwright.evaluate((y) => window.scrollTo(0, y), position);
    await tab.playwright.waitForTimeout(50);
  }
  await tab.playwright.evaluate(({ x, y }) => window.scrollTo(x, y), viewport);
}

async function settleFrameImages(tab, timeoutMs) {
  let frame = tab.playwright.frameLocator('iframe.boxel-sandbox-process');
  let deadline = Date.now() + Math.min(timeoutMs, 8_000);
  let lastPrimedSignature;
  let previousSignature;
  let stableSince = Date.now();
  do {
    try {
      let state = await frame.locator('img').evaluateAll((candidates) => {
        let images = candidates.filter(
          (image) => image.currentSrc.length > 0 || image.hasAttribute('src'),
        );
        let complete = images.filter((image) => image.complete).length;
        return {
          complete,
          pending: images.length - complete,
          signature: `${images.length}:${complete}`,
        };
      });
      if (state.signature !== previousSignature) {
        previousSignature = state.signature;
        stableSince = Date.now();
      }
      if (state.pending > 0 && state.signature !== lastPrimedSignature) {
        lastPrimedSignature = state.signature;
        await primeFrameLazyImages(frame);
        stableSince = Date.now();
        continue;
      }
      if (state.pending === 0 && Date.now() - stableSince >= 500) {
        return true;
      }
    } catch {
      // The child may still be replacing its bootstrap document.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}

async function primeFrameLazyImages(frame) {
  let body = frame.locator('body');
  let viewport = await body.evaluate(() => ({
    height: window.innerHeight,
    maximum: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ),
    x: window.scrollX,
    y: window.scrollY,
  }));
  let step = Math.max(viewport.height * 0.75, 320);
  for (let position = 0; position < viewport.maximum; position += step) {
    await body.evaluate((_element, y) => window.scrollTo(0, y), position);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await body.evaluate((_element, { x, y }) => window.scrollTo(x, y), viewport);
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

async function settleSandboxFrame(
  tab,
  expectedText,
  timeoutMs,
  requiredSelectors = [],
) {
  try {
    let frame = tab.playwright.frameLocator('iframe.boxel-sandbox-process');
    let text = await frame.locator('body').innerText({ timeoutMs });
    let normalizedText = normalizeVisibleText(text);
    let selectorsReady = (
      await Promise.all(
        requiredSelectors.map(async (selector) =>
          Boolean(await frame.locator(selector).count()),
        ),
      )
    ).every(Boolean);
    return {
      fatal: FATAL_TEXT.some((value) => text.includes(value)),
      ready:
        selectorsReady &&
        expectedText.every((value) =>
          normalizedText.includes(normalizeVisibleText(value)),
        ),
      signIn: false,
    };
  } catch {
    return { fatal: false, ready: false, signIn: false };
  }
}

async function probe(
  tab,
  smokeCase,
  origin,
  timeoutMs,
  checkExecution,
  collectPerformance = false,
) {
  let url = urlFor(origin, smokeCase.path, collectPerformance);
  if (collectPerformance) {
    // A same-document transition keeps the diagnostics singleton alive.
    // Clear the preceding occurrence so every sample describes exactly one
    // navigation rather than a cumulative history of the tab.
    await tab.playwright
      .evaluate(() => {
        window.__boxelExecutionPerformance?.enable();
        window.__boxelExecutionPerformance?.reset();
      })
      .catch(() => undefined);
  }
  let startedAt = performance.now();
  let currentUrl = await tab.url();
  if (currentUrl !== url) {
    try {
      await tab.goto(url);
    } catch (error) {
      // The in-app browser's navigation promise can outlive the top-level
      // document when a long-running Sandbox child or Matrix bootstrap keeps
      // the navigation open. Once the requested document committed, `settle`
      // is the authoritative readiness check; a pending load event is not a
      // card failure.
      let committedUrl = await tab.url();
      if (new URL(committedUrl).pathname !== new URL(url).pathname) {
        throw error;
      }
    }
  }
  await tab.playwright
    .waitForLoadState({
      state: 'domcontentloaded',
      timeoutMs,
    })
    .catch(async (error) => {
      let readyState = await tab.playwright.evaluate(() => document.readyState);
      if (readyState === 'loading') throw error;
    });
  // Application/auth readiness and execution readiness are separate costs and
  // are recorded separately. A full navigation reboots Host and Matrix work,
  // which dominates the total and would otherwise be attributed to the tier.
  let application = await settleApplication(tab, timeoutMs);
  let applicationReadyMs = Math.round(performance.now() - startedAt);
  let executionStartedAt = performance.now();
  let settled = application.signIn
    ? { fatal: application.fatal, ready: false, signIn: true }
    : await settle(tab, smokeCase.mustContain, timeoutMs);
  let executionReadyMs = Math.round(performance.now() - executionStartedAt);
  let detectedExecution = checkExecution
    ? await tab.playwright.evaluate(() => [
        ...new Set(
          [...document.querySelectorAll('[data-boxel-execution]')]
            .map((element) => element.getAttribute('data-boxel-execution'))
            .filter((value) => value && value !== 'prerender'),
        ),
      ])
    : [];
  let candidateRunsInSandbox = detectedExecution.includes('sandbox');
  // The prerender placeholder deliberately contains the same semantic text
  // as the live Sandbox child. Text parity therefore proves only that the
  // fast placeholder worked, not that the iframe booted or became
  // interactive. Candidate Sandbox cases must cross that second barrier
  // before we inspect controls or run an interaction.
  let sandboxHandoff =
    checkExecution &&
    (smokeCase.expectedExecution === 'sandbox' || candidateRunsInSandbox)
      ? await settleSandboxHandoff(tab, timeoutMs)
      : undefined;
  let mediaSettled = await settlePageImages(tab, timeoutMs);
  let normalizedExpectedText = smokeCase.mustContain.map(normalizeVisibleText);
  let result = await tab.playwright.evaluate(
    ({
      expectedText,
      fatalText,
      normalizedExpectedText,
      requiredSelectors,
    }) => {
      let text = document.body?.innerText ?? '';
      let normalizedText = text
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();
      let headings = [...document.querySelectorAll('h1,h2,h3')]
        .map((element) => element.textContent?.trim())
        .filter(Boolean);
      let images = [...document.images].map((image) => ({
        alt: image.alt,
        complete: image.complete,
        height: image.naturalHeight,
        source: Boolean(image.currentSrc || image.getAttribute('src')),
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
          (_value, index) =>
            !normalizedText.includes(normalizedExpectedText[index]),
        ),
        signIn: text.includes('Sign in to your Boxel Account'),
        sandboxBooting: Boolean(
          document.querySelector('[aria-label="Loading interactive card"]'),
        ),
        semanticTokens: [
          ...new Set(
            text
              .toLocaleLowerCase()
              .match(/[\p{L}\p{N}][\p{L}\p{N}._%$-]{2,}/gu) ?? [],
          ),
        ].sort(),
        textSample: text.replace(/\s+/g, ' ').slice(0, 600),
        title: document.title,
      };
    },
    {
      expectedText: smokeCase.mustContain,
      fatalText: FATAL_TEXT,
      normalizedExpectedText,
      requiredSelectors: smokeCase.requiredSelectors ?? [],
    },
  );
  if (
    checkExecution &&
    (smokeCase.expectedExecution === 'sandbox' || candidateRunsInSandbox) &&
    !sandboxHandoff?.booting &&
    !sandboxHandoff?.fatal &&
    !sandboxHandoff?.signIn
  ) {
    let frame = tab.playwright.frameLocator('iframe.boxel-sandbox-process');
    mediaSettled = await settleFrameImages(tab, timeoutMs);
    let frameText = await frame.locator('body').innerText({ timeoutMs });
    let normalizedFrameText = normalizeVisibleText(frameText);
    let frameHeadings = await frame
      .locator('h1,h2,h3')
      .allTextContents({ timeoutMs });
    let frameImages = await frame.locator('img').evaluateAll((images) =>
      images.map((image) => ({
        alt: image.alt,
        complete: image.complete,
        height: image.naturalHeight,
        source: Boolean(image.currentSrc || image.getAttribute('src')),
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
        (_value, index) =>
          !normalizedFrameText.includes(normalizedExpectedText[index]),
      ),
      semanticTokens: [
        ...new Set(
          frameText
            .toLocaleLowerCase()
            .match(/[\p{L}\p{N}][\p{L}\p{N}._%$-]{2,}/gu) ?? [],
        ),
      ].sort(),
      textSample: frameText.replace(/\s+/g, ' ').slice(0, 600),
    };
  }
  let executionPerformance = collectPerformance
    ? await tab.playwright.evaluate(
        () => window.__boxelExecutionPerformance?.snapshot() ?? null,
      )
    : undefined;
  return {
    ...result,
    applicationReady: application.ready,
    elapsedMs: Math.round(performance.now() - startedAt),
    executionPerformance,
    mediaSettled,
    readiness: {
      applicationMs: applicationReadyMs,
      executionMs: executionReadyMs,
      sandboxHandoffMs: sandboxHandoff?.elapsedMs,
    },
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
    let playName = smokeCase.interaction.playName ?? 'Play';
    let pauseName = smokeCase.interaction.pauseName ?? 'Pause';
    let play = interactionRoot.getByRole('button', {
      exact: true,
      name: playName,
    });
    let startedAt = performance.now();
    await play.click({ force: true, timeoutMs });
    let pause = interactionRoot.getByRole('button', {
      exact: true,
      name: pauseName,
    });
    await pause.waitFor({ state: 'visible', timeoutMs });
    await tab.playwright.waitForTimeout(
      smokeCase.interaction.requireProgress ? 750 : 100,
    );
    let pauseVisible = await pause.isVisible();
    let progress;
    if (smokeCase.interaction.requireProgress) {
      let slider = interactionRoot.getByRole('slider').first();
      let progressDeadline = performance.now() + Math.min(timeoutMs, 3_000);
      do {
        progress = Number(await slider.evaluate((element) => element.value));
        if (progress > 0) break;
        await tab.playwright.waitForTimeout(250);
      } while (performance.now() < progressDeadline);
    }
    return {
      actionElapsedMs: Math.round(performance.now() - startedAt),
      kind: 'media-play',
      pass:
        pauseVisible &&
        (!smokeCase.interaction.requireProgress || progress > 0),
      pauseVisible,
      progress,
    };
  }
  throw new Error(`Unknown smoke interaction: ${smokeCase.interaction.kind}`);
}

// A case's outcome is a status, not a boolean. These five findings lead to
// five different pieces of work — a broken environment, a runtime defect, a
// projection gap, a capability gap, and a performance problem — so the runner
// keeps them apart. Order matters: the first bucket a case falls into wins,
// because a card that never reached routing cannot also be said to have the
// wrong semantics.
const STATUS_BUCKETS = [
  [
    'pre-routing-failure',
    [
      'authentication-required',
      'application-not-ready',
      'browser-probe-error',
      'case-deadline-exceeded',
    ],
  ],
  [
    'runtime-failure',
    [
      'fatal-card-error',
      'did-not-settle',
      'blank-card-slot',
      'sandbox-not-interactive',
      'wrong-execution-tier',
    ],
  ],
  [
    'semantic-mismatch',
    [
      'missing-semantic-text',
      'missing-heading-structure',
      'missing-or-broken-image',
      'broken-image',
      'media-settlement-timeout',
      'host-chrome-style-drift',
      'reference-image-parity',
      'reference-heading-parity',
      'reference-control-parity',
      'reference-semantic-parity',
    ],
  ],
  [
    'capability-gap',
    ['missing-interactive-control', 'missing-required-selector'],
  ],
  ['interaction-failure', ['interaction-failed']],
];

// Beyond this, a case is correct but too slow to call healthy. It is reported
// as its own status so a passing-but-degraded lane is visible without being
// counted as a regression.
const SLOW_EXECUTION_MS = 15_000;

export function classifySmokeOutcome(failures, executionMs) {
  for (let [status, members] of STATUS_BUCKETS) {
    if (failures.some((failure) => members.includes(failure))) {
      return status;
    }
  }
  if (failures.length) return 'candidate-regression';
  if (typeof executionMs === 'number' && executionMs >= SLOW_EXECUTION_MS) {
    return 'slow-but-correct';
  }
  return 'pass';
}

function assess(probeResult, interaction, smokeCase, checkExecution) {
  let healthyImages = (probeResult.images ?? []).filter(
    (image) => image.complete && image.width > 0 && image.height > 0,
  ).length;
  let failures = [];
  if (probeResult.signIn) failures.push('authentication-required');
  if (probeResult.applicationReady === false) {
    failures.push('application-not-ready');
  }
  if (!probeResult.ready) failures.push('did-not-settle');
  if (probeResult.fatalText.length) failures.push('fatal-card-error');
  if (
    !probeResult.mediaSettled &&
    probeResult.images.some(({ source }) => source)
  ) {
    failures.push('media-settlement-timeout');
  }
  if (
    probeResult.images.some(
      ({ complete, height, source, width }) =>
        source && complete && (width === 0 || height === 0),
    )
  ) {
    failures.push('broken-image');
  }
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
    smokeCase.expectedExecution !== 'discover' &&
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
  return {
    failures,
    pass: failures.length === 0,
    status: classifySmokeOutcome(failures, probeResult.readiness?.executionMs),
  };
}

export function assessReferenceParity(candidate, reference, smokeCase) {
  if (!smokeCase.referenceParity) {
    return { failures: [], skipped: true };
  }

  let ignoredTokens = new Set([
    'card',
    'close',
    'code',
    'copy',
    'direct',
    'edit',
    'execution',
    'interact',
    'more',
    'new',
    'reload',
    'sandbox',
    'capsule',
    'workspace',
  ]);
  let referenceTokens = (reference.semanticTokens ?? []).filter(
    (token) => !ignoredTokens.has(token),
  );
  let candidateTokens = new Set(candidate.semanticTokens ?? []);
  let matchedTokens = referenceTokens.filter((token) =>
    candidateTokens.has(token),
  );
  let tokenCoverage = referenceTokens.length
    ? matchedTokens.length / referenceTokens.length
    : 1;
  let healthyImages = (page) =>
    (page.images ?? []).filter(
      (image) => image.complete && image.width > 0 && image.height > 0,
    ).length;
  let candidateImages = healthyImages(candidate);
  let referenceImages = healthyImages(reference);
  let failures = [];

  // A candidate Sandbox frame does not contain the Host-owned realm icon.
  // The one-image allowance accounts for that chrome while still detecting
  // loss of an authored image (the common ImageDef/private-media regression).
  if (candidateImages + 1 < referenceImages) {
    failures.push('reference-image-parity');
  }
  if (candidate.headingCount + 1 < reference.headingCount) {
    failures.push('reference-heading-parity');
  }
  if (candidate.inputCount < reference.inputCount) {
    failures.push('reference-control-parity');
  }
  if (tokenCoverage < 0.7) {
    failures.push('reference-semantic-parity');
  }

  return {
    candidateHealthyImages: candidateImages,
    failures,
    matchedTokens: matchedTokens.length,
    referenceHealthyImages: referenceImages,
    referenceTokens: referenceTokens.length,
    skipped: false,
    tokenCoverage: Number(tokenCoverage.toFixed(3)),
  };
}

export function summarizeExecutionRuntimeSmokeRun(run) {
  let candidateById = new Map(
    (run.candidate?.results ?? []).map((result) => [result.id, result]),
  );

  return run.reference.results.map((referenceResult) => {
    let candidateResult = candidateById.get(referenceResult.id);
    let candidateFailures = candidateResult?.assessment.failures ?? [];
    let diagnosis = !referenceResult.assessment.pass
      ? 'reference-drift'
      : !candidateResult
        ? 'candidate-not-run'
        : candidateFailures.includes('authentication-required')
          ? 'authentication-required'
          : candidateResult.assessment.pass
            ? 'pass'
            : 'candidate-regression';
    let healthyImages = (result) =>
      result
        ? (result.page.images ?? []).filter(
            (image) => image.complete && image.width > 0 && image.height > 0,
          ).length
        : null;

    return {
      candidate: candidateResult
        ? {
            elapsedMs: candidateResult.page.elapsedMs,
            executions: candidateResult.page.executions,
            failures: candidateFailures,
            healthyImages: healthyImages(candidateResult),
            parity: candidateResult.referenceParity ?? null,
            readiness: candidateResult.page.readiness ?? null,
            status: candidateResult.assessment.status ?? null,
            warmReadiness: candidateResult.page.warmReadiness ?? null,
          }
        : null,
      diagnosis,
      id: referenceResult.id,
      reference: {
        elapsedMs: referenceResult.page.elapsedMs,
        failures: referenceResult.assessment.failures,
        healthyImages: healthyImages(referenceResult),
        readiness: referenceResult.page.readiness ?? null,
        signatureReady: referenceResult.page.missingText.length === 0,
      },
    };
  });
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

/**
 * Run one origin's cases, bounding and persisting each case independently.
 *
 * A case that exceeds `caseTimeoutMs` is cut loose and the run continues. Its
 * abandoned page work is detached with a blank navigation first: the tab is
 * shared across cases, so an in-flight render left running would otherwise
 * contribute DOM, images, and iframes to the next case's observations.
 *
 * Every completed case is handed to `onCaseComplete` before the next one
 * starts. A batch that dies partway through therefore still leaves the
 * evidence it collected; a persistence failure is recorded against the run and
 * never discards a result.
 */
async function runOrigin(browser, origin, smokeCases, options) {
  // The in-app browser can deliberately isolate authentication between tabs.
  // Reuse an explicitly supplied signed-in tab for the candidate when the
  // caller has one; otherwise create an owned scratch tab.
  let tab = options.tab ?? (await browser.tabs.new());
  let caseTimeoutMs = options.caseTimeoutMs ?? defaultCaseTimeoutMs(options);
  let results = [];
  let persistenceErrors = [];

  async function record(result) {
    results.push(result);
    if (!options.onCaseComplete) return;
    try {
      await options.onCaseComplete(result, { origin });
    } catch (error) {
      persistenceErrors.push({ id: result.id, error: describeError(error) });
    }
  }

  for (let smokeCase of smokeCases) {
    let outcome = await withCaseDeadline(caseTimeoutMs, () =>
      runCase(tab, smokeCase, origin, options),
    );
    if (outcome.timedOut) {
      await detachAbandonedCase(tab);
      await record({
        id: smokeCase.id,
        page: { elapsedMs: null, caseTimeoutMs },
        assessment: {
          failures: ['case-deadline-exceeded'],
          pass: false,
          status: 'pre-routing-failure',
        },
        interaction: { pass: false, skipped: true },
      });
      continue;
    }
    await record(outcome.value);
    // Authentication is the one finding that makes every later case
    // meaningless: the remaining pages would all report the sign-in screen.
    if (outcome.value.assessment.failures.includes('authentication-required')) {
      break;
    }
  }
  return { origin, persistenceErrors, results, tab };
}

function defaultCaseTimeoutMs({ performanceRepeats = 0, timeoutMs }) {
  // One case can navigate, settle, interact, and repeat for warm samples. The
  // bound covers all of those with headroom rather than the single settle.
  return timeoutMs * (4 + 2 * performanceRepeats);
}

function describeError(error) {
  return error instanceof Error ? (error.stack ?? error.message) : `${error}`;
}

async function withCaseDeadline(caseTimeoutMs, run) {
  let timer;
  let expired = Symbol('case-deadline');
  try {
    let value = await Promise.race([
      run(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(expired), caseTimeoutMs);
      }),
    ]);
    return value === expired ? { timedOut: true } : { timedOut: false, value };
  } finally {
    clearTimeout(timer);
  }
}

async function detachAbandonedCase(tab) {
  // Best effort: the tab may itself be why the case timed out.
  try {
    await tab.goto('about:blank');
  } catch {
    // Nothing further to do — the next case navigates anyway.
  }
}

async function runCase(tab, smokeCase, origin, options) {
  let page;
  try {
    page = await probe(
      tab,
      smokeCase,
      origin,
      options.timeoutMs,
      options.checkExecution,
      options.collectPerformance,
    );
  } catch (error) {
    return {
      id: smokeCase.id,
      page: {
        elapsedMs: null,
        runnerError: describeError(error),
        url: await tab.url(),
      },
      assessment: {
        failures: ['browser-probe-error'],
        pass: false,
        status: 'pre-routing-failure',
      },
      interaction: { pass: false, skipped: true },
    };
  }
  if (page.signIn) {
    return {
      id: smokeCase.id,
      page,
      assessment: {
        failures: ['authentication-required'],
        pass: false,
        status: 'pre-routing-failure',
      },
      interaction: { pass: false, skipped: true },
    };
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
      error: describeError(error),
      pass: false,
      skipped: false,
    };
  }
  let warmSamplesMs = [];
  let warmApplicationSamplesMs = [];
  let warmExecutionSamplesMs = [];
  let warmSandboxHandoffSamplesMs = [];
  let warmExecutionPerformance = [];
  for (let repeat = 0; repeat < options.performanceRepeats; repeat++) {
    let warmPage = await probe(
      tab,
      smokeCase,
      origin,
      options.timeoutMs,
      options.checkExecution,
      options.collectPerformance,
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
    warmApplicationSamplesMs.push(warmPage.readiness.applicationMs);
    warmExecutionSamplesMs.push(warmPage.readiness.executionMs);
    if (warmPage.executionPerformance) {
      warmExecutionPerformance.push(warmPage.executionPerformance);
    }
    if (typeof warmPage.sandboxHandoff?.elapsedMs === 'number') {
      warmSandboxHandoffSamplesMs.push(warmPage.sandboxHandoff.elapsedMs);
    }
  }
  if (warmSamplesMs.length) {
    page.warmElapsedMs = median(warmSamplesMs);
    page.warmSamplesMs = warmSamplesMs;
    page.warmReadiness = {
      applicationMs: median(warmApplicationSamplesMs),
      executionMs: median(warmExecutionSamplesMs),
      sandboxHandoffMs: median(warmSandboxHandoffSamplesMs),
    };
  }
  if (warmSandboxHandoffSamplesMs.length) {
    page.warmSandboxHandoffMs = median(warmSandboxHandoffSamplesMs);
  }
  if (warmExecutionPerformance.length) {
    page.warmExecutionPerformance = warmExecutionPerformance;
  }
  return {
    id: smokeCase.id,
    page,
    interaction,
    assessment: assess(page, interaction, smokeCase, options.checkExecution),
  };
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
  let sample = (results, read) =>
    median(results.map(read).filter((value) => typeof value === 'number'));
  // Application/auth readiness and execution readiness are reported side by
  // side rather than summed. Host and Matrix startup dominates a full
  // navigation, so a total alone cannot say whether a tier got slower.
  let readySummary = (results) => ({
    coldApplicationMedianMs: sample(
      results,
      (result) => result.page.readiness?.applicationMs,
    ),
    coldExecutionMedianMs: sample(
      results,
      (result) => result.page.readiness?.executionMs,
    ),
    coldMedianMs: median(results.map((result) => result.page.elapsedMs)),
    samples: results.length,
    warmApplicationMedianMs: sample(
      results,
      (result) => result.page.warmReadiness?.applicationMs,
    ),
    warmExecutionMedianMs: sample(
      results,
      (result) => result.page.warmReadiness?.executionMs,
    ),
    warmMedianMs: sample(results, (result) => result.page.warmElapsedMs),
    stages: summarizeExecutionStages(results),
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

export function summarizeExecutionStages(results) {
  let values = new Map();
  for (let result of results) {
    let snapshots = [
      result.page.executionPerformance,
      ...(result.page.warmExecutionPerformance ?? []),
    ].filter(Boolean);
    for (let snapshot of snapshots) {
      for (let record of snapshot.records ?? []) {
        if (record.status !== 'ok') continue;
        let key = `${record.tier ?? 'host'}:${record.stage}`;
        let samples = values.get(key) ?? [];
        samples.push(record.durationMs);
        values.set(key, samples);
      }
    }
  }
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stage, samples]) => [
        stage,
        {
          medianMs: median(samples),
          p95Ms: percentile(samples, 0.95),
          samples: samples.length,
        },
      ]),
  );
}

function percentile(values, percentile) {
  if (!values.length) return undefined;
  let sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * percentile)];
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
  caseTimeoutMs,
  cases = executionRuntimeSmokeCases,
  continueOnReferenceDrift = false,
  onCaseComplete,
  performanceRepeats = 0,
  referenceTab,
  referenceOrigin = DEFAULT_REFERENCE_ORIGIN,
  timeoutMs = 20_000,
}) {
  if (!browser) throw new Error('browser is required');
  if (!candidateOrigin) throw new Error('candidateOrigin is required');

  let reference = await runOrigin(browser, referenceOrigin, cases, {
    caseTimeoutMs,
    checkExecution: false,
    collectPerformance: false,
    onCaseComplete,
    performanceRepeats,
    tab: referenceTab,
    timeoutMs,
  });
  let referenceFailures = reference.results.filter(
    (result) => !result.assessment.pass,
  );
  if (referenceFailures.length && !continueOnReferenceDrift) {
    return {
      candidate: null,
      reference,
      status: 'reference-drift',
    };
  }

  let candidateCases = referenceFailures.length
    ? cases.filter((smokeCase) =>
        reference.results.some(
          (result) => result.id === smokeCase.id && result.assessment.pass,
        ),
      )
    : cases;
  let candidate = await runOrigin(browser, candidateOrigin, candidateCases, {
    caseTimeoutMs,
    checkExecution: true,
    collectPerformance: performanceRepeats > 0,
    onCaseComplete,
    performanceRepeats,
    tab: candidateTab,
    timeoutMs,
  });
  for (let result of candidate.results) {
    let referenceResult = reference.results.find(
      (referenceCandidate) => referenceCandidate.id === result.id,
    );
    let smokeCase = cases.find(
      (candidateCase) => candidateCase.id === result.id,
    );
    if (!referenceResult || !smokeCase) continue;
    if (result.assessment.failures.includes('authentication-required')) {
      result.referenceParity = {
        failures: [],
        reason: 'candidate-authentication-required',
        skipped: true,
      };
      continue;
    }
    result.referenceParity = assessReferenceParity(
      result.page,
      referenceResult.page,
      smokeCase,
    );
    result.assessment.failures.push(...result.referenceParity.failures);
    result.assessment.failures = [...new Set(result.assessment.failures)];
    result.assessment.pass = result.assessment.failures.length === 0;
    result.assessment.status = classifySmokeOutcome(
      result.assessment.failures,
      result.page.readiness?.executionMs,
    );
  }
  let failures = candidate.results.filter((result) => !result.assessment.pass);
  let sandboxTeardown = await auditSandboxTeardown(
    candidate.tab,
    candidateOrigin,
    candidateCases,
    timeoutMs,
  );
  let sandboxLifecycle = await auditSandboxLifecycle(
    candidate.tab,
    candidateCases,
  );
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
      candidate: summarizePerformance(candidate, candidateCases),
      reference: summarizePerformance(reference, cases),
    },
    performanceWarnings,
    reference,
    sandboxLifecycle,
    sandboxTeardown,
    status: stoppedAtAuthentication
      ? 'candidate-authentication-required'
      : referenceFailures.length &&
          (failures.length ||
            sandboxLifecycle.failures.length ||
            sandboxTeardown.failures.length)
        ? 'reference-and-candidate-regression'
        : referenceFailures.length
          ? 'reference-drift'
          : failures.length ||
              sandboxLifecycle.failures.length ||
              sandboxTeardown.failures.length
            ? 'candidate-regression'
            : 'pass',
  };
}

/**
 * Run the curated smoke cohort against only the current candidate Host.
 *
 * Use this after the reference expectations have been captured. It keeps the
 * fast, repeated development lane independent from staging availability while
 * retaining the same semantic, interaction, execution, and lifecycle checks.
 * A candidate failure should still be compared with its live staging twin
 * before it is classified as a product regression.
 */
export async function runExecutionRuntimeCandidateSmoke({
  browser,
  candidateTab,
  candidateOrigin,
  caseTimeoutMs,
  cases = executionRuntimeSmokeCases,
  onCaseComplete,
  performanceRepeats = 0,
  timeoutMs = 20_000,
}) {
  if (!browser) throw new Error('browser is required');
  if (!candidateOrigin) throw new Error('candidateOrigin is required');

  let candidate = await runOrigin(browser, candidateOrigin, cases, {
    caseTimeoutMs,
    checkExecution: true,
    collectPerformance: performanceRepeats > 0,
    onCaseComplete,
    performanceRepeats,
    tab: candidateTab,
    timeoutMs,
  });
  let sandboxTeardown = await auditSandboxTeardown(
    candidate.tab,
    candidateOrigin,
    cases,
    timeoutMs,
  );
  let sandboxLifecycle = await auditSandboxLifecycle(candidate.tab, cases);
  let failures = candidate.results.filter((result) => !result.assessment.pass);

  return {
    candidate,
    sandboxLifecycle,
    sandboxTeardown,
    status:
      failures.length ||
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
        ? await settleSandboxFrame(
            tab,
            soakCase.mustContain,
            timeoutMs,
            soakCase.requiredSelectors,
          )
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
