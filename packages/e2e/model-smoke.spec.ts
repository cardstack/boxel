import { test, expect, type Page } from '@playwright/test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  allRoomEvents,
  loginWithPassword,
  type MatrixEvent,
} from './matrix-api.ts';
import { analyzeRoom, type RoomAnalysis } from './room-analysis.ts';

// One Playwright test per model. Each test: fresh workspace, new room, pick the
// model, send the prompt, wait for the bot to go idle, check a card rendered,
// then read the room's events for the numbers. Results go to smoke-results/.

const RESULTS_DIR = join(import.meta.dirname, 'smoke-results');
const PROMPT =
  process.env.SMOKE_PROMPT ?? 'create a hello world card and show it';
// One matrix user per model. The ai-bot runs every generation of one user
// inside a per-user cost lock that spans all of that user's rooms, so two
// models prompted as the same user take turns: the second waits, showing
// "Thinking...", until the first model's turn ends. The users come from
// `pnpm register-test-user` in packages/matrix (MATRIX_USERNAME=smoke1 ...).
const USERS = (
  process.env.SMOKE_USERS ??
  process.env.SMOKE_USER ??
  'smoke1,smoke2,smoke3,smoke4,smoke5'
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'password';
function userForModel(index: number): string {
  return USERS[index % USERS.length];
}
const BOT_USER_ID = process.env.SMOKE_BOT_USER ?? '@aibot:localhost';
// The only time-based stop, and a safety net rather than a benchmark: a run
// that is still going after this long is not going to finish. Slow runs are
// graded afterwards, never cut short.
const MAX_MINUTES = Number(process.env.SMOKE_MAX_MINUTES ?? 15);
// A pill that stays in "applying" this long is a stuck host, not a slow tool:
// the host's own tool timeout is two minutes.
const STUCK_APPLYING_MS = 150_000;
// A turn that shows "Generating results" with no new text for this long is a
// stalled request between the ai-bot and the provider; the bot has no timeout
// of its own for it.
const STALLED_GENERATION_MS = 180_000;
// If the bot has not started a single reply this long after the prompt, it is
// not slow: it never saw the message. The usual cause is an invite the ai-bot
// missed, so it never joined the room.
const NO_REPLY_MS = 120_000;
// The bot starts its next message within a second or two of a tool result or
// a patch landing; the correctness check takes a few seconds more. Idle has
// to hold this long before it counts.
const QUIET_WINDOW_MS = 10_000;

// Models are given by the name the picker shows (substring, case-insensitive),
// because picker options are keyed by ModelConfiguration card id, not model id.
// The model id actually used is read back from the room and recorded.
// Workers start this far apart. Every worker logs in as the same user, and
// the host opens that user's most recent room; if it is empty the runner uses
// it. Two tabs reaching that step at the same moment would share a room, so
// the starts are staggered to keep the room steps apart.
const STAGGER_MS = Number(process.env.SMOKE_STAGGER_SECONDS ?? 40) * 1000;
let staggered = false;

const MODELS = (process.env.SMOKE_MODELS ?? 'Claude Sonnet 4.6')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

type Verdict =
  | 'pass'
  | 'model-failure'
  | 'host-failure'
  | 'bot-failure'
  | 'runner-failure';

interface RunResult {
  requestedModel: string;
  modelId: string | undefined;
  reasoningEffort: string | null | undefined;
  roomId: string | undefined;
  realmUrl: string | undefined;
  verdict: Verdict;
  reasons: string[];
  cardRendered: string | undefined;
  renderedIn: 'stack' | 'preview' | undefined;
  durationSeconds: number;
  stoppedBy:
    | 'idle'
    | 'wall-clock'
    | 'stuck'
    | 'stalled'
    | 'no-reply'
    | 'irregularity'
    | 'error';
  irregularities: string[];
  analysis: RoomAnalysis | undefined;
  screenshot: string | undefined;
  consoleErrors: string[];
  error?: string;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function loginViaLocalStorage(page: Page, username: string) {
  let credentials = await loginWithPassword(username, PASSWORD);
  await page.context().addInitScript(
    (auth) => {
      window.localStorage.setItem('auth', JSON.stringify(auth));
    },
    {
      access_token: credentials.accessToken,
      user_id: credentials.userId,
      device_id: credentials.deviceId,
      home_server: credentials.homeServer,
    },
  );
  await page.goto('/');
  let rendered = page
    .locator(
      '[data-test-workspace-chooser], [data-test-workspace-chooser-toggle], [data-test-login-form]',
    )
    .first();
  // The first tab of a fresh browser context can lose every module load to
  // Chromium's ERR_CERT_VERIFIER_CHANGED: the ignore-certificate-errors setting
  // lands while the page is already loading. A reload after a short wait
  // recovers it. A dev-server rebuild can also leave the page blank for a
  // minute or more on the first request, hence the long second wait.
  if (!(await rendered.isVisible({ timeout: 15_000 }).catch(() => false))) {
    await page.reload();
  }
  await expect(rendered).toBeVisible({ timeout: 180_000 });
  if ((await page.locator('[data-test-login-form]').count()) > 0) {
    throw new Error(
      'the stored matrix session was not accepted; the login form rendered',
    );
  }
  return credentials;
}

async function createWorkspace(
  page: Page,
  displayName: string,
  endpoint: string,
) {
  // A fresh login lands on the chooser; a restored session lands in the last
  // workspace, where the chooser is behind a toggle. Wait for whichever is
  // there before deciding.
  let chooser = page.locator('[data-test-workspace-chooser]');
  let toggle = page.locator('[data-test-workspace-chooser-toggle]');
  await expect(chooser.or(toggle).first()).toBeVisible({ timeout: 60_000 });
  if (!(await chooser.isVisible())) {
    await toggle.click();
    await chooser.waitFor();
  }
  await page.locator('[data-test-add-workspace]').click();
  await page.locator('[data-test-display-name-field]').fill(displayName);
  await page.locator('[data-test-endpoint-field]').fill(endpoint);
  await page.locator('[data-test-create-workspace-submit]').click();
  // Provisioning blocks until the new realm is indexed; the modal closes on
  // success and shows an error otherwise.
  let tile = page.locator(
    `[data-test-workspace-list] [data-test-workspace="${displayName}"]`,
  );
  let error = page.locator(
    '[data-test-create-workspace-modal] [data-test-error-message]',
  );
  await expect(tile.or(error).first()).toBeVisible({ timeout: 120_000 });
  if (await error.isVisible()) {
    throw new Error(`workspace creation failed: ${await error.textContent()}`);
  }
  await page.locator(`[data-test-workspace-button="${displayName}"]`).click();
  let indexCard = page
    .locator('[data-test-operator-mode-stack="0"] [data-test-stack-card]')
    .first();
  await indexCard.waitFor({ timeout: 60_000 });
  let indexId = await indexCard.getAttribute('data-test-stack-card');
  if (!indexId?.endsWith('index')) {
    throw new Error(
      `expected the workspace index card to open, got ${indexId}`,
    );
  }
  return indexId.slice(0, -'index'.length);
}

async function openRoom(page: Page) {
  let panel = page.locator('[data-test-ai-assistant-panel]');
  if (!(await panel.isVisible())) {
    await page.locator('[data-test-open-ai-assistant]').click();
    await panel.waitFor();
  }
  await page.locator('[data-test-room]').waitFor({ timeout: 60_000 });
  await page.locator('[data-test-room-settled]').waitFor({ timeout: 60_000 });
  // "New session" is disabled while the current room has no messages, and an
  // empty current room is already what we want. Otherwise start a fresh one.
  let createButton = page.locator(
    '[data-test-create-room-btn]:not([disabled])',
  );
  if ((await createButton.count()) > 0) {
    let before = await page
      .locator('[data-test-room]')
      .getAttribute('data-test-room');
    await createButton.click();
    await expect
      .poll(async () =>
        page.locator('[data-test-room]').getAttribute('data-test-room'),
      )
      .not.toBe(before);
    await page.locator('[data-test-room-settled]').waitFor({ timeout: 60_000 });
  }
  let roomId = await page
    .locator('[data-test-room]')
    .getAttribute('data-test-room');
  if (!roomId) {
    throw new Error('no room id on the room element');
  }
  return roomId;
}

async function selectModel(page: Page, requested: string) {
  await page.locator('[data-test-llm-select-selected]').click();
  let items = page.locator('[data-test-llm-select-item]');
  await items.first().waitFor();
  let names = await items.locator('.llm-name').allTextContents();
  let wanted = requested.toLowerCase();
  let all = names.map((name, index) => ({ name: name.trim(), index }));
  // "GPT-5.4" must not also match "GPT-5.4 Mini": prefer an option whose name
  // is exactly the request, or ends with it as a whole word (the vendor prefix
  // is optional), and only then fall back to a substring match.
  let escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let exact = all.filter((o) => o.name.toLowerCase() === wanted);
  let suffix = all.filter((o) =>
    new RegExp(`(^|[:\\s])${escaped}$`, 'i').test(o.name),
  );
  let substring = all.filter((o) => o.name.toLowerCase().includes(wanted));
  let matches = exact.length ? exact : suffix.length ? suffix : substring;
  if (matches.length !== 1) {
    await page.keyboard.press('Escape');
    throw new Error(
      `model "${requested}" matched ${matches.length} picker options: ${
        matches.map((m) => m.name).join(' | ') || '(none)'
      }. Available: ${names.join(' | ')}`,
    );
  }
  await items.nth(matches[0].index).locator('button').click();
  await expect(page.locator('[data-test-llm-select-selected]')).toContainText(
    matches[0].name,
  );
  // The picker stays expanded after a choice and hides the mode toggle while
  // it is open. Escape does not close it; a second click on the pill does.
  if ((await page.locator('[data-test-llm-select-item]').count()) > 0) {
    await page.locator('[data-test-llm-select-selected]').click();
  }
  await expect(page.locator('[data-test-llm-select-item]')).toHaveCount(0, {
    timeout: 15_000,
  });
  return matches[0].name;
}

// Put the room in Act mode right after the model is picked. In Ask mode every
// tool and patch waits for a click nobody makes. The toggle renders only once
// the room knows its model, a moment after the pick, so wait for it rather
// than reading "not there yet" as "not needed"; then confirm the click took.
async function ensureActMode(page: Page, requestedModel: string) {
  let act = page.locator('[data-test-llm-mode-option="act"]');
  await act.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await act.evaluate((el) => el.classList.contains('selected')))) {
    await act.click();
  }
  await expect(act, `${requestedModel}: room is in Act mode`).toHaveClass(
    /selected/,
    { timeout: 30_000 },
  );
  console.log(`[smoke] ${requestedModel}: mode toggle shows act`);
}

