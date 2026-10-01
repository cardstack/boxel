// Decides whether boxel-catalog can be deployed to an environment at a given
// revision, and refuses when a catalog change in the deploy needs boxel code
// the environment doesn't run yet.
//
// The environment's catalog is recorded as a GitHub deployment in
// cardstack/boxel-catalog, and its platform as a GitHub deployment in
// cardstack/boxel (Manual Deploy [boxel] creates one per run). Between the
// catalog revision last deployed and the target, every merged catalog pull
// request that changes a file the realm push uploads is read for a pairing
// line (see pairing.ts):
//
//   Merges after: cardstack/boxel#456
//
// says the catalog change needs that boxel pull request. The deploy goes ahead
// only when each such boxel pull request has merged and its merge commit is in
// the boxel revision the environment runs. Pull requests closed without
// merging count for nothing: a closed catalog pull request never reached main,
// and a pairing that names a boxel pull request closed without merging holds
// nothing back and is reported as a warning. A boxel pull request merged into
// a branch other than main hasn't landed, so it holds.
//
// A target at or behind the deployed catalog revision deploys nothing, so a
// deploy never moves an environment's catalog backwards. That is what lets
// boxel's production deploy ask for the catalog revision it pins whenever it
// runs. Behind it, the check reads the pull requests the environment keeps
// past the target instead, and refuses when the boxel it runs lacks what they
// need, as after a boxel deploy of an older commit.
//
// Run with:
//
//   node scripts/catalog-deploy-check.ts --catalog-to=<sha> --out=<file> \
//     [--environment=production] [--catalog-from=<sha>] \
//     [--catalog-dir=<path to the catalog checkout>]
//
// Writes the decision to <file> as JSON, with `action` set to `deploy`, `skip`
// or `refuse`, and as `action=` to $GITHUB_OUTPUT when that is set. Exits 1
// only on `refuse`, printing which catalog pull request needs which boxel pull
// request. `--catalog-from` replaces the recorded catalog revision.
//
// Requests go to $GITHUB_API_URL when set (GitHub Actions sets it), with
// $GH_TOKEN when set. Both repositories are public, so any token reads them.

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { readDeclarations } from './pairing.ts';

export const CATALOG_REPOSITORY = 'cardstack/boxel-catalog';
export const BOXEL_REPOSITORY = 'cardstack/boxel';

// The catalog workflow that syncs staging on every merge. Its "Sync to
// Production" job deployed production before deployments were recorded, and
// its last success is where the first recorded deploy starts from.
const SYNC_WORKFLOW = 'sync-to-workspace.yml';
const LEGACY_SYNC_JOB = 'Sync to Production';
const STAGING_SYNC_JOB = 'Sync to Staging';

export interface PullSummary {
  number: number;
  title: string;
  url: string;
}

export interface CatalogPull extends PullSummary {
  body: string;
  files: string[];
}

export interface BoxelPull extends PullSummary {
  merged: boolean;
  // Open, or closed without merging.
  closed: boolean;
}

export interface Hold {
  catalog: PullSummary;
  boxel: PullSummary;
  reason: 'unmerged' | 'not-deployed';
}

export interface Assessment {
  // Every catalog pull request in the range that changes a deployed file.
  checked: (PullSummary & { needs: number[] })[];
  // Catalog pull requests that change only files the realm push skips.
  skipped: PullSummary[];
  holds: Hold[];
  warnings: string[];
}

export type Movement = 'forward' | 'none' | 'backward' | 'diverged';

// GitHub's compare of the deployed revision (base) against the target (head).
// A target behind the deployed revision is never deployed, since that would
// move the environment's catalog backwards; the check still asks whether the
// catalog the environment keeps needs boxel code the environment runs.
export function movementFor(compareStatus: string): Movement {
  switch (compareStatus) {
    case 'ahead':
      return 'forward';
    case 'identical':
      return 'none';
    case 'behind':
      return 'backward';
    default:
      return 'diverged';
  }
}

interface IgnoreRule {
  pattern: RegExp;
  anchored: boolean;
  directoryOnly: boolean;
  negated: boolean;
}

