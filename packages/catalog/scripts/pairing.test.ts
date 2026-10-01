// Run with: pnpm --dir packages/catalog test:pairing

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

import { mainVerdict, resolvePairing, type Resolution } from './pairing.ts';

const BOXEL = 'cardstack/boxel';
const CATALOG = 'cardstack/boxel-catalog';

interface StubPull {
  repository: string;
  number: number;
  state?: 'open' | 'closed';
  merged?: boolean;
  base?: string;
  head: string;
  // The repository the head branch was pushed to, when it isn't `repository`.
  headRepo?: string;
  body?: string;
}

let pulls: StubPull[] = [];
let server: Server;

// A pull request as the list endpoint returns it: `merged_at`, and no
// `merged`, which only the single pull request endpoint carries.
function listedPull(pull: StubPull) {
  let headRepo = pull.headRepo ?? pull.repository;
  return {
    number: pull.number,
    html_url: `https://github.com/${pull.repository}/pull/${pull.number}`,
    state: pull.state ?? 'open',
    merged_at: pull.merged ? '2026-10-01T12:00:00Z' : null,
    draft: false,
    body: pull.body ?? '',
    base: { ref: pull.base ?? 'main' },
    head: {
      ref: pull.head,
      label: `${headRepo.split('/')[0]}:${pull.head}`,
      sha: `${pull.number}`.padEnd(40, '0'),
      repo: { full_name: headRepo },
    },
  };
}

function fetchedPull(pull: StubPull) {
  return { ...listedPull(pull), merged: pull.merged ?? false };
}

before(async () => {
  server = createServer((req, res) => {
    let url = new URL(req.url ?? '/', 'http://stub');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/graphql') {
      res.end(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewDecision: 'APPROVED',
                latestOpinionatedReviews: { nodes: [] },
              },
            },
          },
        }),
      );
      return;
    }
    let one = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(url.pathname);
    if (one) {
      let pull = pulls.find(
        (p) => p.repository === one[1] && p.number === Number(one[2]),
      );
      if (!pull) {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      res.end(JSON.stringify(fetchedPull(pull)));
      return;
    }
    let list = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(url.pathname);
    if (list) {
      // GitHub filters `head` on `owner:branch`, so a fork's branch of the
      // same name is never listed for the upstream owner.
      let head = url.searchParams.get('head') ?? '';
      res.end(
        JSON.stringify(
          pulls
            .filter((p) => p.repository === list[1])
            .map(listedPull)
            .filter((p) => p.head.label === head),
        ),
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  let { port } = server.address() as AddressInfo;
  process.env.GITHUB_API_URL = `http://127.0.0.1:${port}`;
  process.env.GITHUB_GRAPHQL_URL = `http://127.0.0.1:${port}/graphql`;
  process.env.GH_TOKEN = 'stub';
});

after(() => {
  server.close();
});

beforeEach(() => {
  pulls = [];
});

// A boxel pull request and the catalog pull request it pairs with, each
// naming the other: by default boxel merges after the catalog.
function pair(boxel: Partial<StubPull>, catalog: Partial<StubPull> = {}) {
  pulls.push(
    {
      repository: BOXEL,
      number: 6454,
      head: 'soften',
      body: 'Merges after: cardstack/boxel-catalog#791',
      ...boxel,
    },
    {
      repository: CATALOG,
      number: 791,
      head: 'soften',
      body: 'Merges before: cardstack/boxel#6454',
      ...catalog,
    },
  );
}

function resolveBoxel() {
  let boxel = pulls.find((p) => p.repository === BOXEL && p.number === 6454)!;
  return resolvePairing(
    BOXEL,
    6454,
    boxel.base ?? 'main',
    CATALOG,
    boxel.body ?? '',
  );
}

test('a pair whose pull requests both target main resolves with no notice', async () => {
  pair({});
  let { resolution, problems, notices } = await resolveBoxel();
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
  assert.equal(resolution.stackedOn, undefined);
  assert.deepEqual(
    resolution.pairs.map((p) => [p.key, p.number, p.stackedOn]),
    [['merges-after', 791, undefined]],
  );
});

test('a pull request stacked on an open parent resolves, records the parent, and says to retarget once it merges', async () => {
  pair({ base: 'parent-branch' });
  pulls.push({ repository: BOXEL, number: 6417, head: 'parent-branch' });
  let { resolution, problems, notices } = await resolveBoxel();
  assert.deepEqual(problems, []);
  assert.equal(resolution.stackedOn, 'cardstack/boxel#6417');
  assert.equal(notices.length, 1);
  assert.match(
    notices[0],
    /cardstack\/boxel#6454 is stacked on cardstack\/boxel#6417\. Retarget cardstack\/boxel#6454 to main once cardstack\/boxel#6417 merges/,
  );
});

test('a pull request still targeting the branch of a parent that merged to main is told to retarget to main', async () => {
  pair({ base: 'parent-branch' });
  pulls.push({
    repository: BOXEL,
    number: 6417,
    head: 'parent-branch',
    state: 'closed',
    merged: true,
  });
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /the branch of cardstack\/boxel#6417, which has merged, and so has every parent after it\. Retarget cardstack\/boxel#6454 to main/,
  );
});

test("a pull request whose parent merged into a grandparent that is still open is told to retarget to the grandparent's branch", async () => {
  pair({ base: 'parent-branch' });
  pulls.push(
    {
      repository: BOXEL,
      number: 6417,
      head: 'parent-branch',
      base: 'grandparent-branch',
      state: 'closed',
      merged: true,
    },
    { repository: BOXEL, number: 6400, head: 'grandparent-branch' },
  );
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /Retarget cardstack\/boxel#6454 to `grandparent-branch`, the branch of cardstack\/boxel#6400/,
  );
});