// The prompt must go out while the tab is inside the new workspace: the host
// stamps the current realm and open cards onto the message, and a model that
// is told "workspace chooser, no realm" picks any workspace from the list.
async function ensureInsideWorkspace(page: Page, realmUrl: string) {
  let chooser = page.locator('[data-test-workspace-chooser]');
  let indexCard = page.locator(`[data-test-stack-card="${realmUrl}index"]`);
  if ((await chooser.count()) > 0 || (await indexCard.count()) === 0) {
    // Re-enter through the URL rather than the tile, so this works whatever
    // state the chooser is in.
    let state = encodeURIComponent(
      JSON.stringify({
        stacks: [[{ id: `${realmUrl}index`, format: 'isolated' }]],
        submode: 'interact',
        workspaceChooserOpened: false,
        aiAssistantOpen: true,
      }),
    );
    await page.goto(`/?operatorModeState=${state}`);
    await indexCard.waitFor({ timeout: 60_000 });
    await page.locator('[data-test-room-settled]').waitFor({ timeout: 60_000 });
  }
  await expect(chooser).toHaveCount(0);
  await expect(indexCard).toBeVisible();
}

async function sendPrompt(page: Page, roomId: string, prompt: string) {
  // Session preparation (skills context) can take a while on a new room.
  await expect(page.locator('[data-test-session-preparation]')).toHaveCount(0, {
    timeout: 90_000,
  });
  await page.locator(`[data-test-message-field="${roomId}"]`).fill(prompt);
  await page.locator('[data-test-can-send-msg]').waitFor();
  await page.locator('[data-test-send-message-btn]').click();
  await expect(
    page.locator(`[data-test-message-field="${roomId}"]`),
  ).toHaveValue('');
  // With parallel workers on one account, a second tab could have landed in
  // this same empty room. Then two prompts share it and neither result means
  // anything; fail the run rather than grade a mixed room.
  await expect(page.locator('[data-test-user-message]')).toHaveCount(1);
}