function globToRegExp(glob: string) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    let c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (c === '*') {
      source += '[^/]*';
    } else if (c === '?') {
      source += '[^/]';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

// The rules of a root .gitignore or .boxelignore.
export function readIgnoreRules(content: string): IgnoreRule[] {
  let rules: IgnoreRule[] = [];
  for (let raw of content.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    let negated = line.startsWith('!');
    line = line.replace(/^!/, '');
    let directoryOnly = line.endsWith('/');
    line = line.replace(/\/+$/, '');
    let anchored = line.startsWith('/') || line.includes('/');
    line = line.replace(/^\/+/, '');
    if (line) {
      rules.push({
        pattern: globToRegExp(line),
        anchored,
        directoryOnly,
        negated,
      });
    }
  }
  return rules;
}

function ruleMatches(rule: IgnoreRule, segments: string[]) {
  let starts = rule.anchored ? [0] : segments.map((_, i) => i);
  for (let start of starts) {
    for (let end = start + 1; end <= segments.length; end++) {
      // A directory-only rule matches a directory above the file, never the
      // file itself.
      if (rule.directoryOnly && end === segments.length) {
        continue;
      }
      if (rule.pattern.test(segments.slice(start, end).join('/'))) {
        return true;
      }
    }
  }
  return false;
}

// Whether `boxel realm push` uploads the file at this repository path. It
// skips every path with a segment that starts with a dot, and whatever the
// root .gitignore and .boxelignore match. A path a negated pattern matches
// counts as uploaded whatever the order of the rules, so a mistake here can
// only check a pull request it didn't need to.
export function shipsToRealm(path: string, rules: IgnoreRule[]) {
  let segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return false;
  }
  if (rules.some((rule) => rule.negated && ruleMatches(rule, segments))) {
    return true;
  }
  return !rules.some((rule) => !rule.negated && ruleMatches(rule, segments));
}

function boxelDependencies(body: string) {
  let { declarations } = readDeclarations(body);
  return declarations
    .filter(
      (d) =>
        d.key === 'merges-after' &&
        d.repository.toLowerCase() === BOXEL_REPOSITORY,
    )
    .map((d) => d.number);
}

function ref(repository: string, pull: PullSummary) {
  return `${repository}#${pull.number} "${pull.title}"`;
}

// Which catalog pull requests can't deploy yet, given the boxel pull requests
// they declare and which of those the environment runs.
export function assessRollout({
  catalogPulls,
  boxelPulls,
  isDeployed,
  ships,
}: {
  catalogPulls: CatalogPull[];
  boxelPulls: Map<number, BoxelPull | undefined>;
  isDeployed: (boxelPull: number) => boolean;
  ships: (path: string) => boolean;
}): Assessment {
  let assessment: Assessment = {
    checked: [],
    skipped: [],
    holds: [],
    warnings: [],
  };
  for (let pull of catalogPulls) {
    let summary = { number: pull.number, title: pull.title, url: pull.url };
    if (!pull.files.some(ships)) {
      assessment.skipped.push(summary);
      continue;
    }
    let needs = boxelDependencies(pull.body);
    assessment.checked.push({ ...summary, needs });
    for (let n of needs) {
      let boxel = boxelPulls.get(n);
      if (!boxel) {
        assessment.warnings.push(
          `${ref(CATALOG_REPOSITORY, pull)} merges after ` +
            `${BOXEL_REPOSITORY}#${n}, which doesn't exist, so it holds ` +
            `nothing back.`,
        );
        continue;
      }
      let boxelSummary = {
        number: boxel.number,
        title: boxel.title,
        url: boxel.url,
      };
      if (boxel.merged) {
        if (!isDeployed(boxel.number)) {
          assessment.holds.push({
            catalog: summary,
            boxel: boxelSummary,
            reason: 'not-deployed',
          });
        }
      } else if (boxel.closed) {
        assessment.warnings.push(
          `${ref(CATALOG_REPOSITORY, pull)} merges after ` +
            `${ref(BOXEL_REPOSITORY, boxel)}, which was closed without ` +
            `merging, so it holds nothing back.`,
        );
      } else {
        assessment.holds.push({
          catalog: summary,
          boxel: boxelSummary,
          reason: 'unmerged',
        });
      }
    }
  }
  return assessment;
}

