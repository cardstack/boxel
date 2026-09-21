#!/usr/bin/env node
// Runs one EvaluationCard against a list of models and records the outcome
// as cards in the evaluation's realm: one EvaluationReportCard for the
// session, one EvaluationResultCard per model. The browser work is the
// Playwright spec; this wraps it.
//
//   node run-eval.ts https://localhost:4201/experiments/Evaluation/hello-world
//   node run-eval.ts <eval-card-url> "Claude Sonnet 4.6,GPT-5.5" --headed
//
// Options: --headed (one browser window, one model at a time), --tabs (one
// window, one tab per model), --session <id> (add these models to an earlier
// session: same session id, same report card, rows appended), --no-cards
// (run and grade, write nothing to the realm). Env knobs are the spec's
// (EVAL_USERS, EVAL_PASSWORD, EVAL_HOST_URL, EVAL_MATRIX_URL, ...).
// EVAL_WRITER_USER / EVAL_WRITER_PASSWORD (default user / password) is the
// matrix user that owns the evaluations workspace (see eval-setup.ts) and
// writes the cards; the eval users only drive the browsers.

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loginWithPassword } from './matrix-api.ts';
import { RealmClient, type CardDocument } from './realm-api.ts';
import { loadEvaluationBundle, type Evaluation } from './eval-card.ts';
import { WRITER_PASSWORD, WRITER_USER } from './eval-config.ts';
import { grade, type RunResult } from './run-result.ts';
import { canLogIn, evalUsers } from './ensure-users.ts';

// One frontier model per lab that graded GOOD or ROUGH in the last sweep.
// Override with the second argument.
export const DEFAULT_MODELS =
  'Claude Sonnet 4.6,GPT-5.5,Gemini 3.5 Flash,Kimi K2.7 Code';

interface Args {
  evalCardUrl: string;
  models: string;
  headed: boolean;
  tabs: boolean;
  sessionId?: string;
  writeCards: boolean;
}

interface SessionRow {
  requestedModel: string;
  model: string;
  grade: string;
  verdict: string;
  turns: number | undefined;
  cost: string;
  roomId: string | undefined;
  resultCardUrl: string | undefined;
  screenshot?: string | undefined;
  json?: string;
}

// eval-results/<session-id>/session.json: what a session ran and where its
// cards are. Read back by a later `--session` run and by the judge.
interface SessionFile {
  sessionId: string;
  evaluation: {
    url: string;
    name: string;
    realmUrl: string;
    successCriteria: string;
    prompts: string[];
  };
  reportCardUrl: string | undefined;
  resultsDir: string;
  results: SessionRow[];
}