test('a pull request targeting a branch whose pull request was closed without merging fails', async () => {
  pair({ base: 'parent-branch' });
  pulls.push({
    repository: BOXEL,
    number: 6417,
    head: 'parent-branch',
    state: 'closed',
  });
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /targets `parent-branch`, and that is not the branch of an open pull request/,
  );
});

test('a pull request targeting a branch that belongs to no pull request fails', async () => {
  pair({ base: 'release' });
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /targets `release`, and that is not the branch of an open pull request/,
  );
});

test("a fork's open pull request from a branch of the same name is not a parent", async () => {
  pair({ base: 'parent-branch' });
  pulls.push({
    repository: BOXEL,
    number: 6417,
    head: 'parent-branch',
    headRepo: 'someone/boxel',
  });
  let { resolution, problems, notices } = await resolveBoxel();
  assert.deepEqual(notices, []);
  assert.equal(resolution.stackedOn, undefined);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /that is not the branch of an open pull request/);
});

test('an open counterpart stacked on an open parent of its own repository resolves, and the pair records the parent', async () => {
  pair({}, { base: 'catalog-parent' });
  pulls.push({ repository: CATALOG, number: 780, head: 'catalog-parent' });
  let { resolution, problems, notices } = await resolveBoxel();
  assert.deepEqual(problems, []);
  assert.equal(resolution.pairs[0]?.stackedOn, 'cardstack/boxel-catalog#780');
  assert.equal(notices.length, 1);
  assert.match(
    notices[0],
    /cardstack\/boxel-catalog#791 is stacked on cardstack\/boxel-catalog#780/,
  );
});

test('an open counterpart whose parent merged to main fails, naming the pull request to retarget', async () => {
  pair({}, { base: 'catalog-parent' });
  pulls.push({
    repository: CATALOG,
    number: 780,
    head: 'catalog-parent',
    state: 'closed',
    merged: true,
  });
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Retarget cardstack\/boxel-catalog#791 to main/);
});

test("a counterpart that merged into an open parent's branch has not reached main, so the pair waits on the parent", async () => {
  pair({}, { base: 'catalog-parent', state: 'closed', merged: true });
  pulls.push({ repository: CATALOG, number: 780, head: 'catalog-parent' });
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /cardstack\/boxel-catalog#791 merged into `catalog-parent`, which reaches main only when cardstack\/boxel-catalog#780 merges/,
  );
});

test('a counterpart that merged into a parent that has itself merged to main has reached main', async () => {
  pair({}, { base: 'catalog-parent', state: 'closed', merged: true });
  pulls.push({
    repository: CATALOG,
    number: 780,
    head: 'catalog-parent',
    state: 'closed',
    merged: true,
  });
  let { resolution, problems, notices } = await resolveBoxel();
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
  assert.equal(resolution.pairs[0]?.merged, true);
});

test('a counterpart whose merged parent merged into a grandparent that is still open has not reached main', async () => {
  pair({}, { base: 'catalog-parent', state: 'closed', merged: true });
  pulls.push(
    {
      repository: CATALOG,
      number: 780,
      head: 'catalog-parent',
      base: 'catalog-grandparent',
      state: 'closed',
      merged: true,
    },
    { repository: CATALOG, number: 770, head: 'catalog-grandparent' },
  );
  let { problems } = await resolveBoxel();
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /reaches main only when cardstack\/boxel-catalog#770 merges/,
  );
});

test('a description that declares no pair says nothing about its base', async () => {
  let { problems, notices } = await resolvePairing(
    BOXEL,
    6454,
    'release',
    CATALOG,
    'no pair here',
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
});

function openBefore(
  overrides: Partial<Resolution['pairs'][number]> = {},
): Resolution['pairs'][number] {
  return {
    key: 'merges-before',
    repository: CATALOG,
    number: 791,
    url: 'https://github.com/cardstack/boxel-catalog/pull/791',
    headSha: '791'.padEnd(40, '0'),
    merged: false,
    draft: false,
    approved: true,
    ...overrides,
  };
}

test('the catalog-main gate passes an approved pair this change merges before when neither side is stacked', () => {
  let verdict = mainVerdict({
    repository: BOXEL,
    number: 6454,
    pairs: [openBefore()],
  });
  assert.equal(verdict.passes, true);
  assert.match(
    verdict.message,
    /merge cardstack\/boxel-catalog#791 right after/,
  );
});

test('the catalog-main gate refuses a stacked change that merges before its pair, since merging it does not reach main', () => {
  let verdict = mainVerdict({
    repository: BOXEL,
    number: 6454,
    stackedOn: 'cardstack/boxel#6417',
    pairs: [openBefore()],
  });
  assert.equal(verdict.passes, false);
  assert.match(
    verdict.message,
    /cardstack\/boxel#6454 is stacked on cardstack\/boxel#6417, so merging it doesn't put it on main/,
  );
  assert.match(
    verdict.message,
    /Retarget cardstack\/boxel#6454 to main once cardstack\/boxel#6417 merges/,
  );
});

test('the catalog-main gate refuses a pair this change merges before when the pair is stacked, since it cannot reach catalog main right after', () => {
  let verdict = mainVerdict({
    repository: BOXEL,
    number: 6454,
    pairs: [openBefore({ stackedOn: 'cardstack/boxel-catalog#780' })],
  });
  assert.equal(verdict.passes, false);
  assert.match(
    verdict.message,
    /cardstack\/boxel-catalog#791 is stacked on cardstack\/boxel-catalog#780, so it can't land on catalog main right after this change/,
  );
});