// What to tell a person whose deploy was refused: each held catalog pull
// request, the boxel pull request it needs, and what the environment runs.
export function refusalMessages(
  environment: string,
  holds: Hold[],
  deployed: { sha: string; pull?: PullSummary },
) {
  let runs = deployed.pull
    ? `${BOXEL_REPOSITORY}@${deployed.sha.slice(0, 12)} ` +
      `(${ref(BOXEL_REPOSITORY, deployed.pull)})`
    : `${BOXEL_REPOSITORY}@${deployed.sha.slice(0, 12)}`;
  let messages = holds.map((hold) => {
    let needs =
      `${ref(CATALOG_REPOSITORY, hold.catalog)} (${hold.catalog.url}) ` +
      `merges after ${ref(BOXEL_REPOSITORY, hold.boxel)} (${hold.boxel.url})`;
    return hold.reason === 'unmerged'
      ? `${needs}, which hasn't merged yet. Merge it, then deploy boxel to ` +
          `${environment}.`
      : `${needs}, which ${environment} doesn't run yet: it runs ${runs}.`;
  });
  messages.push(
    `This catalog deploy has to go out in lockstep with boxel. Run Manual ` +
      `Deploy [boxel] to ${environment} once boxel main has the pull ` +
      `requests above; it deploys the catalog to the revision boxel pins ` +
      `when it finishes.`,
  );
  return messages;
}

// What to tell a person when the environment keeps catalog changes, past the
// target, whose boxel pull requests the boxel it runs doesn't have, as after a
// boxel deploy of an older commit. Nothing is deployed backwards; the fix is a
// boxel deploy that has them, or a revert on catalog main deployed forward.
export function keptMessages(
  environment: string,
  holds: Hold[],
  deployed: { sha: string; pull?: PullSummary },
  catalogSha: string,
) {
  let runs = deployed.pull
    ? `${BOXEL_REPOSITORY}@${deployed.sha.slice(0, 12)} ` +
      `(${ref(BOXEL_REPOSITORY, deployed.pull)})`
    : `${BOXEL_REPOSITORY}@${deployed.sha.slice(0, 12)}`;
  let messages = holds.map(
    (hold) =>
      `${environment}'s catalog (at ${catalogSha.slice(0, 12)}) has ` +
      `${ref(CATALOG_REPOSITORY, hold.catalog)} (${hold.catalog.url}), ` +
      `which merges after ${ref(BOXEL_REPOSITORY, hold.boxel)} ` +
      `(${hold.boxel.url}), but ${environment} runs ${runs}, which doesn't ` +
      `have it.`,
  );
  messages.push(
    `A catalog deploy never moves ${environment}'s catalog backwards. Deploy ` +
      `boxel to ${environment} at a commit that has the boxel pull requests ` +
      `above, or revert the catalog pull requests on catalog main and run ` +
      `"Deploy catalog to production" by hand.`,
  );
  return messages;
}

function apiUrl(path: string) {
  let base = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  return `${base.replace(/\/$/, '')}/${path}`;
}

async function get<T>(path: string): Promise<T> {
  let token = process.env.GH_TOKEN;
  let response = await fetch(apiUrl(path), {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

async function getOrUndefined<T>(path: string): Promise<T | undefined> {
  try {
    return await get<T>(path);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith(' 404')) {
      return undefined;
    }
    throw error;
  }
}

async function getAll<T>(path: string, perPage = 100): Promise<T[]> {
  let all: T[] = [];
  let separator = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    let items = await get<T[]>(
      `${path}${separator}per_page=${perPage}&page=${page}`,
    );
    all.push(...items);
    if (items.length < perPage) {
      return all;
    }
  }
}

interface RestPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  body: string | null;
  base: { ref: string };
}

interface RestDeployment {
  id: number;
  sha: string;
}

// The revision of the newest deployment to the environment that succeeded.
async function deployedRevision(repository: string, environment: string) {
  let deployments = await get<RestDeployment[]>(
    `repos/${repository}/deployments?environment=${encodeURIComponent(environment)}&per_page=30`,
  );
  for (let deployment of deployments) {
    let statuses = await get<{ state: string }[]>(
      `repos/${repository}/deployments/${deployment.id}/statuses?per_page=100`,
    );
    if (statuses.some((status) => status.state === 'success')) {
      return deployment.sha;
    }
  }
  return undefined;
}