interface Activity {
  idle: boolean;
  botMessages: number;
  applying: number;
  generating: boolean;
  errorAlerts: number;
  // Length of all bot text on the page: a turn that is "generating" while this
  // stays flat for minutes is a stalled provider or ai-bot, not a slow model.
  botTextLength: number;
  // Signs that the run has already gone wrong and every further turn is
  // wasted money: a failed or invalid tool pill, an error alert, or a
  // SEARCH/REPLACE block in git-conflict syntax (the host cannot apply it).
  irregularities: string[];
}

async function readActivity(page: Page): Promise<Activity> {
  return page.evaluate(() => {
    let q = (sel: string) => document.querySelectorAll(sel).length;
    let settled = q('[data-test-room-settled]') > 0;
    let actionBar = q('[data-test-ai-assistant-action-bar]');
    let applying =
      q('[data-test-apply-state="applying"]') +
      q('[data-test-apply-state="preparing"]');
    let loading =
      q('[data-test-code-patch-loading]') +
      q('[data-test-session-preparation]');
    let pending = q('[data-test-ai-assistant-message-pending="true"]');
    let generating = q('[data-test-stop-generating]') > 0;
    let irregularities: string[] = [];
    let failed = q('[data-test-apply-state="failed"]');
    let invalid = q('[data-test-apply-state="invalid"]');
    let errorAlerts = q('[data-test-boxel-alert="error"]');
    // A failed or rejected call is something a model can notice and correct:
    // the host tells it what was wrong, and a normal repair takes two or three
    // rounds, each of which can fail once more before it lands. Only a fourth
    // failing turn reads as a run going sideways; stopping at two cut off a
    // Haiku run two seconds before its card appeared. Count turns, not pills:
    // one fix reply can carry several blocks that all fail together.
    let messagesWithFailures = Array.from(
      document.querySelectorAll('[data-test-message-idx]'),
    ).filter(
      (m) =>
        m.querySelector(
          '[data-test-apply-state="failed"], [data-test-apply-state="invalid"]',
        ) || m.querySelector('[data-test-boxel-alert="error"]'),
    ).length;
    if (messagesWithFailures >= 4) {
      irregularities.push(
        `${messagesWithFailures} turns had a failed or rejected tool call or patch (${failed} failed, ${invalid} invalid, ${errorAlerts} error alerts)`,
      );
    }
    let gitStyle = Array.from(
      document.querySelectorAll('[data-test-ai-message-content]'),
    ).filter((el) => (el.textContent ?? '').includes('<<<<<<< SEARCH')).length;
    if (gitStyle)
      irregularities.push(
        'a block uses git-conflict markers, which the host cannot apply',
      );
    // A loop: the same tool call, with the same arguments, three times.
    let calls = Array.from(
      document.querySelectorAll('[data-test-tool-code-block]'),
    ).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    let seen = new Map<string, number>();
    for (let call of calls) seen.set(call, (seen.get(call) ?? 0) + 1);
    if ([...seen.values()].some((n) => n >= 3)) {
      irregularities.push(
        'the same tool call was made three times with the same arguments',
      );
    }
    return {
      idle:
        settled &&
        actionBar === 0 &&
        applying === 0 &&
        loading === 0 &&
        pending === 0,
      // Finished bot turns, not messages: every completed turn renders its
      // token usage, while tool results and correctness notes are messages too.
      botMessages: q('[data-test-token-usage]'),
      applying,
      generating,
      errorAlerts,
      irregularities,
      botTextLength: Array.from(
        document.querySelectorAll(
          '[data-test-ai-message-content], [data-test-reasoning]',
        ),
      ).reduce((sum, el) => sum + (el.textContent ?? '').length, 0),
    };
  });
}

