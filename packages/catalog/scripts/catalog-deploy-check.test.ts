// Run with: pnpm --dir packages/catalog test:deploy-check

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

import {
  assessAgainstBoxel,
  assessRollout,
  boxelPullState,
  keptMessages,
  merged,
  movementFor,
  readIgnoreRules,
  refusalMessages,
  shipsToRealm,
  type BoxelPull,
  type CatalogPull,
} from './catalog-deploy-check.ts';

const catalogRules = readIgnoreRules(
  [
    'package.json',
    'README.md',
    'tests',
    '.github',
    'scripts',
    'AGENTS.md',
  ].join('\n'),
);
const ships = (path: string) => shipsToRealm(path, catalogRules);

function catalogPull(
  number: number,
  body: string,
  files = ['realm-policy/realm-policy.gts'],
): CatalogPull {
  return {
    number,
    title: `catalog change ${number}`,
    url: `https://github.com/cardstack/boxel-catalog/pull/${number}`,
    body,
    files,
  };
}

function boxelPull(
  number: number,
  state: { merged?: boolean; closed?: boolean } = {},
): BoxelPull {
  return {
    number,
    title: `boxel change ${number}`,
    url: `https://github.com/cardstack/boxel/pull/${number}`,
    merged: state.merged ?? false,
    closed: state.closed ?? state.merged ?? false,
  };
}

function assess(
  catalogPulls: CatalogPull[],
  boxelPulls: BoxelPull[],
  deployed: number[] = [],
) {
  return assessRollout({
    catalogPulls,
    boxelPulls: new Map(boxelPulls.map((p) => [p.number, p])),
    isDeployed: (n) => deployed.includes(n),
    ships,
  });
}

test('a pin ahead of the deployed catalog moves forward', () => {
  assert.equal(movementFor('ahead'), 'forward');
});

test('a pin at the deployed catalog is a no-op', () => {
  assert.equal(movementFor('identical'), 'none');
});

test('a pin behind the deployed catalog never moves it backwards', () => {
  assert.equal(movementFor('behind'), 'backward');
});

test('a revision off the deployed history is diverged', () => {
  assert.equal(movementFor('diverged'), 'diverged');
});

test('catalog changes that declare no boxel pull request deploy', () => {
  let result = assess([catalogPull(1, 'Adds a card.')], []);
  assert.deepEqual(result.holds, []);
  assert.deepEqual(result.checked[0].needs, []);
});

test('a change whose boxel pull request is deployed deploys', () => {
  let result = assess(
    [catalogPull(1, 'Merges after: cardstack/boxel#10')],
    [boxelPull(10, { merged: true })],
    [10],
  );
  assert.deepEqual(result.holds, []);
  assert.deepEqual(result.checked[0].needs, [10]);
});

test('a change whose boxel pull request merged but is not deployed is held', () => {
  let result = assess(
    [
      catalogPull(
        1,
        'Merges after: https://github.com/cardstack/boxel/pull/10',
      ),
    ],
    [boxelPull(10, { merged: true })],
  );
  assert.equal(result.holds.length, 1);
  assert.equal(result.holds[0].reason, 'not-deployed');
  assert.equal(result.holds[0].catalog.number, 1);
  assert.equal(result.holds[0].boxel.number, 10);
});

test('a change whose boxel pull request is still open is held', () => {
  let result = assess(
    [catalogPull(1, '- `Merges after: cardstack/boxel#10`')],
    [boxelPull(10)],
  );
  assert.equal(result.holds.length, 1);
  assert.equal(result.holds[0].reason, 'unmerged');
});