// The head of the newest push to catalog main whose sync job succeeded.
async function lastSuccessfulSync(jobName: string) {
  for (let page = 1; page <= 10; page++) {
    let { workflow_runs: runs } = await get<{
      workflow_runs: { id: number; head_sha: string }[];
    }>(
      `repos/${CATALOG_REPOSITORY}/actions/workflows/${SYNC_WORKFLOW}/runs?branch=main&event=push&per_page=50&page=${page}`,
    );
    for (let run of runs) {
      let { jobs } = await get<{
        jobs: { name: string; conclusion: string | null }[];
      }>(`repos/${CATALOG_REPOSITORY}/actions/runs/${run.id}/jobs`);
      if (
        jobs.some((job) => job.name === jobName && job.conclusion === 'success')
      ) {
        return run.head_sha;
      }
    }
    if (runs.length < 50) {
      break;
    }
  }
  return undefined;
}

// Production is meant to get a catalog revision staging has already served. A
// staging sync pushes the whole tree, so a successful one at the target or a
// later commit means staging has served it. Not finding one only warns.
async function stagingWarning(to: string) {
  let staged = await lastSuccessfulSync(STAGING_SYNC_JOB);
  if (!staged) {
    return `No successful "${STAGING_SYNC_JOB}" run was found, so staging may never have served ${to.slice(0, 12)}.`;
  }
  let { status } = await get<{ status: string }>(
    `repos/${CATALOG_REPOSITORY}/compare/${to}...${staged}?per_page=1`,
  );
  if (status === 'ahead' || status === 'identical') {
    return undefined;
  }
  return (
    `Staging hasn't served ${to.slice(0, 12)} yet: its last successful ` +
    `"${STAGING_SYNC_JOB}" was at ${staged.slice(0, 12)}. Check ` +
    `https://github.com/${CATALOG_REPOSITORY}/actions/workflows/${SYNC_WORKFLOW} ` +
    `before relying on this deploy.`
  );
}

interface Compare {
  status: string;
  commits: { sha: string; commit: { message: string } }[];
}

async function compare(repository: string, base: string, head: string) {
  let path = `repos/${repository}/compare/${base}...${head}`;
  let first = await get<Compare>(`${path}?per_page=100&page=1`);
  let commits = [...first.commits];
  for (let page = 2; commits.length === (page - 1) * 100; page++) {
    let next = await get<Compare>(`${path}?per_page=100&page=${page}`);
    commits.push(...next.commits);
  }
  return { status: first.status, commits };
}

// A pull request closed without merging counts for nothing, whatever commits
// it shares with one that merged. A catalog pull request in the compare range
// reached main whichever branch it merged into: a stacked one merges into its
// parent, and the parent's merge brings it along.
export function merged(pull: Pick<RestPull, 'merged_at'>) {
  return Boolean(pull.merged_at);
}

// A boxel pull request's code is on main only once it merges into main. One
// merged into another branch, such as a stack parent, hasn't landed yet, so it
// holds like an open one.
export function boxelPullState(
  pull: Pick<RestPull, 'merged_at' | 'state' | 'base'>,
) {
  return {
    merged: Boolean(pull.merged_at) && pull.base.ref === 'main',
    closed: pull.state === 'closed' && !pull.merged_at,
  };
}

const MERGE_MESSAGE = /^Merge pull request #(\d+) from /;

// The merged catalog pull requests that brought these commits to main.
async function catalogPullsFor(commits: Compare['commits']) {
  let covered = new Set<string>();
  let numbers = new Set<number>();
  let addPull = async (n: number) => {
    numbers.add(n);
    for (let c of await getAll<{ sha: string }>(
      `repos/${CATALOG_REPOSITORY}/pulls/${n}/commits`,
    )) {
      covered.add(c.sha);
    }
  };
  let merges = commits.filter((c) => MERGE_MESSAGE.test(c.commit.message));
  let others = commits.filter((c) => !MERGE_MESSAGE.test(c.commit.message));
  for (let c of merges) {
    covered.add(c.sha);
    await addPull(Number(MERGE_MESSAGE.exec(c.commit.message)![1]));
  }
  for (let c of others) {
    if (covered.has(c.sha)) {
      continue;
    }
    let pulls = await get<RestPull[]>(
      `repos/${CATALOG_REPOSITORY}/commits/${c.sha}/pulls`,
    );
    for (let pull of pulls.filter(merged)) {
      if (!numbers.has(pull.number)) {
        await addPull(pull.number);
      }
    }
  }
  let pulls: CatalogPull[] = [];
  for (let n of [...numbers].sort((a, b) => a - b)) {
    let pull = await get<RestPull>(`repos/${CATALOG_REPOSITORY}/pulls/${n}`);
    if (!merged(pull)) {
      continue;
    }
    let files = await getAll<{ filename: string; previous_filename?: string }>(
      `repos/${CATALOG_REPOSITORY}/pulls/${n}/files`,
    );
    pulls.push({
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      body: pull.body ?? '',
      files: files.flatMap((f) =>
        f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
      ),
    });
  }
  return pulls;
}

