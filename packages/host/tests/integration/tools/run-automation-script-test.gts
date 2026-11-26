import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { AIBatchFollowUpRead } from '@cardstack/runtime-common';

import type {
  FlushableRunProgressSink,
  RunProgressEvent,
} from '@cardstack/host/lib/realm-runner/automation';
import {
  AutomationRunStoppedError,
  REDACTED,
} from '@cardstack/host/lib/realm-runner/automation';
import {
  RESOLVE_LLM,
  resolveChatBody,
  resolveRequest,
} from '@cardstack/host/lib/realm-runner/research';
import runRealmCode, {
  RealmCallFailure,
  RealmScriptError,
} from '@cardstack/host/lib/realm-runner/runner';
import {
  AUTOMATION_METHODS,
  FOUND_CARD_SHAPE,
  INTERACTIVE_METHODS,
  MAX_RUN_NOTIFICATIONS,
  NOTIFY_METHODS,
} from '@cardstack/host/lib/realm-runner/surfaces';
import { setTransformTimeLimitsForTests } from '@cardstack/host/lib/realm-runner/transform';
import {
  MAX_TRANSFORMS_IN_FLIGHT,
  MAX_TRANSFORMS_PER_RUN,
} from '@cardstack/host/lib/realm-runner/transform-limits';
import type { AutomationRunContext } from '@cardstack/host/lib/realm-runner/types';
import { watchedScriptOutcome } from '@cardstack/host/tools/run-automation';
import RunRealmCodeTool, {
  clickRequiredCallsIn,
  runAutomationScript,
  type AutomationRunOptions,
  type ResolveBatchSubmit,
  type SubmitResolveBatch,
} from '@cardstack/host/tools/run-realm-code';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const otherRealmURL = 'http://test-realm/test2/';

// Answers requests for `path` in the test realm with `respond`, ahead of the
// realm, until the returned function is called.
function answerWith(
  path: string,
  respond: () => Response | Promise<Response>,
): () => void {
  let network = getService('network');
  let url = `${testRealmURL}${path}`;
  let handler = async (request: Request) =>
    request.url === url ? respond() : null;
  network.virtualNetwork.mount(handler, { prepend: true });
  return () => network.virtualNetwork.unmount(handler);
}

// A 200 whose body fails partway, as a connection dropped mid-body does.
function tornBody(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('# Par'));
        controller.error(new TypeError('network error'));
      },
    }),
    { status: 200 },
  );
}

const CONTEXT: AutomationRunContext = {
  url: `${testRealmURL}automations/nightly`,
  trigger: { label: 'daily', kind: 'cron' },
  scheduledAt: '2026-11-13T11:30:00.000Z',
  lastSuccessAt: '2026-11-12T11:30:00.000Z',
  params: { since: '2026-01-01' },
  webhookPayload: { event: 'invoice.paid', id: 'evt_1' },
  dryRun: false,
};

// A script that lists every method the guest can see, as dotted names, and
// which other globals it has.
const SURFACE_SCRIPT = `
  const names = [];
  const walk = (value, prefix) => {
    for (const [key, member] of Object.entries(value)) {
      if (typeof member === 'function') {
        names.push(prefix + key);
        walk(member, prefix + key + '.');
      } else if (key !== 'current' || prefix !== '') {
        walk(member, prefix + key + '.');
      }
    }
  };
  walk(realm, '');
  if (typeof room !== 'undefined') walk(room, 'room.');
  if (typeof console !== 'undefined') walk(console, 'console.');
  return {
    names: names.sort(),
    hasFetch: typeof fetch !== 'undefined',
    current: Object.keys(realm.current).sort(),
  };
`;

async function guestSurface(surface?: 'automation') {
  let result = await runRealmCode(
    {
      code: SURFACE_SCRIPT,
      realmURL: testRealmURL,
      timeoutMs: 5_000,
      ...(surface ? { surface, automation: CONTEXT } : {}),
    },
    async () => null,
  );
  return JSON.parse(result.scriptResult) as {
    names: string[];
    hasFetch: boolean;
    current: string[];
  };
}