function parseArgs(argv: string[]): Args {
  let positional: string[] = [];
  let args: Args = {
    evalCardUrl: '',
    models: DEFAULT_MODELS,
    headed: false,
    // A run takes minutes and what the assistant does on screen is most of
    // what there is to see, so the browser is shown unless --headless says
    // otherwise. Tabs rather than --headed: one window per model, still side
    // by side, so watching costs no wall-clock.
    tabs: true,
    writeCards: true,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--headed') {
      args.headed = true;
      args.tabs = false;
    } else if (arg === '--tabs') {
      args.tabs = true;
      args.headed = false;
    } else if (arg === '--headless') {
      args.headed = false;
      args.tabs = false;
    } else if (arg === '--no-cards') {
      args.writeCards = false;
    } else if (arg === '--session') {
      args.sessionId = argv[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (!positional[0]) {
    throw new Error(
      'usage: node run-eval.ts <evaluation-card-url> [comma,separated,models] [--headless|--headed] [--session <id>] [--no-cards]',
    );
  }
  args.evalCardUrl = positional[0];
  if (positional[1]) {
    args.models = positional[1];
  }
  return args;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function newSessionId(evaluationName: string) {
  let now = new Date();
  let pad = (n: number) => String(n).padStart(2, '0');
  let stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  let suffix = Math.random().toString(36).slice(2, 5);
  return `${stamp}-${slugify(evaluationName)}-${suffix}`;
}

function cardModule(evaluation: Evaluation) {
  return new URL(evaluation.adoptsFrom.module, evaluation.url).href;
}

function fileLink(url: string) {
  return { links: { self: url }, data: { type: 'file-meta', id: url } };
}

function cachingRate(result: RunResult): number | null {
  let a = result.analysis;
  if (!a || a.cacheWindowInputTokens <= 0) {
    return null;
  }
  return Math.round(
    (100 * a.cacheWindowCachedTokens) / a.cacheWindowInputTokens,
  );
}

function toolCallsText(result: RunResult) {
  let a = result.analysis;
  if (!a) {
    return '';
  }
  return Object.entries(a.toolCalls)
    .map(([name, count]) => `${name.replace(/_[0-9a-f]{4}$/, '')} ×${count}`)
    .join(', ');
}

async function createReportCard(
  client: RealmClient,
  evaluation: Evaluation,
  sessionId: string,
  models: string[],
) {
  let doc: CardDocument = {
    data: {
      type: 'card',
      attributes: {
        sessionId,
        startedAt: new Date().toISOString(),
        requestedModels: models,
      },
      relationships: {
        evalCard: { links: { self: evaluation.url } },
      },
      meta: {
        adoptsFrom: {
          module: cardModule(evaluation),
          name: 'EvaluationReportCard',
        },
      },
    },
  };
  let created = await client.createCard(
    evaluation.realmUrl,
    evaluation.realmUrl,
    doc,
  );
  return created.data.id!;
}

async function createResultCard(
  client: RealmClient,
  evaluation: Evaluation,
  result: RunResult,
  resultsDir: string,
) {
  let graded = grade(result);
  let a = result.analysis;
  let slug = slugify(result.requestedModel);
  let screenshotUrl: string | undefined;
  if (result.screenshot) {
    try {
      let bytes = new Uint8Array(await readFile(result.screenshot));
      screenshotUrl = `${evaluation.realmUrl}EvaluationResultCard/screenshots/${result.sessionId}/${slug}.png`;
      await client.putBinary(evaluation.realmUrl, screenshotUrl, bytes);
    } catch (error) {
      console.warn(
        `[eval] could not upload the screenshot for ${result.requestedModel}: ${String(error)}`,
      );
      screenshotUrl = undefined;
    }
  }
  let relationships: NonNullable<CardDocument['data']['relationships']> = {
    evalCard: { links: { self: evaluation.url } },
  };
  if (screenshotUrl) {
    relationships.screenshot = fileLink(screenshotUrl);
  }
  result.skillsUsed.forEach((url, index) => {
    relationships[`skillsUsed.${index}`] = fileLink(url);
  });
  let doc: CardDocument = {
    data: {
      type: 'card',
      attributes: {
        sessionId: result.sessionId,
        modelName: result.modelName ?? result.requestedModel,
        model: result.modelId ?? null,
        reasoningEffort: result.reasoningEffort ?? null,
        matrixRoomId: result.roomId ?? null,
        testRealmUrl: result.realmUrl ?? null,
        verdict: result.verdict,
        cardRendered: Boolean(result.cardRendered),
        cost: a ? Number(a.costUsd.toFixed(4)) : null,
        turnsCount: a?.turns ?? null,
        cachingRate: cachingRate(result),
        qualityScore: null,
        startedAt: result.startedAt,
        endedAt: result.endedAt ?? new Date().toISOString(),
        toolCalls: toolCallsText(result),
        notes: [
          `grade ${graded.grade}`,
          ...result.reasons,
          ...graded.misses,
          ...(a && a.patchBlocks
            ? [
                `${a.patchBlocks} SEARCH/REPLACE block(s)${
                  a.gitStyleBlocks ? `, ${a.gitStyleBlocks} git-style` : ''
                }; ${a.patchResults.applied} applied, ${a.patchResults.failed} failed`,
              ]
            : []),
          ...(result.cardRendered
            ? [`rendered ${result.cardRendered} in the ${result.renderedIn}`]
            : []),
        ],
        analysis: null,
      },
      relationships,
      meta: {
        adoptsFrom: {
          module: cardModule(evaluation),
          name: 'EvaluationResultCard',
        },
      },
    },
  };
  let created = await client.createCard(
    evaluation.realmUrl,
    evaluation.realmUrl,
    doc,
  );
  let id = created.data.id!;
  await writeFile(
    join(resultsDir, `${slug}.card.json`),
    JSON.stringify({ id, ...doc }, null, 2),
  );
  return id;
}

function runPlaywright(env: NodeJS.ProcessEnv, headed: boolean) {
  return new Promise<number>((resolve) => {
    let child = spawn(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '-c',
        'playwright.config.ts',
        ...(headed ? ['--headed'] : []),
      ],
      { cwd: import.meta.dirname, env, stdio: 'inherit' },
    );
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(`[eval] could not start playwright: ${String(error)}`);
      resolve(1);
    });
  });
}