async function mergedPullFor(repository: string, sha: string) {
  let pulls = await get<RestPull[]>(`repos/${repository}/commits/${sha}/pulls`);
  let pull = pulls.find(merged);
  return pull
    ? { number: pull.number, title: pull.title, url: pull.html_url }
    : undefined;
}

function readRules(catalogDir: string | undefined) {
  if (!catalogDir) {
    return [];
  }
  return ['.gitignore', '.boxelignore'].flatMap((name) => {
    let path = join(catalogDir, name);
    return existsSync(path) ? readIgnoreRules(readFileSync(path, 'utf8')) : [];
  });
}

// A workflow command's message ends at the first newline unless it is escaped.
function annotation(message: string) {
  return message
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function summarize(lines: string[]) {
  let file = process.env.GITHUB_STEP_SUMMARY;
  if (file) {
    appendFileSync(file, `${lines.join('\n')}\n`);
  }
}

async function main() {
  let args = process.argv.slice(2);
  let option = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  let environment = option('environment') ?? 'production';
  let to = option('catalog-to');
  let out = option('out');
  if (!to || !out) {
    console.error(
      'catalog-deploy-check: pass --catalog-to=<sha> --out=<file>, and optionally --environment=<name> --catalog-from=<sha> --catalog-dir=<path>',
    );
    process.exit(1);
  }
  let write = (decision: Record<string, unknown>) => {
    writeFileSync(resolve(out), JSON.stringify(decision, null, 2));
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `action=${decision.action}\n`);
    }
  };

  let from =
    option('catalog-from') ??
    (await deployedRevision(CATALOG_REPOSITORY, environment)) ??
    (environment === 'production'
      ? await lastSuccessfulSync(LEGACY_SYNC_JOB)
      : undefined);
  if (!from) {
    console.log(
      `::error title=catalog deploy::No deployed catalog revision is recorded for ${environment}. Pass --catalog-from=<sha> with the revision ${environment} serves.`,
    );
    write({ action: 'refuse', environment, to });
    process.exit(1);
  }

  let range = await compare(CATALOG_REPOSITORY, from, to);
  let movement = movementFor(range.status);
  if (movement === 'diverged') {
    let message = `${environment}'s catalog is at ${from.slice(0, 12)}, which isn't an ancestor of ${to.slice(0, 12)}. Deploy a revision on catalog main.`;
    console.log(`::error title=catalog deploy::${annotation(message)}`);
    write({ action: 'refuse', environment, from, to });
    process.exit(1);
  }
  if (movement === 'none') {
    let message = `${environment}'s catalog is already at ${to.slice(0, 12)}. Nothing to deploy.`;
    console.log(`catalog-deploy-check: ${message}`);
    summarize([`### Catalog deploy to ${environment}: nothing to do`, message]);
    write({ action: 'skip', environment, from, to });
    return;
  }

  let boxelSha = await deployedRevision(BOXEL_REPOSITORY, environment);
  if (!boxelSha) {
    console.log(
      `::error title=catalog deploy::No successful boxel deployment to ${environment} is recorded, so there's nothing to check the catalog against.`,
    );
    write({ action: 'refuse', environment, from, to });
    process.exit(1);
  }
  let deployedPull = await mergedPullFor(BOXEL_REPOSITORY, boxelSha);
  let boxel = { sha: boxelSha, pull: deployedPull };
  let runs = deployedPull
    ? `${BOXEL_REPOSITORY}#${deployedPull.number} (${boxelSha.slice(0, 12)})`
    : `${BOXEL_REPOSITORY}@${boxelSha.slice(0, 12)}`;

  // Moving forward, the pull requests to check are the ones the deploy would
  // add. Behind the deployed revision, nothing deploys, and the ones to check
  // are the ones the environment keeps past the target: a boxel deploy of an
  // older commit leaves them running against a platform that may lack what
  // they need.
  let commits =
    movement === 'forward'
      ? range.commits
      : (await compare(CATALOG_REPOSITORY, to, from)).commits;
  let assessment = await assess(
    await catalogPullsFor(commits),
    boxelSha,
    readRules(option('catalog-dir')),
  );
  if (movement === 'forward' && environment === 'production') {
    let warning = await stagingWarning(to);
    if (warning) {
      assessment.warnings.push(warning);
    }
  }
  for (let warning of assessment.warnings) {
    console.log(`::warning title=catalog deploy::${annotation(warning)}`);
  }

  if (movement === 'backward') {
    if (assessment.holds.length > 0) {
      let messages = keptMessages(environment, assessment.holds, boxel, from);
      for (let message of messages) {
        console.log(`::error title=catalog deploy::${annotation(message)}`);
      }
      summarize([
        `### Catalog deploy to ${environment}: its catalog needs boxel code it doesn't run`,
        `${environment} runs ${runs}.`,
        '',
        ...messages.map((m) => `- ${m}`),
      ]);
      write({ action: 'refuse', environment, from, to, boxel, ...assessment });
      process.exit(1);
    }
    let message = `${environment}'s catalog is at ${from.slice(0, 12)}, past ${to.slice(0, 12)}, and ${runs} runs everything it needs. Nothing to deploy.`;
    console.log(`catalog-deploy-check: ${message}`);
    summarize([`### Catalog deploy to ${environment}: nothing to do`, message]);
    write({ action: 'skip', environment, from, to, boxel, ...assessment });
    return;
  }

  let listed = assessment.checked.map(
    (p) =>
      `- [${CATALOG_REPOSITORY}#${p.number}](${p.url}) ${p.title}` +
      (p.needs.length
        ? ` — merges after ${p.needs.map((n) => `${BOXEL_REPOSITORY}#${n}`).join(', ')}`
        : ''),
  );
  if (assessment.holds.length > 0) {
    let messages = refusalMessages(environment, assessment.holds, boxel);
    for (let message of messages) {
      console.log(`::error title=catalog deploy::${annotation(message)}`);
    }
    summarize([
      `### Catalog deploy to ${environment}: refused`,
      `${environment} runs ${runs}.`,
      '',
      ...messages.map((m) => `- ${m}`),
      ...assessment.warnings.map((w) => `- ${w}`),
    ]);
    write({ action: 'refuse', environment, from, to, boxel, ...assessment });
    process.exit(1);
  }
  console.log(
    `catalog-deploy-check: ${environment} runs ${runs}; deploying the catalog from ${from.slice(0, 12)} to ${to.slice(0, 12)}, ${assessment.checked.length} pull request(s)`,
  );
  summarize([
    `### Catalog deploy to ${environment}: ${from.slice(0, 12)} → ${to.slice(0, 12)}`,
    `${environment} runs ${runs}.`,
    '',
    ...(listed.length ? listed : ['No pull request changes a deployed file.']),
    ...assessment.warnings.map((w) => `- ${w}`),
  ]);
  write({ action: 'deploy', environment, from, to, boxel, ...assessment });
}