test('a boxel pull request closed without merging holds nothing back', () => {
  let result = assess(
    [catalogPull(1, 'Merges after: cardstack/boxel#10')],
    [boxelPull(10, { closed: true })],
  );
  assert.deepEqual(result.holds, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /cardstack\/boxel-catalog#1 /);
  assert.match(result.warnings[0], /cardstack\/boxel#10 /);
  assert.match(result.warnings[0], /closed without merging/);
});

test('a Merges before line is not a dependency', () => {
  let result = assess(
    [catalogPull(1, 'Merges before: cardstack/boxel#10')],
    [boxelPull(10)],
  );
  assert.deepEqual(result.holds, []);
  assert.deepEqual(result.checked[0].needs, []);
});

test('a pairing line in a code block is not a dependency', () => {
  let result = assess(
    [catalogPull(1, '```\nMerges after: cardstack/boxel#10\n```')],
    [boxelPull(10)],
  );
  assert.deepEqual(result.holds, []);
});

test('a change to files the realm push skips is not checked', () => {
  let result = assess(
    [
      catalogPull(1, 'Merges after: cardstack/boxel#10', [
        '.github/workflows/deploy-production.yml',
        '.claude/skills/catalog-deploy/SKILL.md',
        'README.md',
        'scripts/pairing.ts',
      ]),
    ],
    [boxelPull(10)],
  );
  assert.deepEqual(result.holds, []);
  assert.deepEqual(
    result.skipped.map((p) => p.number),
    [1],
  );
});

test('a change to any deployed file is checked', () => {
  let result = assess(
    [
      catalogPull(1, 'Merges after: cardstack/boxel#10', [
        'README.md',
        'commands/listing-create.ts',
      ]),
    ],
    [boxelPull(10)],
  );
  assert.equal(result.holds.length, 1);
});

test('the realm push skips dot paths and ignored names at any depth', () => {
  assert.equal(ships('.github/workflows/ci.yaml'), false);
  assert.equal(ships('cards/.hidden'), false);
  assert.equal(ships('tests/foo.ts'), false);
  assert.equal(ships('cards/tests/foo.ts'), false);
  assert.equal(ships('cards/foo.gts'), true);
  assert.equal(ships('Spec/scripts-guide.json'), true);
});

test('anchored and directory-only ignore rules', () => {
  let rules = readIgnoreRules('/build\ndist/\n*.log\n# a comment\n!keep.log');
  assert.equal(shipsToRealm('build/x.js', rules), false);
  assert.equal(shipsToRealm('cards/build/x.js', rules), true);
  assert.equal(shipsToRealm('dist/x.js', rules), false);
  assert.equal(shipsToRealm('dist', rules), true);
  assert.equal(shipsToRealm('cards/debug.log', rules), false);
});

test('the refusal names each catalog pull request and the boxel one it needs', () => {
  let messages = refusalMessages(
    'production',
    [
      {
        catalog: { number: 1, title: 'catalog change 1', url: 'c1' },
        boxel: { number: 10, title: 'boxel change 10', url: 'b10' },
        reason: 'not-deployed',
      },
      {
        catalog: { number: 2, title: 'catalog change 2', url: 'c2' },
        boxel: { number: 11, title: 'boxel change 11', url: 'b11' },
        reason: 'unmerged',
      },
    ],
    {
      sha: 'abcdef0123456789',
      pull: { number: 9, title: 'boxel change 9', url: 'b9' },
    },
  );
  assert.match(
    messages[0],
    /cardstack\/boxel-catalog#1 "catalog change 1".*merges after cardstack\/boxel#10 "boxel change 10".*production doesn't run yet: it runs cardstack\/boxel@abcdef012345 \(cardstack\/boxel#9 "boxel change 9"\)/,
  );
  assert.match(
    messages[1],
    /cardstack\/boxel-catalog#2 .*cardstack\/boxel#11 .*hasn't merged yet/,
  );
  assert.match(messages[2], /Manual Deploy \[boxel\] to production/);
});

test('a catalog pull request counts once it has merged, into any branch', () => {
  assert.equal(merged({ merged_at: '2026-10-01T00:00:00Z' }), true);
  assert.equal(merged({ merged_at: null }), false);
});

test('a boxel pull request merged into a stack parent holds unless its change is on main', () => {
  let main = { ref: 'main' };
  let at = '2026-10-01T00:00:00Z';
  assert.deepEqual(
    boxelPullState({ merged_at: at, state: 'closed', base: main }),
    { merged: true, closed: false },
  );
  assert.deepEqual(
    boxelPullState({ merged_at: null, state: 'closed', base: main }),
    { merged: false, closed: true },
  );
  let stacked = boxelPullState({
    merged_at: at,
    state: 'closed',
    base: { ref: 'cs-1-parent' },
  });
  assert.deepEqual(stacked, { merged: false, closed: false });
  let result = assess(
    [catalogPull(1, 'Merges after: cardstack/boxel#10')],
    [{ ...boxelPull(10), ...stacked }],
  );
  assert.equal(result.holds[0]?.reason, 'unmerged');

  assert.deepEqual(
    boxelPullState(
      { merged_at: at, state: 'closed', base: { ref: 'cs-1-parent' } },
      true,
    ),
    { merged: true, closed: false },
  );
  assert.deepEqual(
    boxelPullState(
      { merged_at: null, state: 'open', base: { ref: 'cs-1-parent' } },
      true,
    ),
    { merged: false, closed: false },
  );
});

test('a path a negated pattern re-includes ships', () => {
  let rules = readIgnoreRules('tests\n!tests/fixtures/card.gts');
  assert.equal(shipsToRealm('tests/foo.ts', rules), false);
  assert.equal(shipsToRealm('tests/fixtures/card.gts', rules), true);
  assert.equal(
    shipsToRealm('.github/x.yml', readIgnoreRules('!.github')),
    false,
  );
});

test('a kept catalog change names the boxel pull request the environment lacks', () => {
  let messages = keptMessages(
    'production',
    [
      {
        catalog: { number: 1, title: 'catalog change 1', url: 'c1' },
        boxel: { number: 10, title: 'boxel change 10', url: 'b10' },
        reason: 'not-deployed',
      },
    ],
    { sha: 'abcdef0123456789' },
    '0123456789abcdef',
  );
  assert.match(
    messages[0],
    /catalog \(at 0123456789ab\) has cardstack\/boxel-catalog#1 .*merges after cardstack\/boxel#10 .*runs cardstack\/boxel@abcdef012345/,
  );
  assert.match(messages[1], /never moves production's catalog backwards/);
});

// A stub of the GitHub endpoints the check reads a boxel pull request's
// landing from.
interface StubBoxelPull {
  number: number;
  base: string;
  head: string;
  mergedAt?: string;
  mergeCommit?: string | null;
}

const DEPLOYED = 'd'.repeat(40);
const CHILD_MERGE = 'c'.repeat(40);
const PARENT_MERGE = 'e'.repeat(40);

let stubPulls: StubBoxelPull[] = [];
// GitHub's compare status for `<base>...<head>`; a pair it doesn't list is a
// commit GitHub doesn't have.
let comparisons = new Map<string, string>();
let requested: string[] = [];
let server: Server;

function restPull(pull: StubBoxelPull) {
  return {
    number: pull.number,
    title: `boxel change ${pull.number}`,
    html_url: `https://github.com/cardstack/boxel/pull/${pull.number}`,
    state: pull.mergedAt ? 'closed' : 'open',
    merged_at: pull.mergedAt ?? null,
    merge_commit_sha: pull.mergeCommit ?? null,
    body: '',
    base: { ref: pull.base },
    head: {
      label: `cardstack:${pull.head}`,
      repo: { full_name: 'cardstack/boxel' },
    },
  };
}

before(async () => {
  server = createServer((req, res) => {
    let url = new URL(req.url ?? '/', 'http://stub');
    requested.push(url.pathname);
    res.setHeader('content-type', 'application/json');
    let compared = /^\/repos\/cardstack\/boxel\/compare\/(.+)$/.exec(
      url.pathname,
    );
    let one = /^\/repos\/cardstack\/boxel\/pulls\/(\d+)$/.exec(url.pathname);
    if (compared && comparisons.has(compared[1])) {
      res.end(JSON.stringify({ status: comparisons.get(compared[1]) }));
    } else if (one && stubPulls.some((p) => p.number === Number(one![1]))) {
      res.end(
        JSON.stringify(
          restPull(stubPulls.find((p) => p.number === Number(one![1]))!),
        ),
      );
    } else if (url.pathname === '/repos/cardstack/boxel/pulls') {
      let head = url.searchParams.get('head');
      res.end(
        JSON.stringify(
          stubPulls.map(restPull).filter((p) => p.head.label === head),
        ),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  let { port } = server.address() as AddressInfo;
  process.env.GITHUB_API_URL = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  stubPulls = [];
  comparisons = new Map();
  requested = [];
});

// What holds a catalog change that merges after boxel #10, when the
// environment runs DEPLOYED.
async function holdOn10() {
  let { holds } = await assessAgainstBoxel(
    [catalogPull(1, 'Merges after: cardstack/boxel#10')],
    DEPLOYED,
    ships,
  );
  return holds[0]?.reason;
}

const stackedChild: StubBoxelPull = {
  number: 10,
  base: 'cs-1-parent',
  head: 'cs-2-child',
  mergedAt: '2026-10-01T12:00:00Z',
  mergeCommit: CHILD_MERGE,
};

test('a boxel pull request merged into main is deployed once the environment has its merge commit', async () => {
  stubPulls = [{ ...stackedChild, base: 'main' }];
  comparisons.set(`${CHILD_MERGE}...${DEPLOYED}`, 'behind');
  assert.equal(await holdOn10(), 'not-deployed');
  assert.deepEqual(
    requested.filter((path) => path.endsWith('...main')),
    [],
    'main is not asked about a pull request that merged into it',
  );
  comparisons.set(`${CHILD_MERGE}...${DEPLOYED}`, 'ahead');
  assert.equal(await holdOn10(), undefined);
});

test('a boxel pull request merged into another branch has landed when main has its merge commit', async () => {
  stubPulls = [stackedChild];
  for (let status of ['ahead', 'identical']) {
    comparisons.set(`${CHILD_MERGE}...main`, status);
    comparisons.set(`${CHILD_MERGE}...${DEPLOYED}`, 'diverged');
    assert.equal(await holdOn10(), 'not-deployed');
    comparisons.set(`${CHILD_MERGE}...${DEPLOYED}`, 'identical');
    assert.equal(await holdOn10(), undefined);
  }
});

test('a boxel pull request merged into a branch that has not reached main holds as unmerged', async () => {
  stubPulls = [stackedChild, { number: 9, base: 'main', head: 'cs-1-parent' }];
  for (let status of ['diverged', 'behind']) {
    comparisons.set(`${CHILD_MERGE}...main`, status);
    comparisons.set(`${CHILD_MERGE}...${DEPLOYED}`, 'ahead');
    assert.equal(await holdOn10(), 'unmerged');
  }
});

test('a merge commit GitHub does not have holds as unmerged', async () => {
  stubPulls = [stackedChild];
  assert.equal(await holdOn10(), 'unmerged');
});

test('a boxel pull request whose stack parent merged after it has landed as the parent', async () => {
  stubPulls = [
    stackedChild,
    {
      number: 9,
      base: 'main',
      head: 'cs-1-parent',
      mergedAt: '2026-10-01T13:00:00Z',
      mergeCommit: PARENT_MERGE,
    },
  ];
  comparisons.set(`${CHILD_MERGE}...main`, 'diverged');
  comparisons.set(`${PARENT_MERGE}...${DEPLOYED}`, 'behind');
  assert.equal(await holdOn10(), 'not-deployed');
  comparisons.set(`${PARENT_MERGE}...${DEPLOYED}`, 'ahead');
  assert.equal(await holdOn10(), undefined);
});

test('a boxel pull request merged into a branch whose pull request had already merged holds as unmerged', async () => {
  stubPulls = [
    stackedChild,
    {
      number: 9,
      base: 'main',
      head: 'cs-1-parent',
      mergedAt: '2026-10-01T11:00:00Z',
      mergeCommit: PARENT_MERGE,
    },
  ];
  comparisons.set(`${CHILD_MERGE}...main`, 'diverged');
  comparisons.set(`${PARENT_MERGE}...${DEPLOYED}`, 'ahead');
  assert.equal(await holdOn10(), 'unmerged');
});
