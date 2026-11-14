import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type {
  FlushableRunProgressSink,
  RunProgressEvent,
} from '@cardstack/host/lib/realm-runner/automation';
import { REDACTED } from '@cardstack/host/lib/realm-runner/automation';
import runRealmCode from '@cardstack/host/lib/realm-runner/runner';
import {
  AUTOMATION_METHODS,
  INTERACTIVE_METHODS,
  MAX_RUN_NOTIFICATIONS,
  NOTIFY_METHODS,
} from '@cardstack/host/lib/realm-runner/surfaces';
import type { AutomationRunContext } from '@cardstack/host/lib/realm-runner/types';
import RunRealmCodeTool, {
  clickRequiredCallsIn,
  runAutomationScript,
  type AutomationRunOptions,
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
      'realm.transform',
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
realm.progress.count(1, 2);
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
      { kind: 'count', done: 1, total: 2 },
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

  test('a bad progress argument throws in the script', async function (assert) {
    let { done } = run(`
      const errors = [];
      for (const call of [
        () => realm.progress.milestone(''),
        () => realm.progress.plan([]),
        () => realm.progress.count(3, 2),
        () => realm.progress.count(-1),
      ]) {
        try { call(); } catch (error) { errors.push(error.message); }
      }
      return errors;
    `);
    assert.strictEqual(JSON.parse((await done).scriptResult).length, 4);
  });

  test('a script that runs past its seconds cap is stopped at its time limit', async function (assert) {
    let { done } = run('while (true) {}', { secondsCap: 1 });
    await assert.rejects(
      done,
      /reached its time limit of 1 s \(its seconds cap\)/,
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
});