async function stopGeneration(page: Page) {
  let stop = page.locator('[data-test-stop-generating]');
  if (await stop.isVisible()) {
    await stop.click();
  }
}

// Waits for the bot to finish on its own. A run is cut short only when it has
// clearly gone sideways: a failed or invalid tool call, an error alert, a
// block the host cannot apply, a repeated identical tool call, a pill stuck
// past the host's own tool timeout, or the safety wall clock. Long, slow, or
// expensive runs are not stopped; they are graded afterwards.
async function waitForIdle(
  page: Page,
): Promise<{ stoppedBy: RunResult['stoppedBy']; irregularities: string[] }> {
  let deadline = Date.now() + MAX_MINUTES * 60_000;
  let idleSince: number | undefined;
  let applyingSince: number | undefined;
  let flatSince: number | undefined;
  let lastTextLength = -1;
  let startedAt = Date.now();
  for (;;) {
    let now = Date.now();
    let activity = await readActivity(page);
    if (
      activity.botMessages === 0 &&
      !activity.generating &&
      now - startedAt > NO_REPLY_MS
    ) {
      return { stoppedBy: 'no-reply', irregularities: [] };
    }
    if (activity.generating && activity.botTextLength === lastTextLength) {
      flatSince ??= now;
      if (now - flatSince > STALLED_GENERATION_MS) {
        await stopGeneration(page);
        return { stoppedBy: 'stalled', irregularities: [] };
      }
    } else {
      flatSince = undefined;
    }
    lastTextLength = activity.botTextLength;
    if (activity.applying > 0) {
      applyingSince ??= now;
      if (now - applyingSince > STUCK_APPLYING_MS) {
        return { stoppedBy: 'stuck', irregularities: [] };
      }
    } else {
      applyingSince = undefined;
    }
    if (activity.irregularities.length > 0) {
      // Something already went wrong. Letting the model carry on only spends
      // more turns on a broken path; stop it and read the room instead.
      await stopGeneration(page);
      return {
        stoppedBy: 'irregularity',
        irregularities: activity.irregularities,
      };
    }
    if (activity.idle && activity.botMessages > 0) {
      idleSince ??= now;
      if (now - idleSince >= QUIET_WINDOW_MS) {
        return { stoppedBy: 'idle', irregularities: [] };
      }
    } else {
      idleSince = undefined;
    }
    if (now > deadline) {
      await stopGeneration(page);
      return { stoppedBy: 'wall-clock', irregularities: [] };
    }
    await page.waitForTimeout(2_000);
  }
}