async function main() {
  let args = parseArgs(process.argv.slice(2));
  let writer = WRITER_USER;
  let password = WRITER_PASSWORD;
  let models = args.models
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  // One browser per model signs in as its own matrix user. A missing account
  // only shows up on that browser's first action, by which point the session
  // has a report card and the other models are already spending, so it is
  // worth the few logins to find out here instead.
  let evalPassword = process.env.EVAL_PASSWORD ?? 'password';
  let missing: string[] = [];
  for (let username of evalUsers().slice(0, models.length)) {
    if (!(await canLogIn(username, evalPassword))) {
      missing.push(username);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `cannot sign in as ${missing.join(', ')}. Register them with ` +
        '`pnpm eval:users`, or name accounts that exist with EVAL_USERS',
    );
  }

  console.log(`[eval] signing in as @${writer} to read ${args.evalCardUrl}`);
  let credentials = await loginWithPassword(writer, password);
  let client = new RealmClient(credentials.accessToken, credentials.userId);
  let evaluation = await loadEvaluationBundle(client, args.evalCardUrl);
  let sessionId = args.sessionId ?? newSessionId(evaluation.name);
  let resultsDir = join(import.meta.dirname, 'eval-results', sessionId);
  await mkdir(resultsDir, { recursive: true });
  let bundlePath = join(resultsDir, 'evaluation.json');
  await writeFile(bundlePath, JSON.stringify(evaluation, null, 2));

  console.log(
    `[eval] evaluation "${evaluation.name}" in ${evaluation.realmUrl}`,
  );
  console.log(`[eval] session ${sessionId}`);
  console.log(`[eval] models: ${models.join(', ')}`);
  console.log(`[eval] prompts: ${evaluation.prompts.length}`);
  if (evaluation.initialCards.length || evaluation.initialFiles.length) {
    console.log(
      `[eval] workspace starts with ${evaluation.initialCards.length} card(s) and ${evaluation.initialFiles.length} file(s)`,
    );
  }

  // An earlier run of this session left its report card and rows here;
  // reuse the card so the new models join the same report.
  let previous: SessionFile | undefined;
  try {
    previous = JSON.parse(
      await readFile(join(resultsDir, 'session.json'), 'utf8'),
    ) as SessionFile;
  } catch {
    // first run of this session
  }
  let reportCardUrl: string | undefined = previous?.reportCardUrl;
  if (args.writeCards) {
    if (reportCardUrl) {
      console.log(`[eval] adding to report card ${reportCardUrl}`);
    } else {
      reportCardUrl = await createReportCard(
        client,
        evaluation,
        sessionId,
        models,
      );
      console.log(`[eval] report card ${reportCardUrl}`);
    }
  }

  let env: NodeJS.ProcessEnv = {
    ...process.env,
    EVAL_BUNDLE: bundlePath,
    EVAL_NAME: evaluation.name,
    EVAL_SESSION_ID: sessionId,
    EVAL_MODELS: models.join(','),
    EVAL_RESULTS_DIR: resultsDir,
  };
  delete env.EVAL_PROMPT;
  if (args.headed || args.tabs) {
    env.EVAL_WORKERS = '1';
  }
  if (args.tabs) {
    env.EVAL_TABS = '1';
  }
  let exitCode = await runPlaywright(env, args.headed || args.tabs);
  if (exitCode !== 0) {
    console.log(
      `[eval] playwright exited ${exitCode}: at least one model did not pass (see the rows below)`,
    );
  }

  let files = (await readdir(resultsDir)).filter(
    (f) =>
      f.endsWith('.json') &&
      f !== 'playwright.json' &&
      f !== 'evaluation.json' &&
      f !== 'session.json' &&
      !f.endsWith('.card.json'),
  );
  let results: RunResult[] = [];
  for (let file of files) {
    let result: RunResult = JSON.parse(
      await readFile(join(resultsDir, file), 'utf8'),
    );
    // Only this run's models; an earlier run of the session left its own.
    if (models.includes(result.requestedModel)) {
      results.push(result);
    }
  }
  results.sort((a, b) => a.requestedModel.localeCompare(b.requestedModel));

  let rows: SessionRow[] = [];
  for (let result of results) {
    let resultCardUrl: string | undefined;
    if (args.writeCards) {
      try {
        resultCardUrl = await createResultCard(
          client,
          evaluation,
          result,
          resultsDir,
        );
      } catch (error) {
        console.error(
          `[eval] could not write the result card for ${result.requestedModel}: ${String(error)}`,
        );
      }
    }
    rows.push({
      requestedModel: result.requestedModel,
      model: result.modelName ?? result.requestedModel,
      grade: grade(result).grade,
      verdict: result.verdict,
      turns: result.analysis?.turns,
      cost: result.analysis ? `$${result.analysis.costUsd.toFixed(3)}` : '–',
      roomId: result.roomId,
      resultCardUrl,
    });
  }

  let newRows = rows.map((row, index) => ({
    ...row,
    screenshot: results[index].screenshot,
    json: join(resultsDir, `${slugify(results[index].requestedModel)}.json`),
  }));
  let keptRows = (previous?.results ?? []).filter(
    (row) => !models.includes(row.requestedModel),
  );
  let session: SessionFile = {
    sessionId,
    evaluation: {
      url: evaluation.url,
      name: evaluation.name,
      realmUrl: evaluation.realmUrl,
      successCriteria: evaluation.successCriteria,
      prompts: evaluation.prompts,
    },
    reportCardUrl,
    resultsDir,
    results: [...keptRows, ...newRows],
  };
  await writeFile(
    join(resultsDir, 'session.json'),
    JSON.stringify(session, null, 2),
  );

  console.log(`\n[eval] session ${sessionId} done`);
  if (reportCardUrl) {
    console.log(`[eval] report: ${reportCardUrl}`);
  }
  for (let row of rows) {
    console.log(
      `[eval] ${row.grade} ${row.model}: ${row.verdict}, ${row.turns ?? '–'} turns, ${row.cost}` +
        (row.roomId ? `, room ${row.roomId}` : '') +
        (row.resultCardUrl ? `\n       result card ${row.resultCardUrl}` : ''),
    );
  }
  console.log(`[eval] details: ${join(resultsDir, 'session.json')}`);
  if (args.writeCards) {
    console.log(
      `[eval] next: judge each result against the success criteria and record it with\n` +
        `       pnpm eval:judge <result-card-url> --score <0-10> --analysis-file <notes.md>`,
    );
  }
}

main().catch((error) => {
  console.error(
    `[eval] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