module('Integration | tools | run-automation-script', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    activeRealms: [testRealmURL, otherRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'notes/first.md': '# First\n',
          'cursor.txt': 'page-1\n',
          'pet.gts': `
            import { CardDef, field, contains } from '@cardstack/base/card-api';
            import StringField from '@cardstack/base/string';

            export class Pet extends CardDef {
              static displayName = 'Pet';
              @field name = contains(StringField);
            }
          `,
          'Pet/mango.json': {
            data: {
              type: 'card',
              attributes: { name: 'Mango' },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
        },
      }),
    );
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: otherRealmURL,
        contents: { 'notes/elsewhere.md': '# Elsewhere\n' },
      }),
    );
    await getService('realm').login(testRealmURL);
  });

  function run(
    code: string,
    overrides: Partial<AutomationRunOptions> = {},
  ): {
    events: RunProgressEvent[];
    done: ReturnType<typeof runAutomationScript>;
  } {
    let events: RunProgressEvent[] = [];
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let done = runAutomationScript({
      code,
      realmURL: testRealmURL,
      automation: CONTEXT,
      secondsCap: 30,
      io: tool.automationRealmIO(testRealmURL),
      progress: { record: (event) => events.push(event) },
      ...overrides,
    });
    return { events, done };
  }

  test('the guest sees exactly the automation surface: no room, no fetch, and console', async function (assert) {
    let surface = await guestSurface('automation');
    assert.deepEqual(surface.names, [...AUTOMATION_METHODS].sort());
    assert.false(surface.hasFetch, 'the script has no fetch');
    assert.deepEqual(surface.current, ['automation', 'url']);
  });

  test('no automation method waits for a click, since a run has no person', function (assert) {
    let named = [...AUTOMATION_METHODS]
      .map((method) => `realm.${method}(); `)
      .join('');
    assert.deepEqual([...clickRequiredCallsIn(named)], []);
    assert.deepEqual(
      [
        ...clickRequiredCallsIn('realm.fs.delete(); realm.fs.download();'),
      ].sort(),
      ['realm.fs.delete', 'realm.fs.download'],
      'the check sees a click-required call',
    );
  });

  test('the interactive surface the guest sees is unchanged', async function (assert) {
    let surface = await guestSurface();
    assert.deepEqual(surface.names, [...INTERACTIVE_METHODS].sort());
    for (let method of NOTIFY_METHODS) {
      assert.false(surface.names.includes(method), `${method} is not on it`);
    }
    assert.deepEqual(surface.current, ['url']);
  });

  test('realm.current.automation tells the script about its run, and it cannot be changed', async function (assert) {
    let { done } = run(`
      const automation = realm.current.automation;
      let changed = true;
      try {
        automation.params.since = 'tomorrow';
        changed = automation.params.since === 'tomorrow';
      } catch {
        changed = false;
      }
      return { automation, changed, frozen: Object.isFrozen(automation.trigger) };
    `);
    let { scriptResult } = await done;
    let result = JSON.parse(scriptResult);
    assert.deepEqual(result.automation, CONTEXT);
    assert.false(result.changed, 'the context is read-only');
    assert.true(result.frozen);
  });

  test('a method off the automation surface is refused in the script', async function (assert) {
    let refused = [
      'realm.fs.delete',
      'realm.fs.download',
      'realm.web.search',
      'realm.web.read',
      'realm.images.generate',
      'realm.capture',
      'realm.workspaces.create',
      'realm.ui.openFile',
      'realm.index.reindex',
      'realm.plan',
      'realm.ask',
      'realm.operations.capabilities',
      'room.enableSkills',
    ];
    let { done } = run(`
      const results = {};
      for (const name of ${JSON.stringify(refused)}) {
        try {
          const method = name.split('.').reduce(
            (value, key) => (value === undefined ? undefined : value[key]),
            globalThis,
          );
          await method('x');
          results[name] = 'ran';
        } catch (error) {
          results[name] = error.name;
        }
      }
      return results;
    `);
    let results = JSON.parse((await done).scriptResult);
    for (let name of refused) {
      assert.strictEqual(results[name], 'TypeError', `${name} is not defined`);
    }
  });

  test('a script reads, writes a file whole and reads its own write, with no 20-file limit', async function (assert) {
    let { done } = run(`
      const before = await realm.fs.readText('cursor.txt');
      await realm.fs.writeText('cursor.txt', 'page-2\\n');
      for (let i = 0; i < 25; i++) {
        await realm.fs.writeText('log/' + i + '.txt', 'line ' + i + '\\n');
      }
      await realm.fs.writeText('notes/first.md', '# First\\n');
      return { before, after: await realm.fs.readText('cursor.txt') };
    `);
    let result = await done;
    assert.deepEqual(JSON.parse(result.scriptResult), {
      before: 'page-1\n',
      after: 'page-2\n',
    });
    assert.strictEqual(result.written.length, 26, 'every write is reported');
    assert.true(result.written.includes(`${testRealmURL}cursor.txt`));
    assert.deepEqual(
      result.unchanged,
      [`${testRealmURL}notes/first.md`],
      'a write of the content the file already held is unchanged',
    );
  });

  test('a run may hold only so much file content, so it cannot fill the tab it shares', async function (assert) {
    // Each `big/` file is near the largest a run reads; a copy holds it once
    // as read and once as written.
    let big = 'x'.repeat(450_000);
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let io = tool.automationRealmIO(testRealmURL);
    let { done } = run(
      `
        let copied = 0;
        try {
          for (let i = 0; i < 40; i++) {
            await realm.fs.copy('big/' + i + '.txt', 'out/' + i + '.txt');
            copied++;
          }
        } catch (error) {
          return { copied, message: error.message };
        }
        return { copied };
      `,
      {
        io: {
          ...io,
          readSource: async (url: string) =>
            url.startsWith(`${testRealmURL}big/`)
              ? { status: 200, content: big, binary: false }
              : { status: 404, content: '', binary: false },
          writeFile: async (_url: string, content: string) => content,
        },
      },
    );
    let result = JSON.parse((await done).scriptResult);
    assert.strictEqual(
      result.copied,
      22,
      'it copies until the next read would pass the limit',
    );
    assert.strictEqual(
      result.message,
      `An automation run may hold at most 20000000 characters of file content; reading ${testRealmURL}big/22.txt would pass it`,
    );
  });

  test('rewriting one file many times holds only its first and latest versions', async function (assert) {
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let io = tool.automationRealmIO(testRealmURL);
    // Each write holds 450,000 characters; 60 of them, if each counted, would
    // pass the limit three times over.
    let { done } = run(
      `
        let size = 450000;
        for (let i = 0; i < 60; i++) {
          await realm.fs.writeText('big.txt', String(i % 10).repeat(size));
        }
        return (await realm.fs.readText('big.txt')).length;
      `,
      {
        io: {
          ...io,
          readSource: async () => ({ status: 404, content: '', binary: false }),
          writeFile: async (_url: string, content: string) => content,
        },
      },
    );
    assert.strictEqual(JSON.parse((await done).scriptResult), 450_000);
  });

  test("a script's searches go to its own realm's search", async function (assert) {
    let { done } = run(`
      const cards = await realm.cards.search({
        filter: {
          on: { module: ${JSON.stringify(`${testRealmURL}pet`)}, name: 'Pet' },
          eq: { name: 'Mango' },
        },
      });
      const entries = await realm.entries.search({}, { limit: 50 });
      return {
        cards: cards.cards.map((card) => card.path),
        entries: entries.entries.length > 0,
      };
    `);
    let result = JSON.parse((await done).scriptResult);
    assert.deepEqual(result.cards, ['Pet/mango.json']);
    assert.true(result.entries);
  });

  test('a script searches only its own realm', async function (assert) {
    let { done } = run(`
      try {
        await realm.entries.search({}, { realms: [${JSON.stringify(otherRealmURL)}] });
        return 'searched';
      } catch (error) {
        return error.message;
      }
    `);
    assert.true(
      JSON.parse((await done).scriptResult).includes(
        'An automation run searches only its own realm',
      ),
    );
  });

  test('progress and console lines go to the progress sink with their script line, redacted', async function (assert) {
    let token = 'the-run-token-0123456789';
    let { events, done } = run(
      `realm.progress.plan(['fetch roster', 'write findings']);
realm.progress.milestone('fetch roster');
realm.progress.task('Fetched the roster, key ghp_abcdefghijklmnopqrstuvwxyz0123');
console.log('fetched', { count: 2 });
console.warn('token', ${JSON.stringify(token)});
console.info('key ghp_abcdefghijklmnopqrstuvwxyz0123');
console.error(new Error('upstream refused'));
await realm.activity('Compared the roster');
return 'done';`,
      { secrets: [token] },
    );
    await done;
    let shown = events.map((event) => {
      let { at, ...rest } = event;
      assert.strictEqual(typeof at, 'number');
      return rest;
    });
    assert.deepEqual(shown, [
      { kind: 'plan', milestones: ['fetch roster', 'write findings'] },
      { kind: 'milestone', name: 'fetch roster' },
      { kind: 'task', text: `Fetched the roster, key ${REDACTED}` },
      {
        kind: 'console',
        level: 'log',
        message: 'fetched {"count":2}',
        line: 4,
      },
      { kind: 'console', level: 'warn', message: `token ${REDACTED}`, line: 5 },
      { kind: 'console', level: 'info', message: `key ${REDACTED}`, line: 6 },
      {
        kind: 'console',
        level: 'error',
        message: 'Error: upstream refused',
        line: 7,
      },
      { kind: 'activity', line: 'Compared the roster' },
    ]);
  });

  test('a run reports at most its limit of console and progress lines, and says how many it dropped', async function (assert) {
    let { events, done } = run(`
      for (let i = 0; i < ${MAX_RUN_NOTIFICATIONS + 25}; i++) {
        console.log('line ' + i);
      }
      return 'done';
    `);
    await done;
    let lines = events.filter((event) => event.kind === 'console');
    assert.strictEqual(lines.length, MAX_RUN_NOTIFICATIONS + 1);
    let last = lines[lines.length - 1] as Extract<
      RunProgressEvent,
      { kind: 'console' }
    >;
    assert.strictEqual(last.level, 'warn');
    assert.true(
      last.message.startsWith('25 console and progress lines were dropped'),
      last.message,
    );
  });

  test("the script's result and its error are redacted", async function (assert) {
    let token = 'the-run-token-0123456789';
    let { done } = run(`return { echoed: ${JSON.stringify(token)} };`, {
      secrets: [token],
    });
    assert.deepEqual(JSON.parse((await done).scriptResult), {
      echoed: REDACTED,
    });
    let failed = run(
      `throw new Error('vendor said ' + ${JSON.stringify(token)});`,
      {
        secrets: [token],
      },
    );
    await assert.rejects(failed.done, (error: Error) => {
      return error.message.includes(REDACTED) && !error.message.includes(token);
    });
  });

  test("an error the script throws itself is the script's error, with its line", async function (assert) {
    let { done } = run(`let total = 1;\nthrow new Error('upstream said no');`);
    await assert.rejects(done, (error: unknown) => {
      return (
        error instanceof RealmScriptError &&
        error.scriptError.line === 2 &&
        error.scriptError.message === 'upstream said no'
      );
    });
  });

  test("a realm call's error is the call failing the run, not the script's error", async function (assert) {
    let caught = run(`
      try {
        await realm.cards.get('no/such-card');
        return 'read';
      } catch (error) {
        return { name: error.name, isError: error instanceof Error };
      }
    `);
    assert.deepEqual(JSON.parse((await caught.done).scriptResult), {
      name: 'RealmCallError',
      isError: true,
    });

    let uncaught = run(`await realm.cards.get('no/such-card');`);
    await assert.rejects(uncaught.done, (error: unknown) => {
      return error instanceof RealmCallFailure;
    });

    let rethrown = run(`
      try {
        await realm.cards.get('no/such-card');
      } catch (error) {
        throw new Error('could not read: ' + error.message);
      }
    `);
    await assert.rejects(
      rethrown.done,
      (error: unknown) => error instanceof RealmScriptError,
      'an error the script throws in its place is its own',
    );
  });

  test('a card update the realm refuses once the script ends is the call failing the run', async function (assert) {
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let io = tool.automationRealmIO(testRealmURL);
    let { done } = run(
      `await realm.cards.update('Pet/mango', { name: 'Mango II' });`,
      {
        io: {
          ...io,
          saveCards: async () => {
            throw new Error('The realm refused the write: 422');
          },
        },
      },
    );
    await assert.rejects(done, (error: unknown) => {
      return (
        error instanceof RealmCallFailure &&
        error.message === 'The realm refused the write: 422'
      );
    });
  });

  test('a watcher sees what each fetch ended with, and a body that fails while it is read, until it stops watching', async function (assert) {
    let network = getService('network');
    let seen: string[] = [];
    let unwatch = network.watchFetches((url, result) => {
      seen.push(
        `${new URL(url).pathname.split('/').pop()} ${
          'error' in result ? 'error' : result.response.status
        }`,
      );
      throw new Error('a watcher that throws changes nothing');
    });
    let unmount = answerWith('notes/torn.md', () => tornBody());
    try {
      let found = await network.authedFetch(`${testRealmURL}notes/first.md`, {
        headers: { Accept: 'application/vnd.card+source' },
      });
      let missing = await network.authedFetch(`${testRealmURL}notes/none.md`, {
        headers: { Accept: 'application/vnd.card+source' },
      });
      let torn = await network.fetch(`${testRealmURL}notes/torn.md`);
      await assert.rejects(torn.text());
      // The watch reads its own copy of the body, which fails alongside.
      await new Promise((resolve) => setTimeout(resolve, 0));
      unwatch();
      await network.authedFetch(`${testRealmURL}notes/first.md`, {
        headers: { Accept: 'application/vnd.card+source' },
      });
      assert.deepEqual([found.status, missing.status], [200, 404]);
      assert.deepEqual(
        seen,
        ['first.md 200', 'none.md 404', 'torn.md 200', 'torn.md error'],
        'the torn body is reported again as an error, and the fetch after unwatching is not seen',
      );
    } finally {
      unmount();
    }
  });

  test('a realm call that fails on its own terms is call-failed, and one the platform failed is run-failed', async function (assert) {
    let network = getService('network');
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let outcomeOf = (path: string) =>
      watchedScriptOutcome(
        network,
        () =>
          runAutomationScript({
            code: `await realm.fs.readText(${JSON.stringify(path)});`,
            realmURL: testRealmURL,
            automation: CONTEXT,
            secondsCap: 30,
            io: tool.automationRealmIO(testRealmURL),
            progress: { record: () => undefined },
          }),
        [],
      );
    let reasonOf = async (path: string) => {
      let outcome = await outcomeOf(path);
      return outcome.state === 'error' ? outcome.reason : outcome.state;
    };
    let unmounts = [
      answerWith('notes/down.md', () => new Response('down', { status: 503 })),
      answerWith('notes/shed.md', () => new Response('busy', { status: 429 })),
      answerWith('notes/torn.md', () => tornBody()),
    ];
    try {
      assert.deepEqual(
        {
          missing: await reasonOf('notes/none.md'),
          down: await reasonOf('notes/down.md'),
          shed: await reasonOf('notes/shed.md'),
          torn: await reasonOf('notes/torn.md'),
          read: await reasonOf('notes/first.md'),
        },
        {
          missing: 'call-failed',
          down: 'run-failed',
          shed: 'run-failed',
          torn: 'run-failed',
          read: 'complete',
        },
      );
    } finally {
      unmounts.forEach((unmountOne) => unmountOne());
    }
  });

  test("reading .data from a card a read answers is the script's TypeError, naming the card's shape", async function (assert) {
    let petRef = `{ module: ${JSON.stringify(`${testRealmURL}pet`)}, name: 'Pet' }`;
    for (let { code, answers } of [
      {
        code: `const card = await realm.cards.get('Pet/mango');\nreturn card.data.attributes.name;`,
        answers: 'realm.cards.get returns the card itself',
      },
      {
        code: `const { cards } = await realm.cards.search({ filter: { on: ${petRef}, eq: { name: 'Mango' } } });\nreturn cards[0].data.attributes.name;`,
        answers: 'realm.cards.search returns each card itself',
      },
    ]) {
      let { done } = run(code);
      await assert.rejects(
        done,
        (error: unknown) =>
          error instanceof RealmScriptError &&
          error.scriptError.name === 'TypeError' &&
          error.scriptError.message ===
            `${answers}: ${FOUND_CARD_SHAPE}. There is no .data; read its fields from .attributes and its links from .relationships`,
        answers,
      );
    }
  });

  test('a bad progress argument throws in the script', async function (assert) {
    let { done } = run(`
      const errors = [];
      for (const call of [
        () => realm.progress.milestone(''),
        () => realm.progress.plan([]),
        () => realm.progress.task('Grouped the bug label'),
        () => realm.progress.milestone('Group by label'),
        () => realm.progress.task(''),
        () => realm.progress.task('x'.repeat(201)),
        () => realm.progress.task(3),
      ]) {
        try { call(); } catch (error) { errors.push(error.message); }
      }
      return errors;
    `);
    assert.deepEqual(JSON.parse((await done).scriptResult), [
      'realm.progress.milestone expects milestone names of 1 to 80 characters',
      'realm.progress.plan expects 1 to 50 milestone names',
      'realm.progress.task reports a task inside a milestone: call realm.progress.milestone first',
      'realm.progress.task expects a task of 1 to 200 characters',
      'realm.progress.task expects a task of 1 to 200 characters',
      'realm.progress.task expects a task of 1 to 200 characters',
    ]);
  });

  test('realm.progress.count records nothing, and the run says once that tasks take its place', async function (assert) {
    let { events, done } = run(`realm.progress.milestone('Import');
realm.progress.count(1, 3);
realm.progress.count(2, 3);
realm.progress.count(9, 3);
return 'done';`);
    assert.strictEqual((await done).scriptResult, JSON.stringify('done'));
    assert.deepEqual(
      events.map(({ at: _at, ...rest }) => rest),
      [
        { kind: 'milestone', name: 'Import' },
        {
          kind: 'console',
          level: 'warn',
          message:
            'realm.progress.count records nothing. Report each notable task inside a milestone with realm.progress.task instead.',
          line: 2,
        },
      ],
    );
  });

  test('a script that runs past its seconds cap is stopped at its time limit', async function (assert) {
    let { done } = run('while (true) {}', { secondsCap: 1 });
    await assert.rejects(
      done,
      /reached its time limit of 1 s \(its seconds cap\)/,
    );
  });

  test('a script whose run stops running is stopped, and rejects as a stopped run', async function (assert) {
    let controller = new AbortController();
    let { done } = run('while (true) {}', { signal: controller.signal });
    setTimeout(() => controller.abort(new AutomationRunStoppedError()), 200);
    let error = await done.then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.true(
      error instanceof AutomationRunStoppedError,
      `it rejects with the stopped error, not a plain Error: ${String(error)}`,
    );
  });

  test('a script waiting past its seconds cap is stopped at its time limit', async function (assert) {
    let { done } = run('await new Promise(() => {});', { secondsCap: 1 });
    await assert.rejects(
      done,
      /reached its time limit of 1 s \(its seconds cap\)/,
    );
  });
  test("an uncaught error ends the run's progress with its message, its script line and its stack in the script's lines", async function (assert) {
    let { events, done } = run(
      [
        'function fetchRoster() {',
        "  throw new Error('no roster sk-live-0123456789abcdefgh');",
        '}',
        'fetchRoster();',
      ].join('\n'),
    );
    await assert.rejects(done, /no roster/);
    let last = events[events.length - 1] as Extract<
      RunProgressEvent,
      { kind: 'error' }
    >;
    assert.strictEqual(last.kind, 'error');
    assert.true(last.message.includes('no roster'), last.message);
    assert.false(
      last.message.includes('sk-live-0123456789abcdefgh'),
      'the message is redacted',
    );
    assert.strictEqual(last.line, 2, 'the line it was thrown on');
    assert.true(
      /script line 2[\s\S]*script line 4/.test(last.stack ?? ''),
      `each frame names the script's own line: ${last.stack}`,
    );
    assert.false(
      (last.stack ?? '').includes('realm-code.js'),
      "no frame names the wrapper's file",
    );
    assert.false(
      /script line [05-9]/.test(last.stack ?? ''),
      `no frame is outside the script's 4 lines: ${last.stack}`,
    );
  });

  test("a TypeError's line is reported too", async function (assert) {
    let { events, done } = run(
      ['const roster = null;', 'roster.items;'].join('\n'),
    );
    await assert.rejects(done);
    let last = events[events.length - 1] as Extract<
      RunProgressEvent,
      { kind: 'error' }
    >;
    assert.strictEqual(last.kind, 'error');
    assert.strictEqual(last.line, 2);
  });

  test('a run stopped at its time limit ends its progress with that error', async function (assert) {
    let { events, done } = run('while (true) {}', { secondsCap: 1 });
    await assert.rejects(done);
    let last = events[events.length - 1] as Extract<
      RunProgressEvent,
      { kind: 'error' }
    >;
    assert.strictEqual(last.kind, 'error');
    assert.true(/reached its time limit/.test(last.message), last.message);
    assert.strictEqual(last.line, undefined, 'a time limit names no line');
    assert.strictEqual(last.stack, undefined);
  });
  // An automation run whose batch submits are answered by `submit`, which
  // records each batch it is sent.
  function runWithBatches(
    code: string,
    {
      submit = async () => ({ id: 'batch_1' }),
      ...overrides
    }: Partial<AutomationRunOptions> & {
      submit?: SubmitResolveBatch;
    } = {},
  ) {
    let submitted: ResolveBatchSubmit[] = [];
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let io = {
      ...tool.automationRealmIO(testRealmURL),
      resolveBatch: async (batch: ResolveBatchSubmit, signal: AbortSignal) => {
        submitted.push(batch);
        return await submit(batch, signal);
      },
    };
    return { submitted, ...run(code, { io, ...overrides }) };
  }

  const CLASSIFY = {
    instruction: 'Classify the ticket',
    outputSchema: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: false,
    },
  };

  test('realm.resolve.batch submits the requests as one batch, starts its milestone, and the script carries on to the end of the run', async function (assert) {
    let { submitted, events, done } = runWithBatches(`
      const batch = await realm.resolve.batch(
        [
          { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } },
          { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'two' } },
        ],
        { by: new Date(Date.now() + 2 * 60 * 60 * 1000), milestone: 'classify tickets' },
      );
      realm.progress.task('saved the cursor');
      return batch;
    `);
    let result = JSON.parse((await done).scriptResult);

    assert.strictEqual(submitted.length, 1, 'one batch is submitted');
    let [batch] = submitted;
    assert.strictEqual(batch.model, RESOLVE_LLM);
    assert.deepEqual(
      batch.requests.map((request) => request.customId),
      ['0', '1'],
      'each request is keyed by its place in the list',
    );
    assert.deepEqual(
      batch.requests[1].body,
      resolveChatBody(
        resolveRequest({ ...CLASSIFY, input: { ticket: 'two' } }),
      ),
      'each request is the chat completion realm.resolve would send',
    );
    let twoHours = 2 * 60 * 60;
    let byTheScriptsDeadline =
      batch.deadlineSeconds > twoHours - 30 &&
      batch.deadlineSeconds <= twoHours;
    assert.true(
      byTheScriptsDeadline,
      `the deadline is the script's \`by\` (${batch.deadlineSeconds}s)`,
    );
    assert.strictEqual(result.batchId, 'batch_1');
    assert.strictEqual(result.requests, 2);
    assert.strictEqual(result.milestone, 'classify tickets');
    assert.false(Number.isNaN(Date.parse(result.deadline)));
    assert.deepEqual(
      events
        .filter((event) => event.kind === 'milestone' || event.kind === 'task')
        .map((event) => (event.kind === 'milestone' ? event.name : event.kind)),
      ['classify tickets', 'task', 'task'],
      'the batch starts its milestone, reports its submit, and the script may report tasks in it',
    );
  });

  test("a batch with no `by` takes the card's batch deadline, and with no milestone is named batched AI", async function (assert) {
    let { submitted, events, done } = runWithBatches(
      `return await realm.resolve.batch([
        { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } },
      ]);`,
      { batchDeadlineMinutes: 90 },
    );
    let result = JSON.parse((await done).scriptResult);

    assert.strictEqual(submitted[0].deadlineSeconds, 90 * 60);
    assert.strictEqual(result.milestone, 'batched AI');
    assert.true(
      events.some(
        (event) => event.kind === 'milestone' && event.name === 'batched AI',
      ),
    );
  });

  test('a batch whose `by` is more than 24 hours away, or already past, is refused before anything is sent', async function (assert) {
    let { submitted, done } = runWithBatches(`
      const request = { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } };
      const results = {};
      for (const [name, by] of [
        ['late', new Date(Date.now() + 25 * 60 * 60 * 1000)],
        ['past', new Date(Date.now() - 60 * 1000)],
        ['not a time', 'tomorrow'],
      ]) {
        try {
          await realm.resolve.batch([request], { by });
          results[name] = 'submitted';
        } catch (error) {
          results[name] = error.message;
        }
      }
      return results;
    `);
    let results = JSON.parse((await done).scriptResult);

    assert.true(/at most 24 hours/.test(results.late), results.late);
    assert.true(/at most 24 hours/.test(results.past), results.past);
    assert.true(/must be a time/.test(results['not a time']));
    assert.strictEqual(submitted.length, 0, 'nothing was submitted');
  });

  test('a run submits at most one batch', async function (assert) {
    let { submitted, done } = runWithBatches(`
      const request = { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } };
      await realm.resolve.batch([request]);
      try {
        await realm.resolve.batch([request]);
        return 'submitted twice';
      } catch (error) {
        return error.message;
      }
    `);
    let message = JSON.parse((await done).scriptResult);

    assert.true(/at most one batch/.test(message), message);
    assert.strictEqual(submitted.length, 1);
  });

  test("a batch the realm server refuses is the call's error in the script", async function (assert) {
    let { done } = runWithBatches(
      `return await realm.resolve.batch([
        { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } },
      ]);`,
      {
        submit: async () => {
          throw new Error(
            "realm.resolve.batch was refused: 403 - This automation hasn't turned on batched AI, so its runs can't submit batches",
          );
        },
      },
    );

    await assert.rejects(done, /hasn't turned on batched AI/);
  });

  test('a run whose tab holds no run token to submit with refuses realm.resolve.batch', async function (assert) {
    let { done } = run(
      `return await realm.resolve.batch([
        { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } },
      ]);`,
    );

    await assert.rejects(done, /needs an automation run's token/);
  });

  // A Preview of an automation whose card turns on batched AI.
  function previewWithBatches(
    code: string,
    overrides: Partial<AutomationRunOptions> = {},
  ) {
    return runWithBatches(code, {
      automation: { ...CONTEXT, dryRun: true },
      batchedAI: true,
      ...overrides,
    });
  }

  const PREVIEW_SCRIPT = `
    const automation = realm.current.automation;
    if (automation.trigger.kind === 'batch') {
      const batch = automation.batch;
      await realm.fs.writeText(
        'out/labels.json',
        JSON.stringify(batch.results.map((r) => r.output ? r.output.label : r.error)),
      );
      return {
        followUp: true,
        firstPass: await realm.fs.readText('out/first.txt'),
        label: automation.trigger.label,
        id: batch.id,
        late: batch.late,
        milestone: batch.milestone,
        deadline: batch.deadline,
        results: batch.results.map((r) => r.output ? r.output.label : 'failed: ' + r.error),
      };
    }
    await realm.fs.writeText('out/first.txt', 'before the batch');
    return await realm.resolve.batch(
      [
        { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'one' } },
        { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'broken' } },
        { ...${JSON.stringify(CLASSIFY)}, input: { ticket: 'three' } },
      ],
      { milestone: 'classify tickets' },
    );
  `;

  test('a Preview submits no batch: it sends the requests at once, at the normal price, and runs the follow-up in the same Preview', async function (assert) {
    let sent: unknown[] = [];
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let { submitted, events, done } = previewWithBatches(PREVIEW_SCRIPT, {
      io: {
        ...tool.automationRealmIO(testRealmURL),
        resolveBatch: async () => {
          throw new Error('a Preview never submits a batch');
        },
        resolve: async (request) => {
          sent.push(request.input);
          let ticket = (request.input as { ticket: string }).ticket;
          if (ticket === 'broken') {
            throw new Error('the model refused');
          }
          return { output: { label: `label-${ticket}` }, model: 'test/model' };
        },
      },
    });
    let outcome = await done;
    let result = JSON.parse(outcome.scriptResult);

    assert.strictEqual(submitted.length, 0, 'no batch is submitted');
    assert.deepEqual(
      sent,
      [{ ticket: 'one' }, { ticket: 'broken' }, { ticket: 'three' }],
      'each request is sent as realm.resolve sends it',
    );
    assert.deepEqual(
      {
        followUp: result.followUp,
        label: result.label,
        id: result.id,
        late: result.late,
        milestone: result.milestone,
      },
      {
        followUp: true,
        label: 'batch',
        id: null,
        late: false,
        milestone: 'classify tickets',
      },
      'the script runs again as the batch’s follow-up',
    );
    assert.strictEqual(
      result.firstPass,
      'before the batch',
      'the follow-up pass reads what the first pass staged',
    );
    assert.false(Number.isNaN(Date.parse(result.deadline)));
    assert.strictEqual(result.results[0], 'label-one');
    assert.true(
      /the model refused/.test(result.results[1]),
      'a failed request keeps its error in its place',
    );
    assert.strictEqual(result.results[2], 'label-three');
    assert.deepEqual(
      outcome.written.map((url) => url.replace(testRealmURL, '')).sort(),
      ['out/first.txt', 'out/labels.json'],
      'the Preview shows what both passes staged',
    );
    assert.true(
      events.some(
        (event) =>
          event.kind === 'milestone' && event.name === 'classify tickets',
      ),
      'the batch starts its milestone',
    );
  });

  test('a Preview whose follow-up sends a batch of its own runs that batch’s follow-up too', async function (assert) {
    let sent: unknown[] = [];
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let { submitted, done } = previewWithBatches(
      `
      const automation = realm.current.automation;
      const step = automation.trigger.kind === 'batch' ? automation.batch.milestone : 'start';
      if (step === 'second batch') {
        return { steps: [automation.batch.results[0].output.label] };
      }
      return await realm.resolve.batch(
        [{ ...${JSON.stringify(CLASSIFY)}, input: { ticket: step } }],
        { milestone: step === 'start' ? 'first batch' : 'second batch' },
      );
      `,
      {
        io: {
          ...tool.automationRealmIO(testRealmURL),
          resolveBatch: async () => {
            throw new Error('a Preview never submits a batch');
          },
          resolve: async (request) => {
            sent.push(request.input);
            let ticket = (request.input as { ticket: string }).ticket;
            return {
              output: { label: `label-${ticket}` },
              model: 'test/model',
            };
          },
        },
      },
    );
    let outcome = await done;

    assert.strictEqual(submitted.length, 0, 'no batch is submitted');
    assert.deepEqual(
      sent,
      [{ ticket: 'start' }, { ticket: 'first batch' }],
      'each pass’s batch is sent at the normal price',
    );
    assert.deepEqual(
      JSON.parse(outcome.scriptResult),
      { steps: ['label-first batch'] },
      'the last follow-up pass reads the answers the pass before it got',
    );
  });

  test('a Preview of an automation that doesn’t turn on batched AI refuses realm.resolve.batch, as its runs’ batches are refused', async function (assert) {
    let { submitted, done } = previewWithBatches(PREVIEW_SCRIPT, {
      batchedAI: false,
    });

    await assert.rejects(done, /turn on batchedAI/);
    assert.strictEqual(submitted.length, 0);
  });

  // A batch's follow-up run of a batch of two CLASSIFY requests, whose read
  // of its batch answers `read` (with the batch's requests' bodies filled
  // in), and whose requests sent at the normal price are answered by
  // `resolveChat`.
  function followUp(
    code: string,
    read: Partial<AIBatchFollowUpRead> & {
      answers?: (unknown | { error: string })[];
    },
    resolveChat: (body: Record<string, unknown>) => Promise<{
      output: Record<string, unknown>;
      model: string;
    }> = async () => {
      throw new Error('nothing is sent at the normal price');
    },
  ) {
    let bodies = ['one', 'two'].map((ticket) =>
      resolveChatBody(resolveRequest({ ...CLASSIFY, input: { ticket } })),
    );
    let sent: Record<string, unknown>[] = [];
    let { answers, ...rest } = read;
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let { events, done } = run(code, {
      automation: {
        ...CONTEXT,
        trigger: { label: 'batch', kind: 'batch' },
        scheduledAt: '2026-11-13T12:30:00.000Z',
      },
      followUpBatchId: 'batch_1',
      io: {
        ...tool.automationRealmIO(testRealmURL),
        readBatchFollowUp: async (batchId) => ({
          id: batchId,
          deadline: '2026-11-13T12:30:00.000Z',
          milestone: 'classify tickets',
          plan: ['classify tickets', 'save labels'],
          late: false,
          state: 'completed',
          requests: bodies.map((body, index) => {
            let answer = answers?.[index];
            return answer &&
              typeof answer === 'object' &&
              'error' in (answer as object)
              ? { body, error: (answer as { error: string }).error }
              : answer === undefined
                ? { body }
                : { body, answer };
          }),
          ...rest,
        }),
        resolveChat: async (body) => {
          sent.push(body);
          return await resolveChat(body);
        },
      },
    });
    return { bodies, sent, events, done };
  }

  function chatAnswer(content: string) {
    return {
      model: 'openai/gpt-4.1-mini-batch',
      choices: [{ message: { content }, finish_reason: 'stop' }],
    };
  }

  const FOLLOW_UP_SCRIPT = `
    realm.progress.task('read the answers');
    realm.progress.milestone('save labels');
    const { batch } = realm.current.automation;
    return {
      id: batch.id,
      late: batch.late,
      milestone: batch.milestone,
      deadline: batch.deadline,
      results: batch.results.map((r) => r.output ? r.output.label : 'failed: ' + r.error),
      models: batch.results.map((r) => r.model ?? null),
    };
  `;

  // The run's plan, milestone and task events, in order.
  function milestoneEvents(events: RunProgressEvent[]) {
    return events.flatMap((event) =>
      event.kind === 'plan'
        ? [`plan: ${event.milestones.join(', ')}`]
        : event.kind === 'milestone'
          ? [`milestone: ${event.name}`]
          : event.kind === 'task'
            ? [`task: ${event.text}`]
            : [],
    );
  }

  test("a batch's follow-up gets the completed batch's results, each read as realm.resolve reads its answer, and carries on the batch's milestones", async function (assert) {
    let { sent, events, done } = followUp(FOLLOW_UP_SCRIPT, {
      answers: [
        chatAnswer('{"label":"bug"}'),
        chatAnswer('{"category":"bug"}'),
      ],
    });
    let result = JSON.parse((await done).scriptResult);

    assert.deepEqual(
      {
        id: result.id,
        late: result.late,
        milestone: result.milestone,
        deadline: result.deadline,
      },
      {
        id: 'batch_1',
        late: false,
        milestone: 'classify tickets',
        deadline: '2026-11-13T12:30:00.000Z',
      },
    );
    assert.strictEqual(result.results[0], 'bug');
    assert.strictEqual(result.models[0], 'openai/gpt-4.1-mini-batch');
    assert.true(
      /does not match outputSchema/.test(result.results[1]),
      `an answer that doesn't match the request's schema is that request's error: ${result.results[1]}`,
    );
    assert.strictEqual(sent.length, 0, 'nothing is sent at the normal price');
    assert.deepEqual(
      milestoneEvents(events),
      [
        'plan: classify tickets, save labels',
        'milestone: classify tickets',
        'task: Batch completed: picked up the answers to its 2 AI requests; 1 failed',
        'task: read the answers',
        'milestone: save labels',
      ],
      "the follow-up enters the batch's milestone, ends it as completed, and the script carries on",
    );
  });

  test("a late batch's follow-up sends its requests at the normal price, and the script gets those answers marked late", async function (assert) {
    let { bodies, sent, events, done } = followUp(
      FOLLOW_UP_SCRIPT,
      { late: true, state: 'in_progress' },
      async (body) => {
        let content = JSON.parse(
          ((body.messages as { content: string }[])[1] as { content: string })
            .content,
        );
        if (content.input.ticket === 'two') {
          throw new Error('realm.resolve: the model refused');
        }
        return { output: { label: 'urgent' }, model: 'openai/gpt-4.1-mini' };
      },
    );
    let result = JSON.parse((await done).scriptResult);

    assert.true(result.late, 'the answers are marked late');
    assert.deepEqual(sent, bodies, 'each request is sent as it was batched');
    assert.strictEqual(result.results[0], 'urgent');
    assert.true(
      /the model refused/.test(result.results[1]),
      'a request that fails keeps its error in its place',
    );
    assert.deepEqual(milestoneEvents(events).slice(0, 3), [
      'plan: classify tickets, save labels',
      'milestone: classify tickets',
      "task: Deadline reached: sent the batch's 2 AI requests at the normal price; 1 failed",
    ]);
  });

  test("a failed batch's follow-up says the batch failed, and sends its requests at the normal price", async function (assert) {
    let { sent, events, done } = followUp(
      FOLLOW_UP_SCRIPT,
      { late: true, state: 'failed' },
      async () => ({ output: { label: 'idea' }, model: 'openai/gpt-4.1-mini' }),
    );
    let result = JSON.parse((await done).scriptResult);

    assert.true(result.late);
    assert.deepEqual(result.results, ['idea', 'idea']);
    assert.strictEqual(sent.length, 2);
    assert.true(
      milestoneEvents(events).includes(
        "task: Batch failed: sent the batch's 2 AI requests at the normal price",
      ),
    );
  });

  test('a follow-up whose batch can’t be read fails its run before the script runs', async function (assert) {
    let tool = new RunRealmCodeTool(getService('tool-service').toolContext);
    let { done } = run(`await realm.fs.writeText('ran.txt', 'yes');`, {
      automation: { ...CONTEXT, trigger: { label: 'batch', kind: 'batch' } },
      followUpBatchId: 'batch_1',
      io: {
        ...tool.automationRealmIO(testRealmURL),
        readBatchFollowUp: async () => {
          throw new Error(
            "The follow-up couldn't read batch batch_1: 403 - Only the follow-up run of batch batch_1 reads it for its results",
          );
        },
      },
    });

    await assert.rejects(done, /couldn't read batch batch_1/);
  });

  test("the progress sink is flushed before each call the realm server logs, so the run's log keeps one order", async function (assert) {
    let order: string[] = [];
    let { done } = run(
      `console.log('before');
       try {
         await realm.operations.invoke('Pet/mango.json', 'missing', {});
       } catch (e) {}
       return 'done';`,
      {
        progress: {
          record: (event) =>
            order.push(event.kind === 'console' ? event.message : event.kind),
          flush: async () => {
            order.push('flush');
          },
        } as FlushableRunProgressSink,
      },
    );
    await done;
    assert.true(
      order.indexOf('flush') > order.indexOf('before'),
      `the sink is flushed after the line before the call: ${order.join(', ')}`,
    );
  });

  // The transform line, without its time, which varies.
  function transformLines(assert: Assert, events: RunProgressEvent[]) {
    return events
      .filter(
        (event): event is Extract<RunProgressEvent, { kind: 'transform' }> =>
          event.kind === 'transform',
      )
      .map(({ at, ms, ...rest }) => {
        assert.strictEqual(typeof at, 'number');
        assert.true(Number.isInteger(ms) && ms >= 0, `ms is ${ms}`);
        return rest;
      });
  }
  test('realm.transform reshapes JSON in an automation run', async function (assert) {
    let { events, done } = run(`
      const orders = [
        { id: 1, total: 40, status: 'paid' },
        { id: 2, total: 15, status: 'refunded' },
        { id: 3, total: 25, status: 'paid' },
      ];
      return await realm.transform(
        orders,
        'map(select(.status == params("status"))) | {count: length, total: (map(.total) | add)}',
        { params: { status: 'paid' } },
      );
    `);
    let result = await done;
    assert.deepEqual(JSON.parse(result.scriptResult), { count: 2, total: 65 });
    assert.deepEqual(transformLines(assert, events), [
      { kind: 'transform', calls: 1, failed: 0, inBytes: 130, outBytes: 22 },
    ]);
  });

  test('an automation run has no limit on how many transforms it runs', async function (assert) {
    let count = MAX_TRANSFORMS_PER_RUN + 20;
    let { events, done } = run(`
      let sum = 0;
      for (let i = 0; i < ${count}; i++) {
        sum += await realm.transform({ i }, '.i + 1');
      }
      return sum;
    `);
    let result = await done;
    assert.strictEqual(
      JSON.parse(result.scriptResult),
      (count * (count + 1)) / 2,
      `all ${count} transforms ran`,
    );
    let [line] = transformLines(assert, events);
    assert.strictEqual(line?.calls, count, 'one line counts every call');
    assert.strictEqual(line?.failed, 0);
  });

  test('an automation run has only so many transforms waiting at once, and an awaited call after them runs', async function (assert) {
    let { events, done } = run(`
      const settled = await Promise.allSettled(
        Array.from({ length: ${MAX_TRANSFORMS_IN_FLIGHT + 4} }, (_, i) =>
          realm.transform({ i }, '.i'),
        ),
      );
      const after = await realm.transform({ a: 1 }, '.a');
      return {
        ran: settled.filter((s) => s.status === 'fulfilled').length,
        refused: settled.filter((s) => s.status === 'rejected').map((s) => s.reason.message),
        after,
      };
    `);
    let { ran, refused, after } = JSON.parse((await done).scriptResult);
    assert.true(
      refused.length > 0,
      `some calls were refused: ${refused.length}`,
    );
    assert.strictEqual(ran + refused.length, MAX_TRANSFORMS_IN_FLIGHT + 4);
    assert.true(
      refused.every((message: string) =>
        message.includes(
          `realm.transform runs at most ${MAX_TRANSFORMS_IN_FLIGHT} programs waiting at once`,
        ),
      ),
      refused.join(' | '),
    );
    assert.strictEqual(after, 1, 'an awaited call after them runs');
    let [line] = transformLines(assert, events);
    assert.deepEqual(
      [line?.calls, line?.failed],
      [MAX_TRANSFORMS_IN_FLIGHT + 5, refused.length],
    );
  });

  test("a transform doesn't wait behind the run's queue of realm calls", async function (assert) {
    let release!: () => void;
    let held = new Promise<void>((resolve) => (release = resolve));
    let unmount = answerWith('notes/held.md', async () => {
      await held;
      return new Response('# Held\n', { status: 200 });
    });
    try {
      let { done } = run(
        `
        const order = [];
        const read = realm.fs.readText('notes/held.md').then(() => order.push('read'));
        order.push('transformed ' + (await realm.transform([1, 2, 3], 'length')));
        console.log('transformed');
        await read;
        return order;
      `,
        {
          progress: {
            record: (event) => {
              if (event.kind === 'console' && event.message === 'transformed') {
                release();
              }
            },
          },
        },
      );
      assert.deepEqual(JSON.parse((await done).scriptResult), [
        'transformed 3',
        'read',
      ]);
    } finally {
      release();
      unmount();
    }
  });

  test('a program past its time is stopped, and the run goes on to its next transform', async function (assert) {
    setTransformTimeLimitsForTests({ timeoutMs: 100, stallGraceMs: 30_000 });
    try {
      let { events, done } = run(`
        let stopped;
        try {
          await realm.transform(null, '[range(100000000)] | length');
        } catch (error) {
          stopped = error.message;
        }
        const after = await realm.transform({ a: 1 }, '.a + 1');
        return { stopped, after };
      `);
      let { stopped, after } = JSON.parse((await done).scriptResult);
      assert.true(
        /exceeded the \d+ms runtime limit/.test(stopped),
        `the program was stopped at its time: ${stopped}`,
      );
      assert.strictEqual(after, 2, 'the next transform ran');
      let [line] = transformLines(assert, events);
      assert.deepEqual(
        [line?.calls, line?.failed],
        [2, 1],
        'the stopped program is a failed call',
      );
    } finally {
      setTransformTimeLimitsForTests(undefined);
    }
  });

  test('a succeeding and a failing transform report one transform line, as the run settles', async function (assert) {
    let { events, done } = run(`
      console.log('start');
      await realm.transform([1, 2], 'add');
      try {
        await realm.transform({}, '.a |');
      } catch {}
      console.log('end');
      return 'done';
    `);
    await done;
    assert.deepEqual(
      events.map((event) =>
        event.kind === 'console' ? event.message : event.kind,
      ),
      ['start', 'end', 'transform'],
      'the line comes after every line the script reported',
    );
    assert.deepEqual(transformLines(assert, events), [
      { kind: 'transform', calls: 2, failed: 1, inBytes: 7, outBytes: 1 },
    ]);
  });

  test('a run that fails reports its transforms before its error', async function (assert) {
    let { events, done } = run(`
      await realm.transform({ a: 1 }, '.a');
      throw new Error('gave up');
    `);
    await assert.rejects(done, /gave up/);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['transform', 'error'],
    );
  });

  test('a run with no transforms reports no transform line', async function (assert) {
    let { events, done } = run(`console.log('no transforms'); return 1;`);
    await done;
    assert.deepEqual(transformLines(assert, events), []);
  });
});
