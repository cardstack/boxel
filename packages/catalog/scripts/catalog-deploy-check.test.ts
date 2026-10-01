// Run with: pnpm --dir packages/catalog test:deploy-check

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  assessRollout,
  mergedIntoMain,
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

test('a pin at or behind the deployed catalog is a no-op', () => {
  assert.equal(movementFor('identical'), 'none');
  assert.equal(movementFor('behind'), 'none');
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

test('only pull requests merged into main count', () => {
  let main = { ref: 'main' };
  assert.equal(
    mergedIntoMain({ merged_at: '2026-10-01T00:00:00Z', base: main }),
    true,
  );
  assert.equal(mergedIntoMain({ merged_at: null, base: main }), false);
  assert.equal(
    mergedIntoMain({
      merged_at: '2026-10-01T00:00:00Z',
      base: { ref: 'other' },
    }),
    false,
  );
});
