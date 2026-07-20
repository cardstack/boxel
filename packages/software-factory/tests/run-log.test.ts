import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cardPathsFromToolCalls,
  persistDesignScreenshot,
  summarizeCheckFailure,
  RunLogWriter,
  buildLegacyMigration,
  autolinkCardReferences,
} from '../src/run-log.ts';

const CONTROL = 'https://app.boxel.ai/me/proj-ops/';
const PRODUCT = 'https://app.boxel.ai/me/proj/';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function writeCall(filePath: string) {
  return {
    tool: 'Write',
    args: { file_path: filePath },
    result: undefined,
  };
}

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'run-log-test-'));
}

// ---------------------------------------------------------------------------
// Tests: cardPathsFromToolCalls
// ---------------------------------------------------------------------------

module('run-log > cardPathsFromToolCalls', function () {
  test('excludes Knowledge Articles paths written with a real space', function (assert) {
    let paths = cardPathsFromToolCalls([
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/Knowledge Articles/port-code-analysis.json',
      ),
    ]);

    assert.deepEqual(
      paths,
      [],
      'a real-space "Knowledge Articles/" path must not be treated as a product ship-moment card — it lives in the control realm and would otherwise get an absolute product-realm link that 404s',
    );
  });

  test('excludes Knowledge Articles paths written with a URL-encoded space', function (assert) {
    let paths = cardPathsFromToolCalls([
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/Knowledge%20Articles/port-background.json',
      ),
    ]);

    assert.deepEqual(
      paths,
      [],
      'a %20-encoded "Knowledge Articles/" path is excluded too',
    );
  });

  test('still includes ordinary product-realm instance paths', function (assert) {
    let paths = cardPathsFromToolCalls([
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/Garment/red-jacket.json',
      ),
    ]);

    assert.deepEqual(
      paths,
      ['Garment/red-jacket'],
      'a normal deliverable instance is still picked up as a ship-moment card',
    );
  });

  test('excludes other control-plane dirs (Issues, Projects, Boards, Spec, Validations, Runs, design)', function (assert) {
    let paths = cardPathsFromToolCalls([
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/Issues/bootstrap-seed.json',
      ),
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/Projects/wardrobe.json',
      ),
      writeCall('/tmp/boxel-factory-workspaces/wardrobe/Boards/main.json'),
      writeCall('/tmp/boxel-factory-workspaces/wardrobe/Spec/garment.json'),
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/Validations/lint_issue-1-1.json',
      ),
      writeCall('/tmp/boxel-factory-workspaces/wardrobe/Runs/wardrobe.json'),
      writeCall(
        '/tmp/boxel-factory-workspaces/wardrobe/design/song-isolated.json',
      ),
    ]);

    assert.deepEqual(
      paths,
      [],
      'none of the control-plane dirs are treated as ship-moment cards',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: persistDesignScreenshot
// ---------------------------------------------------------------------------

module('run-log > persistDesignScreenshot', function (hooks) {
  let workspaceDir: string;

  hooks.beforeEach(async function () {
    workspaceDir = await makeWorkspace();
  });

  hooks.afterEach(async function () {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  test('copies design/*.png into design-history/ and returns the new path', async function (assert) {
    await mkdir(join(workspaceDir, 'design'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'design', 'garment-isolated.png'),
      'fake-png-bytes',
    );

    let result = await persistDesignScreenshot(
      workspaceDir,
      'design/garment-isolated.png',
    );

    assert.strictEqual(
      result,
      'design-history/garment-isolated.png',
      'returns the design-history/ path, not the original design/ path',
    );
    let copied = await readFile(
      join(workspaceDir, 'design-history', 'garment-isolated.png'),
      'utf8',
    );
    assert.strictEqual(
      copied,
      'fake-png-bytes',
      'the copy has the same bytes as the source',
    );
  });

  test('also preserves the sibling HTML mockup source in design-history/', async function (assert) {
    await mkdir(join(workspaceDir, 'design'), { recursive: true });
    await writeFile(join(workspaceDir, 'design', 'garment-v2.png'), 'png');
    await writeFile(
      join(workspaceDir, 'design', 'garment-v2.html'),
      '<html>the editable mockup</html>',
    );

    await persistDesignScreenshot(workspaceDir, 'design/garment-v2.png');

    let html = await readFile(
      join(workspaceDir, 'design-history', 'garment-v2.html'),
      'utf8',
    );
    assert.strictEqual(
      html,
      '<html>the editable mockup</html>',
      'the HTML source is archived alongside the PNG so agent cleanup cannot throw it away',
    );
  });

  test('tolerates a PNG with no sibling HTML (render-gate capture)', async function (assert) {
    await mkdir(join(workspaceDir, 'design', 'render'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'design', 'render', 'Garment-x-embedded.png'),
      'png',
    );

    // Must not throw when there is no matching .html.
    let result = await persistDesignScreenshot(
      workspaceDir,
      'design/render/Garment-x-embedded.png',
    );
    assert.strictEqual(result, 'design-history/render/Garment-x-embedded.png');
  });

  test('a later deletion of design/ does not remove the design-history/ copy', async function (assert) {
    await mkdir(join(workspaceDir, 'design'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'design', 'garment-isolated.png'),
      'fake-png-bytes',
    );

    await persistDesignScreenshot(workspaceDir, 'design/garment-isolated.png');

    // Simulate a later BUILD-turn cleanup of the design/ scratch dir — the
    // exact behavior that orphaned run-log links in production.
    await rm(join(workspaceDir, 'design'), { recursive: true, force: true });

    let historyStat = await stat(
      join(workspaceDir, 'design-history', 'garment-isolated.png'),
    );
    assert.ok(
      historyStat.isFile(),
      'design-history/ copy survives design/ being deleted',
    );
  });

  test('falls back to the original path when the source file is missing', async function (assert) {
    let result = await persistDesignScreenshot(
      workspaceDir,
      'design/does-not-exist.png',
    );

    assert.strictEqual(
      result,
      'design/does-not-exist.png',
      'best-effort fallback: never throws, just links the original path',
    );
  });

  test('supports render-gate paths under design/render/, preserving the subdirectory', async function (assert) {
    await mkdir(join(workspaceDir, 'design', 'render'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'design', 'render', 'Garment-tee-isolated.png'),
      'fake-render-bytes',
    );

    let result = await persistDesignScreenshot(
      workspaceDir,
      'design/render/Garment-tee-isolated.png',
    );

    assert.strictEqual(
      result,
      'design-history/render/Garment-tee-isolated.png',
    );
  });

  test('does not let two different design/ subpaths with the same basename collide', async function (assert) {
    await mkdir(join(workspaceDir, 'design', 'render'), { recursive: true });
    await writeFile(join(workspaceDir, 'design', 'isolated.png'), 'root-bytes');
    await writeFile(
      join(workspaceDir, 'design', 'render', 'isolated.png'),
      'render-bytes',
    );

    let rootResult = await persistDesignScreenshot(
      workspaceDir,
      'design/isolated.png',
    );
    let renderResult = await persistDesignScreenshot(
      workspaceDir,
      'design/render/isolated.png',
    );

    assert.notStrictEqual(
      rootResult,
      renderResult,
      'two same-basename screenshots in different design/ subdirectories must not collapse to the same design-history/ path',
    );
    assert.strictEqual(
      await readFile(join(workspaceDir, rootResult), 'utf8'),
      'root-bytes',
      'the first copy is not silently overwritten by the second',
    );
    assert.strictEqual(
      await readFile(join(workspaceDir, renderResult), 'utf8'),
      'render-bytes',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: summarizeCheckFailure
// ---------------------------------------------------------------------------

module('run-log > summarizeCheckFailure', function () {
  test('summarizes run_lint violations', function (assert) {
    let body = summarizeCheckFailure({
      status: 'failed',
      violations: [{ file: 'garment.gts', message: "Expected ';'" }],
    });

    assert.strictEqual(body, "garment.gts: Expected ';'");
  });

  test('summarizes run_parse errors', function (assert) {
    let body = summarizeCheckFailure({
      status: 'failed',
      errors: [{ file: 'garment.gts', message: 'Unexpected token' }],
    });

    assert.strictEqual(body, 'garment.gts: Unexpected token');
  });

  test('summarizes run_evaluate/run_instantiate failures (path + error)', function (assert) {
    let body = summarizeCheckFailure({
      status: 'failed',
      failures: [{ path: 'garment.gts', error: 'Cannot find module ./base' }],
    });

    assert.strictEqual(body, 'garment.gts: Cannot find module ./base');
  });

  test('falls back to cardName when a bare-instantiation failure has no path', function (assert) {
    let body = summarizeCheckFailure({
      status: 'failed',
      failures: [
        { path: '', cardName: 'Garment', error: 'instantiation failed' },
      ],
    });

    assert.strictEqual(body, 'Garment: instantiation failed');
  });

  test('caps the summary at 3 items and notes how many more', function (assert) {
    let body = summarizeCheckFailure({
      status: 'failed',
      violations: [
        { file: 'a.gts', message: 'e1' },
        { file: 'b.gts', message: 'e2' },
        { file: 'c.gts', message: 'e3' },
        { file: 'd.gts', message: 'e4' },
        { file: 'e.gts', message: 'e5' },
      ],
    });

    assert.strictEqual(body, 'a.gts: e1\nb.gts: e2\nc.gts: e3 (+2 more)');
  });

  test('falls back to errorMessage when there is no violations/errors/failures list', function (assert) {
    let body = summarizeCheckFailure({
      status: 'error',
      errorMessage: 'sync failed before lint could run',
    });

    assert.strictEqual(body, 'sync failed before lint could run');
  });

  test('returns undefined for a passing or empty result', function (assert) {
    assert.strictEqual(summarizeCheckFailure({ status: 'passed' }), undefined);
    assert.strictEqual(summarizeCheckFailure(null), undefined);
    assert.strictEqual(summarizeCheckFailure(undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// Tests: RunLogWriter (Posts + live-query model)
// ---------------------------------------------------------------------------

module('run-log > RunLogWriter', function (hooks) {
  let workspaceDir: string;

  hooks.beforeEach(async function () {
    workspaceDir = await makeWorkspace();
  });
  hooks.afterEach(async function () {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  function makeWriter() {
    let syncs = 0;
    let writer = new RunLogWriter({
      workspaceDir,
      targetRealm: 'https://realm.test/product/',
      controlRealm: 'https://realm.test/control/',
      runSlug: 'wardrobe',
      runTitle: 'Wardrobe',
      syncWorkspace: async () => {
        syncs++;
        return { ok: true };
      },
    });
    return { writer, syncCount: () => syncs };
  }

  async function readJson(rel: string) {
    return JSON.parse(await readFile(join(workspaceDir, rel), 'utf8'));
  }
  async function listEntries(): Promise<string[]> {
    try {
      let { readdir } = await import('node:fs/promises');
      return (await readdir(join(workspaceDir, 'RunLogEntries'))).sort();
    } catch {
      return [];
    }
  }

  test('each append writes ONE new entry card — never rewrites prior entries', async function (assert) {
    let { writer } = makeWriter();
    await writer.start(); // creates index + "Run started" entry (seq 1)
    await writer.append([
      { kind: 'design', headline: 'Design round: garment' },
    ]);

    let entries = await listEntries();
    assert.deepEqual(
      entries,
      ['wardrobe-000001.json', 'wardrobe-000002.json'],
      'two discrete entry cards exist, one per append — no growing array',
    );

    // The first entry is byte-stable after the second append landed: appends
    // never rewrite earlier entry files (the whole point of the refactor).
    let first = await readJson('RunLogEntries/wardrobe-000001.json');
    assert.strictEqual(first.data.attributes.seq, 1);
    assert.strictEqual(first.data.attributes.runId, 'wardrobe');
    assert.strictEqual(
      first.data.meta.adoptsFrom.name,
      'RunLogEntry',
      'entries adopt the RunLogEntry CardDef',
    );
    assert.ok(first.data.attributes.postedAt, 'entry carries postedAt');
  });

  test('milestone counters accumulate on the small index card', async function (assert) {
    let { writer } = makeWriter();
    await writer.start();
    await writer.append([{ kind: 'design', headline: 'd1' }]);
    await writer.append([{ kind: 'design', headline: 'd2' }]);
    await writer.append([{ kind: 'validation', headline: 'lint passed' }]);
    await writer.append([{ kind: 'validation', headline: 'parse failed' }]);
    await writer.append([{ kind: 'card-ready', headline: 'Garment shipped' }]);
    await writer.append([{ kind: 'issue-done', headline: 'WR-3 done' }]);

    let index = await readJson('Runs/wardrobe.json');
    let a = index.data.attributes;
    assert.strictEqual(a.designRoundsCount, 2, 'two design rounds counted');
    assert.strictEqual(
      a.validationsGreenCount,
      1,
      'only the passing validation counts as green',
    );
    assert.strictEqual(a.cardsReadyCount, 1, 'one card ready');
    assert.strictEqual(a.issuesDoneCount, 1, 'one issue done');
    assert.strictEqual(
      a.runId,
      'wardrobe',
      'index card carries runId for the feed query',
    );
    assert.notOk(
      'entries' in a,
      'the index card has NO containsMany entries array',
    );
  });

  test('buildLegacyMigration converts a containsMany index into entry cards', function (assert) {
    let legacy = {
      data: {
        type: 'card',
        attributes: {
          runTitle: 'Port: Wardrobe',
          status: 'running',
          nowWorkingOn: 'Building',
          startedAt: '2026-07-17T12:00:00.000Z',
          cardInfo: { name: 'Run log — Port: Wardrobe' },
          entries: [
            {
              kind: 'phase',
              at: '2026-07-17T12:00:00.000Z',
              headline: 'Run started',
            },
            {
              kind: 'design',
              at: '2026-07-17T12:02:00.000Z',
              headline: 'Design round: garment',
              body: 'crit pass',
              who: 'executor',
            },
            {
              kind: 'validation',
              at: '2026-07-17T12:03:00.000Z',
              headline: 'lint passed',
            },
            {
              kind: 'validation',
              at: '2026-07-17T12:04:00.000Z',
              headline: 'parse failed',
            },
            {
              kind: 'card-ready',
              at: '2026-07-17T12:05:00.000Z',
              headline: 'Garment shipped',
            },
          ],
        },
        relationships: {
          'entries.4.card': {
            links: { self: 'https://realm.test/product/Garment/red-jacket' },
          },
        },
      },
    };
    let plan = buildLegacyMigration(legacy, 'wardrobe');
    assert.ok(plan, 'legacy doc produces a migration plan');
    assert.strictEqual(plan!.entries.length, 5, 'one card per legacy entry');
    assert.strictEqual(plan!.seq, 5, 'seq continues from the migrated tail');
    assert.strictEqual(
      plan!.entries[0].relPath,
      'RunLogEntries/wardrobe-000001.json',
    );

    let e2: any = plan!.entries[1].doc;
    assert.strictEqual(e2.data.attributes.seq, 2);
    assert.strictEqual(
      e2.data.attributes.postedAt,
      '2026-07-17T12:02:00.000Z',
      'at → postedAt',
    );
    assert.strictEqual(e2.data.attributes.who, 'executor');
    assert.strictEqual(e2.data.meta.adoptsFrom.name, 'RunLogEntry');

    let e5: any = plan!.entries[4].doc;
    assert.strictEqual(
      e5.data.relationships.card.links.self,
      'https://realm.test/product/Garment/red-jacket',
      'the entries.4.card link is carried onto the 5th entry card',
    );

    let idx: any = plan!.index;
    assert.strictEqual(idx.data.attributes.designRoundsCount, 1);
    assert.strictEqual(
      idx.data.attributes.validationsGreenCount,
      1,
      'only the passing validation is green',
    );
    assert.strictEqual(idx.data.attributes.cardsReadyCount, 1);
    assert.strictEqual(idx.data.attributes.entryCount, 5);
    assert.strictEqual(idx.data.attributes.runId, 'wardrobe');
    assert.notOk(
      'entries' in idx.data.attributes,
      'the rewritten index drops the containsMany array',
    );
    assert.deepEqual(
      idx.data.relationships,
      {},
      'legacy entries.N.* relationships are dropped from the index',
    );
  });

  test('buildLegacyMigration drops status/iteration churn but counts them for totals', function (assert) {
    let entries = [];
    // 3 real design rounds interleaved with lots of status churn.
    for (let i = 0; i < 3; i++) {
      entries.push({
        kind: 'status',
        at: '2026-07-17T12:00:00.000Z',
        headline: 'Issue status: backlog → in progress',
      });
      entries.push({
        kind: 'iteration',
        at: '2026-07-17T12:00:00.000Z',
        headline: 'Inner iteration 1/8',
      });
      entries.push({
        kind: 'design',
        at: '2026-07-17T12:00:00.000Z',
        headline: 'Design round ' + i,
      });
    }
    let plan = buildLegacyMigration(
      { data: { attributes: { runTitle: 'X', entries }, relationships: {} } },
      'wardrobe',
    )!;
    // 9 legacy entries → only the 3 design entries survive as cards.
    assert.strictEqual(
      plan.entries.length,
      3,
      'status + iteration churn dropped',
    );
    assert.ok(
      plan.entries.every((e: any) => e.doc.data.attributes.kind === 'design'),
      'only meaningful kinds become cards',
    );
    assert.strictEqual(
      (plan.index as any).data.attributes.designRoundsCount,
      3,
      'counter still reflects all 3 rounds',
    );
  });

  test('buildLegacyMigration caps the carried tail to the recent window', function (assert) {
    let entries = [];
    for (let i = 0; i < 200; i++) {
      entries.push({
        kind: 'comment',
        at: '2026-07-17T12:00:00.000Z',
        headline: 'note ' + i,
      });
    }
    let plan = buildLegacyMigration(
      { data: { attributes: { entries }, relationships: {} } },
      'wardrobe',
    )!;
    assert.ok(plan.entries.length <= 60, 'carried tail is capped (<=60)');
    // The kept entries are the MOST RECENT ones.
    let last: any = plan.entries[plan.entries.length - 1].doc;
    assert.strictEqual(
      last.data.attributes.headline,
      'note 199',
      'newest entry is kept',
    );
  });

  test('buildLegacyMigration returns null for an already-migrated index', function (assert) {
    let modern = {
      data: { type: 'card', attributes: { runId: 'wardrobe', entryCount: 3 } },
    };
    assert.strictEqual(buildLegacyMigration(modern, 'wardrobe'), null);
  });

  test('a card-path entry links the live card by absolute URL', async function (assert) {
    let { writer } = makeWriter();
    await writer.start();
    await writer.append([
      {
        kind: 'card-ready',
        headline: 'Garment shipped',
        cardPath: 'Garment/red-jacket',
      },
    ]);
    let entry = await readJson('RunLogEntries/wardrobe-000002.json');
    assert.strictEqual(
      entry.data.relationships.card.links.self,
      'https://realm.test/product/Garment/red-jacket',
      'ship-moment card linked absolutely against the product realm',
    );
  });
});

// ---------------------------------------------------------------------------
// autolinkCardReferences — card paths in prose become :card[URL] directives
// ---------------------------------------------------------------------------

module('run-log > autolinkCardReferences', function () {
  test('routes a control-plane card ref to the control realm', function (assert) {
    let out = autolinkCardReferences(
      'Wrote `Knowledge Articles/port-background.json`. 12 screens.',
      { controlRealm: CONTROL, productRealm: PRODUCT },
    );
    assert.strictEqual(
      out,
      `Wrote :card[${CONTROL}Knowledge%20Articles/port-background]. 12 screens.`,
      'backticks consumed, space encoded, control realm base',
    );
  });

  test('routes a product card ref to the product realm', function (assert) {
    let out = autolinkCardReferences(
      'Shipped Garment/orange-football-kit.json today.',
      {
        controlRealm: CONTROL,
        productRealm: PRODUCT,
      },
    );
    assert.strictEqual(
      out,
      `Shipped :card[${PRODUCT}Garment/orange-football-kit] today.`,
      'bare ref (no backticks) linked against product realm',
    );
  });

  test('links Specs against the control realm', function (assert) {
    let out = autolinkCardReferences('See `Spec/Garment.json`.', {
      controlRealm: CONTROL,
      productRealm: PRODUCT,
    });
    assert.strictEqual(out, `See :card[${CONTROL}Spec/Garment].`);
  });

  test('leaves non-card and lowercase paths untouched', function (assert) {
    let body =
      'Tokens in design/tokens.css and the mockup design/family-sheet.html.';
    assert.strictEqual(
      autolinkCardReferences(body, {
        controlRealm: CONTROL,
        productRealm: PRODUCT,
      }),
      body,
      'no .json card dirs → unchanged',
    );
  });

  test('does not rewrite references inside fenced code blocks', function (assert) {
    let body = [
      'Created `Garment/tee.json`.',
      '',
      '```',
      'boxel file write Garment/tee.json',
      '```',
    ].join('\n');
    let out = autolinkCardReferences(body, {
      controlRealm: CONTROL,
      productRealm: PRODUCT,
    });
    assert.ok(
      out.includes(`:card[${PRODUCT}Garment/tee]`),
      'prose ref outside the fence is linked',
    );
    assert.ok(
      out.includes('boxel file write Garment/tee.json'),
      'the same path inside the fence stays literal',
    );
  });

  test('falls back to the product realm when no control realm is set', function (assert) {
    let out = autolinkCardReferences('Wrote `Issues/seed.json`.', {
      productRealm: PRODUCT,
    });
    assert.strictEqual(out, `Wrote :card[${PRODUCT}Issues/seed].`);
  });

  test('links multiple references in one body', function (assert) {
    let out = autolinkCardReferences(
      'Linked `Knowledge Articles/brief.json` and Outfit/summer.json.',
      { controlRealm: CONTROL, productRealm: PRODUCT },
    );
    assert.strictEqual(
      out,
      `Linked :card[${CONTROL}Knowledge%20Articles/brief] and :card[${PRODUCT}Outfit/summer].`,
    );
  });
});

// ---------------------------------------------------------------------------
// autolinkCardReferences — agent-authored BFM directives (path → URL)
// ---------------------------------------------------------------------------

module('run-log > autolinkCardReferences directives', function () {
  const realms = { controlRealm: CONTROL, productRealm: PRODUCT };

  test('resolves an inline :card directive path to a full URL', function (assert) {
    assert.strictEqual(
      autolinkCardReferences('See :card[Garment/tee.json] here.', realms),
      `See :card[${PRODUCT}Garment/tee] here.`,
    );
  });

  test('resolves a block ::card directive path, no double-processing as inline', function (assert) {
    assert.strictEqual(
      autolinkCardReferences('::card[Garment/orange-kit.json]', realms),
      `::card[${PRODUCT}Garment/orange-kit]`,
    );
  });

  test('preserves the format spec on a block directive', function (assert) {
    assert.strictEqual(
      autolinkCardReferences(
        '::card[Knowledge Articles/port-background.json | fitted strip]',
        realms,
      ),
      `::card[${CONTROL}Knowledge%20Articles/port-background | fitted strip]`,
    );
  });

  test('resolves a markdown-link path target, keeping the link text', function (assert) {
    assert.strictEqual(
      autolinkCardReferences(
        '[the brief](Knowledge Articles/brief.json)',
        realms,
      ),
      `[the brief](${CONTROL}Knowledge%20Articles/brief)`,
    );
  });

  test('leaves a directive that already has a full URL untouched', function (assert) {
    let body = `Already linked ::card[${PRODUCT}Garment/tee | embedded] fine.`;
    assert.strictEqual(autolinkCardReferences(body, realms), body);
  });

  test('mixes an embedded spotlight with inline atoms in one body', function (assert) {
    let out = autolinkCardReferences(
      'Shipped ::card[Garment/tee.json | embedded] linked from `Outfit/summer.json`.',
      realms,
    );
    assert.strictEqual(
      out,
      `Shipped ::card[${PRODUCT}Garment/tee | embedded] linked from :card[${PRODUCT}Outfit/summer].`,
    );
  });
});