// A shown card can land in two places: the interact-mode stack, or the
// code-mode preview panel when the model switched to code mode first. Both
// render the instance through the card renderer, which stamps
// `data-test-card="<id>"`, so look for that anywhere on the page.
async function findRenderedCard(page: Page, realmUrl: string) {
  let cardIds: string[] = [];
  try {
    await expect
      .poll(
        async () => {
          let ids = (await page
            .locator('[data-test-card]')
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute('data-test-card')),
            )) as (string | null)[];
          cardIds = [
            ...new Set(
              ids.filter(
                (id): id is string =>
                  !!id && id.startsWith(realmUrl) && !id.endsWith('index'),
              ),
            ),
          ];
          return cardIds.length;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
  } catch {
    return {
      cardId: undefined,
      reasons: [
        'no card from the new workspace is rendered, in the stack or the preview panel',
      ],
      where: undefined,
    };
  }
  let cardId = cardIds[cardIds.length - 1];
  let reasons: string[] = [];
  await expect(page.locator('[data-test-stack-item-loading-card]')).toHaveCount(
    0,
    {
      timeout: 60_000,
    },
  );
  if ((await page.locator(`[data-test-card-error="${cardId}"]`).count()) > 0) {
    reasons.push('the card renders an error boundary');
  }
  if (
    (await page
      .locator(`[data-test-card-awaiting-index="${cardId}"]`)
      .count()) > 0
  ) {
    reasons.push('the card is still awaiting indexing');
  }
  let inStack =
    (await page.locator(`[data-test-stack-card="${cardId}"]`).count()) > 0;
  return {
    cardId,
    reasons,
    where: (inStack ? 'stack' : 'preview') as 'stack' | 'preview',
  };
}

function activeLLM(events: MatrixEvent[]) {
  let latest = [...events]
    .filter((e) => e.type === 'app.boxel.active-llm')
    .sort((a, b) => b.origin_server_ts - a.origin_server_ts)[0];
  return latest?.content as
    | { model?: string; reasoningEffort?: string | null }
    | undefined;
}

