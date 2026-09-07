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
const USERNAME = process.env.SMOKE_USER ?? 'user';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'password';
const BOT_USER_ID = process.env.SMOKE_BOT_USER ?? '@aibot:localhost';
// The only time-based stop, and a safety net rather than a benchmark: a run
// that is still going after this long is not going to finish. Slow runs are
// graded afterwards, never cut short.
const MAX_MINUTES = Number(process.env.SMOKE_MAX_MINUTES ?? 15);
// A pill that stays in "applying" this long is a stuck host, not a slow tool:
// the host's own tool timeout is two minutes.
const STUCK_APPLYING_MS = 150_000;
// The bot starts its next message within a second or two of a tool result or
// a patch landing; the correctness check takes a few seconds more. Idle has
// to hold this long before it counts.
const QUIET_WINDOW_MS = 10_000;

// Models are given by the name the picker shows (substring, case-insensitive),
// because picker options are keyed by ModelConfiguration card id, not model id.
// The model id actually used is read back from the room and recorded.
const MODELS = (process.env.SMOKE_MODELS ?? 'Claude Sonnet 4.6')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

type Verdict = 'pass' | 'model-failure' | 'host-failure' | 'runner-failure';

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
  stoppedBy: 'idle' | 'wall-clock' | 'stuck' | 'irregularity' | 'error';
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

async function loginViaLocalStorage(page: Page) {
  let credentials = await loginWithPassword(USERNAME, PASSWORD);
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
  // A dev-server rebuild can leave the page blank for a minute or more on the
  // first request. Wait for the app to actually render something, either the
  // chooser or operator mode, before deciding the session did not restore.
  await expect(
    page
      .locator(
        '[data-test-workspace-chooser], [data-test-workspace-chooser-toggle], [data-test-login-form]',
      )
      .first(),
  ).toBeVisible({ timeout: 180_000 });
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
  let matches = names
    .map((name, index) => ({ name: name.trim(), index }))
    .filter((o) => o.name.toLowerCase().includes(requested.toLowerCase()));
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
  // The picker is a pill menu that stays expanded after a choice; close it so
  // it does not cover the mode toggle or the screenshot.
  if ((await page.locator('[data-test-llm-select-item]').count()) > 0) {
    await page.keyboard.press('Escape');
  }
  return matches[0].name;
}

async function ensureActMode(page: Page) {
  let act = page.locator('[data-test-llm-mode-option="act"]');
  if (await act.isVisible()) {
    await act.click();
  }
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
}

interface Activity {
  idle: boolean;
  botMessages: number;
  applying: number;
  generating: boolean;
  errorAlerts: number;
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
    if (failed)
      irregularities.push(`${failed} tool call(s) or patch(es) failed`);
    if (invalid)
      irregularities.push(`${invalid} tool call(s) rejected as invalid`);
    if (errorAlerts) irregularities.push(`${errorAlerts} error alert(s) shown`);
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
  for (;;) {
    let now = Date.now();
    let activity = await readActivity(page);
    if (activity.irregularities.length > 0) {
      // Something already went wrong. Letting the model carry on only spends
      // more turns on a broken path; stop it and read the room instead.
      await stopGeneration(page);
      return {
        stoppedBy: 'irregularity',
        irregularities: activity.irregularities,
      };
    }
    if (activity.applying > 0) {
      applyingSince ??= now;
      if (now - applyingSince > STUCK_APPLYING_MS) {
        return { stoppedBy: 'stuck', irregularities: [] };
      }
    } else {
      applyingSince = undefined;
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
// WARNING: passed, but a benchmark was missed (more turns, switches, cost, or
// time than a good run needs). FAIL: no card, or the run had to be stopped.
type Grade = '✅ GOOD' | '⚠️ WARNING' | '❌ FAIL';

const BENCHMARKS = {
  maxTurns: 5,
  maxModeSwitches: 1,
  maxCostUsd: 0.2,
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
  if (a.costUsd > BENCHMARKS.maxCostUsd) {
    misses.push(
      `$${a.costUsd.toFixed(2)} (target ≤ $${BENCHMARKS.maxCostUsd.toFixed(2)})`,
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
  return { grade: misses.length ? '⚠️ WARNING' : '✅ GOOD', misses };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await mkdir(RESULTS_DIR, { recursive: true });
});

for (let requestedModel of MODELS) {
  test(`${requestedModel}: ${PROMPT}`, async ({ page }) => {
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
      credentials = await loginViaLocalStorage(page);
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
      await ensureActMode(page);
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
    expect(result.verdict, result.reasons.join('; ')).toBe('pass');
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
        a && a.inputTokens > 0
          ? `${Math.round((100 * a.cachedTokens) / a.inputTokens)}%${
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