// Reads the boxel pull requests these catalog pull requests declare, and which
// of them the boxel revision an environment runs contains.
async function assess(
  catalogPulls: CatalogPull[],
  boxelSha: string,
  rules: IgnoreRule[],
) {
  let boxelPulls = new Map<number, BoxelPull | undefined>();
  let deployedPulls = new Set<number>();
  for (let n of new Set(
    catalogPulls.flatMap((p) => boxelDependencies(p.body)),
  )) {
    let pull = await getOrUndefined<RestPull>(
      `repos/${BOXEL_REPOSITORY}/pulls/${n}`,
    );
    let state = pull && boxelPullState(pull);
    boxelPulls.set(
      n,
      pull &&
        state && {
          number: pull.number,
          title: pull.title,
          url: pull.html_url,
          ...state,
        },
    );
    if (pull && state?.merged && pull.merge_commit_sha) {
      let { status } = await get<{ status: string }>(
        `repos/${BOXEL_REPOSITORY}/compare/${pull.merge_commit_sha}...${boxelSha}?per_page=1`,
      );
      if (status === 'ahead' || status === 'identical') {
        deployedPulls.add(n);
      }
    }
  }
  return assessRollout({
    catalogPulls,
    boxelPulls,
    isDeployed: (n) => deployedPulls.has(n),
    ships: (path) => shipsToRealm(path, rules),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main().catch((error) => {
    console.error(
      `catalog-deploy-check: ${error instanceof Error ? error.stack : error}`,
    );
    process.exit(1);
  });
}
