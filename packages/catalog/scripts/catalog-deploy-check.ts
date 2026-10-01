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
// and a pairing that names a closed boxel pull request holds nothing back and
// is reported as a warning.
//
// A target at or behind the deployed catalog revision is a no-op, so a deploy
// never moves an environment's catalog backwards. That is what lets boxel's
// production deploy ask for the catalog revision it pins whenever it runs.
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

// The catalog workflow whose "Sync to Production" job deployed the catalog
// before deployments were recorded. Its last successful job is where the
// first recorded deploy starts from.
const LEGACY_SYNC_WORKFLOW = 'sync-to-workspace.yml';
const LEGACY_SYNC_JOB = 'Sync to Production';

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

export type Movement = 'forward' | 'none' | 'diverged';

// GitHub's compare of the deployed revision (base) against the target (head).
export function movementFor(compareStatus: string): Movement {
  switch (compareStatus) {
    case 'ahead':
      return 'forward';
    case 'identical':
    case 'behind':
      return 'none';
    default:
      return 'diverged';
  }
}

interface IgnoreRule {
  pattern: RegExp;
  anchored: boolean;
  directoryOnly: boolean;
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

// The rules of a root .gitignore or .boxelignore. Negated patterns are not
// read, so a file one of them would re-include counts as skipped.
export function readIgnoreRules(content: string): IgnoreRule[] {
  let rules: IgnoreRule[] = [];
  for (let raw of content.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    let directoryOnly = line.endsWith('/');
    line = line.replace(/\/+$/, '');
    let anchored = line.startsWith('/') || line.includes('/');
    line = line.replace(/^\/+/, '');
    if (line) {
      rules.push({ pattern: globToRegExp(line), anchored, directoryOnly });
    }
  }
  return rules;
}

// Whether `boxel realm push` uploads the file at this repository path. It
// skips every path with a segment that starts with a dot, and whatever the
// root .gitignore and .boxelignore match.
export function shipsToRealm(path: string, rules: IgnoreRule[]) {
  let segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return false;
  }
  for (let rule of rules) {
    let starts = rule.anchored ? [0] : segments.map((_, i) => i);
    for (let start of starts) {
      for (let end = start + 1; end <= segments.length; end++) {
        // A directory-only rule matches a directory above the file, never
        // the file itself.
        if (rule.directoryOnly && end === segments.length) {
          continue;
        }
        if (rule.pattern.test(segments.slice(start, end).join('/'))) {
          return false;
        }
      }
    }
  }
  return true;
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

async function legacySyncRevision() {
  for (let page = 1; page <= 10; page++) {
    let { workflow_runs: runs } = await get<{
      workflow_runs: { id: number; head_sha: string }[];
    }>(
      `repos/${CATALOG_REPOSITORY}/actions/workflows/${LEGACY_SYNC_WORKFLOW}/runs?branch=main&event=push&per_page=50&page=${page}`,
    );
    for (let run of runs) {
      let { jobs } = await get<{
        jobs: { name: string; conclusion: string | null }[];
      }>(`repos/${CATALOG_REPOSITORY}/actions/runs/${run.id}/jobs`);
      if (
        jobs.some(
          (job) => job.name === LEGACY_SYNC_JOB && job.conclusion === 'success',
        )
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

// A pull request counts only once it has merged into main; one closed without
// merging never changed main, whatever commits it shares with one that did.
export function mergedIntoMain(pull: Pick<RestPull, 'merged_at' | 'base'>) {
  return Boolean(pull.merged_at) && pull.base.ref === 'main';
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
    let merged = pulls.filter(mergedIntoMain);
    for (let pull of merged) {
      if (!numbers.has(pull.number)) {
        await addPull(pull.number);
      }
    }
  }
  let pulls: CatalogPull[] = [];
  for (let n of [...numbers].sort((a, b) => a - b)) {
    let pull = await get<RestPull>(`repos/${CATALOG_REPOSITORY}/pulls/${n}`);
    if (!mergedIntoMain(pull)) {
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
  let pull = pulls.find(mergedIntoMain);
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
    (environment === 'production' ? await legacySyncRevision() : undefined);
  if (!from) {
    console.log(
      `::error title=catalog deploy::No deployed catalog revision is recorded for ${environment}. Pass --catalog-from=<sha> with the revision ${environment} serves.`,
    );
    write({ action: 'refuse', environment, to });
    process.exit(1);
  }

  let range = await compare(CATALOG_REPOSITORY, from, to);
  let movement = movementFor(range.status);
  if (movement === 'none') {
    let message = `${environment}'s catalog is at ${from.slice(0, 12)}, which is already at or past ${to.slice(0, 12)}. Nothing to deploy.`;
    console.log(`catalog-deploy-check: ${message}`);
    summarize([`### Catalog deploy to ${environment}: nothing to do`, message]);
    write({ action: 'skip', environment, from, to });
    return;
  }
  if (movement === 'diverged') {
    let message = `${environment}'s catalog is at ${from.slice(0, 12)}, which isn't an ancestor of ${to.slice(0, 12)}. Deploy a revision on catalog main.`;
    console.log(`::error title=catalog deploy::${annotation(message)}`);
    write({ action: 'refuse', environment, from, to });
    process.exit(1);
  }

  let boxelSha = await deployedRevision(BOXEL_REPOSITORY, environment);
  if (!boxelSha) {
    console.log(
      `::error title=catalog deploy::No successful boxel deployment to ${environment} is recorded, so there's nothing to check the catalog against.`,
    );
    write({ action: 'refuse', environment, from, to });
    process.exit(1);
  }
  let boxelDeployedPull = await mergedPullFor(BOXEL_REPOSITORY, boxelSha);
  let catalogPulls = await catalogPullsFor(range.commits);
  let rules = readRules(option('catalog-dir'));

  let boxelPulls = new Map<number, BoxelPull | undefined>();
  let deployedPulls = new Set<number>();
  for (let n of new Set(
    catalogPulls.flatMap((p) => boxelDependencies(p.body)),
  )) {
    let pull = await getOrUndefined<RestPull>(
      `repos/${BOXEL_REPOSITORY}/pulls/${n}`,
    );
    boxelPulls.set(
      n,
      pull && {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        merged: mergedIntoMain(pull),
        closed: pull.state === 'closed',
      },
    );
    if (pull && mergedIntoMain(pull) && pull.merge_commit_sha) {
      let { status } = await get<{ status: string }>(
        `repos/${BOXEL_REPOSITORY}/compare/${pull.merge_commit_sha}...${boxelSha}?per_page=1`,
      );
      if (status === 'ahead' || status === 'identical') {
        deployedPulls.add(n);
      }
    }
  }

  let assessment = assessRollout({
    catalogPulls,
    boxelPulls,
    isDeployed: (n) => deployedPulls.has(n),
    ships: (path) => shipsToRealm(path, rules),
  });

  let boxel = { sha: boxelSha, pull: boxelDeployedPull };
  let runs = boxelDeployedPull
    ? `${BOXEL_REPOSITORY}#${boxelDeployedPull.number} (${boxelSha.slice(0, 12)})`
    : `${BOXEL_REPOSITORY}@${boxelSha.slice(0, 12)}`;
  for (let warning of assessment.warnings) {
    console.log(`::warning title=catalog deploy::${annotation(warning)}`);
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