function classify(
  stoppedBy: RunResult['stoppedBy'],
  irregularities: string[],
  cardReasons: string[],
  cardId: string | undefined,
  analysis: RoomAnalysis,
): { verdict: Verdict; reasons: string[] } {
  let reasons: string[] = [];
  if (stoppedBy === 'irregularity') {
    reasons.push(`stopped early: ${irregularities.join('; ')}`);
  }
  if (stoppedBy === 'stuck') {
    reasons.push('a tool pill stayed in "applying" past the host tool timeout');
    return { verdict: 'host-failure', reasons };
  }
  if (stoppedBy === 'no-reply') {
    reasons.push(
      `the bot never started a reply within ${NO_REPLY_MS / 1000}s of the prompt; check whether the ai-bot joined the room (a missed invite leaves it in "invite" state forever)`,
    );
    return { verdict: 'bot-failure', reasons };
  }
  if (stoppedBy === 'stalled') {
    reasons.push(
      `the bot showed "Generating results" with nothing streamed for ${STALLED_GENERATION_MS / 1000}s: the provider is either hung or reasoning without streaming; the room shows whether the turn completed later`,
    );
    return { verdict: 'bot-failure', reasons };
  }
  if (analysis.unansweredToolCalls > 0) {
    reasons.push(
      `${analysis.unansweredToolCalls} tool call(s) never got a result`,
    );
    return { verdict: 'host-failure', reasons };
  }
  if (analysis.gitStyleBlocks > 0) {
    reasons.push(
      `${analysis.gitStyleBlocks} block(s) used git-style markers instead of the box markers`,
    );
  }
  if (analysis.patchBlocks === 0) {
    reasons.push('no SEARCH/REPLACE block was written');
  }
  if (analysis.patchResults.failed > 0) {
    reasons.push(`${analysis.patchResults.failed} patch(es) failed to apply`);
  }
  if (stoppedBy === 'wall-clock') {
    reasons.push(
      `still running after ${MAX_MINUTES} minutes, stopped as a safety measure`,
    );
  }
  if (!cardId) {
    reasons.push(...cardReasons);
  } else if (cardReasons.length) {
    reasons.push(...cardReasons);
  }
  if (cardId && cardReasons.length === 0 && analysis.patchBlocks > 0) {
    return { verdict: 'pass', reasons };
  }
  return { verdict: 'model-failure', reasons };
}

// The one-word answer per model. GOOD: passed and inside every benchmark.
// ROUGH: passed, but a benchmark was missed (more turns, switches, or time
// than a good run needs). FAIL: no card, or the run had to be stopped. Cost is
// reported in its own column but does not grade: it tracks the model's price
// class more than its behaviour, and an Opus run would be ROUGH for doing the
// same work as a Sonnet run.
type Grade = '✅ GOOD' | '🟡 ROUGH' | '❌ FAIL';

const BENCHMARKS = {
  maxTurns: 5,
  maxModeSwitches: 1,
  maxSeconds: 120,
};

function grade(result: RunResult): { grade: Grade; misses: string[] } {
  if (result.verdict !== 'pass' || !result.analysis) {
    return { grade: '❌ FAIL', misses: [] };
  }
  let a = result.analysis;
  let misses: string[] = [];
  if (a.turns > BENCHMARKS.maxTurns) {
    misses.push(`${a.turns} turns (target ≤ ${BENCHMARKS.maxTurns})`);
  }
  let switches = Object.entries(a.toolCalls)
    .filter(([name]) => name.startsWith('switch-submode'))
    .reduce((sum, [, count]) => sum + count, 0);
  if (switches > BENCHMARKS.maxModeSwitches) {
    misses.push(
      `${switches} mode switches (target ≤ ${BENCHMARKS.maxModeSwitches})`,
    );
  }
  if (result.durationSeconds > BENCHMARKS.maxSeconds) {
    misses.push(
      `${result.durationSeconds}s (target ≤ ${BENCHMARKS.maxSeconds}s)`,
    );
  }
  if (a.patchResults.failed > 0 || a.failedToolCalls.length > 0) {
    misses.push('a patch or tool call failed along the way');
  }
  if (a.cacheMisses > 0) {
    misses.push(`${a.cacheMisses} turn(s) missed the prompt cache`);
  }
  return { grade: misses.length ? '🟡 ROUGH' : '✅ GOOD', misses };
}

