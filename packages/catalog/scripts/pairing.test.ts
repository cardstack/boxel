// Run with: pnpm --dir packages/catalog test:pairing

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

import { resolvePairing } from './pairing.ts';

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

function restPull(pull: StubPull) {
  return {
    number: pull.number,
    html_url: `https://github.com/${pull.repository}/pull/${pull.number}`,
    state: pull.state ?? 'open',
    merged: pull.merged ?? false,
    draft: false,
    body: pull.body ?? '',
    base: { ref: pull.base ?? 'main' },
    head: {
      ref: pull.head,
      sha: `${pull.number}`.padEnd(40, '0'),
      repo: { full_name: pull.headRepo ?? pull.repository },
    },
  };
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
      res.end(JSON.stringify(restPull(pull)));
      return;
    }
    let list = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(url.pathname);
    if (list) {
      let [, ref] = (url.searchParams.get('head') ?? '').split(':');
      res.end(
        JSON.stringify(
          pulls
            .filter((p) => p.repository === list[1] && p.head === ref)
            .map(restPull),
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

// A boxel pull request that merges after catalog pull request 791, and the
// catalog pull request that names it back.
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
  return pulls[0];
}

function resolveBoxel(base: string) {
  let boxel = pulls.find((p) => p.repository === BOXEL && p.number === 6454)!;
  return resolvePairing(BOXEL, 6454, base, CATALOG, boxel.body ?? '');
}

test('a pair whose pull requests both target main resolves with no notice', async () => {
  pair({});
  let { resolution, problems, notices } = await resolveBoxel('main');
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
  assert.deepEqual(
    resolution.pairs.map((p) => [p.key, p.number]),
    [['merges-after', 791]],
  );
});

test('a pull request stacked on an open parent resolves, with a notice to retarget it once the parent merges', async () => {
  pair({ base: 'parent-branch' });
  pulls.push({ repository: BOXEL, number: 6417, head: 'parent-branch' });
  let { resolution, problems, notices } = await resolveBoxel('parent-branch');
  assert.deepEqual(problems, []);
  assert.equal(resolution.pairs.length, 1);
  assert.equal(notices.length, 1);
  assert.match(
    notices[0],
    /cardstack\/boxel#6454 is stacked on cardstack\/boxel#6417/,
  );
  assert.match(
    notices[0],
    /Retarget cardstack\/boxel#6454 to main once cardstack\/boxel#6417 merges/,
  );
});

test('a stacked pull request whose parent has merged fails until it is retargeted to main', async () => {
  pair({ base: 'parent-branch' });
  pulls.push({
    repository: BOXEL,
    number: 6417,
    head: 'parent-branch',
    state: 'closed',
    merged: true,
  });
  let { problems } = await resolveBoxel('parent-branch');
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /the branch of cardstack\/boxel#6417, which has merged\. Retarget cardstack\/boxel#6454 to main/,
  );
});

test('a pull request targeting a branch that belongs to no open pull request fails', async () => {
  pair({ base: 'release' });
  let { problems } = await resolveBoxel('release');
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /targets `release`, which is not the branch of an open pull request/,
  );
});

test('a counterpart stacked on an open parent of its own repository resolves, with a notice naming it', async () => {
  pair({}, { base: 'catalog-parent' });
  pulls.push({ repository: CATALOG, number: 780, head: 'catalog-parent' });
  let { resolution, problems, notices } = await resolveBoxel('main');
  assert.deepEqual(problems, []);
  assert.equal(resolution.pairs.length, 1);
  assert.deepEqual(notices.length, 1);
  assert.match(
    notices[0],
    /cardstack\/boxel-catalog#791 is stacked on cardstack\/boxel-catalog#780/,
  );
});

test('a counterpart whose parent has merged fails, naming the pull request to retarget', async () => {
  pair({}, { base: 'catalog-parent' });
  pulls.push({
    repository: CATALOG,
    number: 780,
    head: 'catalog-parent',
    state: 'closed',
    merged: true,
  });
  let { problems } = await resolveBoxel('main');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Retarget cardstack\/boxel-catalog#791 to main/);
});

test('a parent branch pushed from a fork is not a stack', async () => {
  pair({ base: 'parent-branch' });
  pulls.push({
    repository: BOXEL,
    number: 6417,
    head: 'parent-branch',
    headRepo: 'someone/boxel',
  });
  let { problems, notices } = await resolveBoxel('parent-branch');
  assert.deepEqual(notices, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /which is not the branch of an open pull request/);
});

test("a counterpart that merged into an open parent's branch has not reached main, so the pair waits on the parent", async () => {
  pair({}, { base: 'catalog-parent', state: 'closed', merged: true });
  pulls.push({ repository: CATALOG, number: 780, head: 'catalog-parent' });
  let { problems } = await resolveBoxel('main');
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /cardstack\/boxel-catalog#791 merged into the branch of cardstack\/boxel-catalog#780, so it reaches main only when cardstack\/boxel-catalog#780 merges/,
  );
});

test('a counterpart that merged into a parent that has merged too has reached main', async () => {
  pair({}, { base: 'catalog-parent', state: 'closed', merged: true });
  pulls.push({
    repository: CATALOG,
    number: 780,
    head: 'catalog-parent',
    state: 'closed',
    merged: true,
  });
  let { resolution, problems, notices } = await resolveBoxel('main');
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
  assert.equal(resolution.pairs[0]?.merged, true);
});

test('a description that declares no pair says nothing about its base', async () => {
  pulls.push({
    repository: BOXEL,
    number: 6454,
    head: 'soften',
    body: 'no pair here',
  });
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