// Not `serial`: serial mode skips every remaining test after one failure, and
// a sweep must keep going when one model fails. Runs are still one at a time,
// the config has a single worker.

test.beforeAll(async () => {
  await mkdir(RESULTS_DIR, { recursive: true });
});

async function runModel(
  page: Page,
  requestedModel: string,
  username: string,
): Promise<RunResult> {
  let slug = slugify(requestedModel);
  let startedAt = Date.now();
  let consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  page.on('pageerror', (error) =>
    consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`),
  );
  let result: RunResult = {
    requestedModel,
    modelId: undefined,
    reasoningEffort: undefined,
    roomId: undefined,
    realmUrl: undefined,
    verdict: 'runner-failure',
    reasons: [],
    cardRendered: undefined,
    renderedIn: undefined,
    durationSeconds: 0,
    stoppedBy: 'error',
    irregularities: [],
    analysis: undefined,
    screenshot: undefined,
    consoleErrors: [],
  };
  let credentials: Awaited<ReturnType<typeof loginWithPassword>> | undefined;
  let step = 'start';
  try {
    step = 'login';
    console.log(`[smoke] ${requestedModel} runs as @${username}`);
    credentials = await loginViaLocalStorage(page, username);
    // Human-readable stamp so the workspace list reads "Smoke Claude Opus
    // 4.8 2026-09-07 12:43"; the endpoint gets the same stamp, slug-safe.
    let now = new Date();
    let pad = (n: number) => String(n).padStart(2, '0');
    let stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
      now.getHours(),
    )}:${pad(now.getMinutes())}`;
    step = 'create workspace';
    result.realmUrl = await createWorkspace(
      page,
      `Smoke ${requestedModel} ${stamp}`,
      `smoke-${slug}-${slugify(stamp)}`.slice(0, 60),
    );
    step = 'open room';
    result.roomId = await openRoom(page);
    step = 'select model';
    await selectModel(page, requestedModel);
    step = 'set act mode';
    await ensureActMode(page, requestedModel);
    step = 'confirm the tab is inside the new workspace';
    await ensureInsideWorkspace(page, result.realmUrl);
    step = 'send prompt';
    await sendPrompt(page, result.roomId, PROMPT);
    step = 'wait for idle';
    let waited = await waitForIdle(page);
    result.stoppedBy = waited.stoppedBy;
    result.irregularities = waited.irregularities;
    step = 'check render';

    let rendered = await findRenderedCard(page, result.realmUrl);
    result.cardRendered = rendered.cardId;
    result.renderedIn = rendered.where;
    result.screenshot = join(RESULTS_DIR, `${slug}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: false });

    let events = await allRoomEvents(result.roomId, credentials.accessToken);
    let llm = activeLLM(events);
    result.modelId = llm?.model;
    result.reasoningEffort = llm?.reasoningEffort;
    result.analysis = analyzeRoom(events, BOT_USER_ID);
    let verdict = classify(
      result.stoppedBy,
      result.irregularities,
      rendered.reasons,
      rendered.cardId,
      result.analysis,
    );
    result.verdict = verdict.verdict;
    result.reasons = verdict.reasons;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.reasons.push(
      `runner error during "${step}": ${result.error.split('\n').slice(0, 3).join(' ')}`,
    );
    try {
      result.screenshot = join(RESULTS_DIR, `${slug}.png`);
      await page.screenshot({ path: result.screenshot });
    } catch {
      // the page may be gone
    }
    if (result.roomId && credentials) {
      try {
        let events = await allRoomEvents(
          result.roomId,
          credentials.accessToken,
        );
        result.analysis = analyzeRoom(events, BOT_USER_ID);
        result.modelId = activeLLM(events)?.model;
      } catch {
        // best effort
      }
    }
  } finally {
    result.durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    result.consoleErrors = consoleErrors.slice(0, 50);
    await writeFile(
      join(RESULTS_DIR, `${slug}.json`),
      JSON.stringify(result, null, 2),
    );
    let graded = grade(result);
    console.log(
      `[smoke] ${graded.grade} ${requestedModel}: ${result.verdict}` +
        (result.reasons.length ? ` — ${result.reasons.join('; ')}` : '') +
        (graded.misses.length ? ` — ${graded.misses.join('; ')}` : '') +
        (result.roomId ? ` (room ${result.roomId})` : ''),
    );
  }
  return result;
}

// Two ways to run a sweep. Workers: one Playwright test per model, run by
// parallel workers, each in its own browser (headless). Tabs: one test that
// opens every model as a tab of one browser, for watching a sweep in a single
// headed window. Same flow either way.
const TABS_MODE = ['1', 'true'].includes(process.env.SMOKE_TABS ?? '');

if (MODELS.length > USERS.length) {
  console.warn(
    `[smoke] ${MODELS.length} models but only ${USERS.length} users (SMOKE_USERS): models sharing a user run one after the other, not side by side`,
  );
}

if (TABS_MODE) {
  test(`${MODELS.length} models in tabs: ${PROMPT}`, async ({
    browser,
    baseURL,
  }) => {
    let results = await Promise.all(
      MODELS.map(async (model, index) => {
        await new Promise((resolve) => setTimeout(resolve, index * STAGGER_MS));
        // Each model gets its own context (an incognito window of the same
        // browser): the login lives in localStorage, so one context can only
        // be one user.
        let context = await browser.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: 1600, height: 1000 },
          baseURL: baseURL ?? undefined,
        });
        let page = await context.newPage();
        return runModel(page, model, userForModel(index));
      }),
    );
    let failed = results
      .filter((r) => r.verdict !== 'pass')
      .map((r) => `${r.requestedModel}: ${r.reasons.join('; ')}`);
    expect(failed, 'every model passes').toEqual([]);
  });
} else {
  MODELS.forEach((requestedModel, index) => {
    test(`${requestedModel}: ${PROMPT}`, async ({ page }) => {
      if (!staggered) {
        staggered = true;
        await page.waitForTimeout(test.info().parallelIndex * STAGGER_MS);
      }
      let result = await runModel(page, requestedModel, userForModel(index));
      expect(result.verdict, result.reasons.join('; ')).toBe('pass');
    });
  });
}

test.afterAll(async () => {
  let files = (await readdir(RESULTS_DIR)).filter(
    (f) => f.endsWith('.json') && f !== 'playwright.json',
  );
  let rows: RunResult[] = [];
  for (let file of files) {
    rows.push(JSON.parse(await readFile(join(RESULTS_DIR, file), 'utf8')));
  }
  rows.sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));
  let header =
    '| Result | Model | Effort | Verdict | Turns | Tool calls | Blocks | Cost | Cache | Time | Card | Notes |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  let body = rows
    .map((r) => {
      let a = r.analysis;
      let graded = grade(r);
      let tools = a
        ? Object.entries(a.toolCalls)
            .map(
              ([name, count]) =>
                `${name.replace(/_[0-9a-f]{4}$/, '')}×${count}`,
            )
            .join(', ')
        : '';
      let blocks = a
        ? `${a.patchBlocks}${a.gitStyleBlocks ? ` (+${a.gitStyleBlocks} git-style)` : ''}`
        : '';
      return `| ${graded.grade} | ${r.modelId ?? r.requestedModel} | ${r.reasoningEffort ?? '–'} | ${r.verdict} | ${
        a?.turns ?? '–'
      } | ${tools} | ${blocks} | ${a ? `$${a.costUsd.toFixed(3)}` : '–'} | ${
        a && a.cacheWindowInputTokens > 0
          ? `${Math.round((100 * a.cacheWindowCachedTokens) / a.cacheWindowInputTokens)}%${
              a.cacheMisses ? ` (${a.cacheMisses} miss)` : ''
            }`
          : '–'
      } | ${r.durationSeconds}s | ${
        r.cardRendered ? `yes (${r.renderedIn})` : 'no'
      } | ${[...r.reasons, ...graded.misses, r.roomId ? `room ${r.roomId}` : ''].filter(Boolean).join('; ')} |`;
    })
    .join('\n');
  let summary = `# Model smoke results\n\nPrompt: \`${PROMPT}\`\n\n${header}${body}\n`;
  await writeFile(join(RESULTS_DIR, 'summary.md'), summary);
  console.log(`\n${summary}`);
});
