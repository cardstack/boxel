// Reads the pairing a pull request declares with a pull request in the other
// repository of the boxel / boxel-catalog pair, and checks it from both sides.
//
// A paired pull request names its counterpart on a line of its description,
// and the key says which of the two merges first:
//
//   Merges before: cardstack/boxel-catalog#123
//   Merges after: https://github.com/cardstack/boxel/pull/456
//
// `Merges before:` names the pull request this one lands ahead of, and
// `Merges after:` the one it lands behind. The counterpart states the inverse
// key naming this pull request, so a pair is declared from both sides and a
// typo or a stale pointer cannot pair two unrelated changes. A description has
// at most one line per key, and names a pull request under one key only. A key
// line may sit in a list item or in backticks; lines inside fenced code blocks
// or HTML comments don't count.
//
// Run with the pull request's description in $PR_BODY:
//
//   node scripts/pairing.ts --repository=<owner/repo> --number=<n> \
//     --base=<branch> --counterpart=<owner/repo> --out=<file>
//
// Writes the resolution to <file> as JSON, with one entry in `pairs` per
// declared key: the counterpart's number, head commit, whether it has merged,
// and whether GitHub counts it approved. Exits 1, printing what to change on
// which pull request, when a declaration is malformed or the counterpart does
// not hold up its side: it must exist, be open or merged, target main or be
// stacked, come from a branch of its own repository, and name this pull
// request back.
//
// A paired pull request targets main, or is stacked on an open pull request
// of its own repository: it targets that pull request's branch, and is
// retargeted to main once that pull request merges. Either side of a pair may
// be stacked. A stacked side passes with a notice saying so, and fails once
// its parent has merged and it still targets the parent's branch, or when the
// branch it targets belongs to no open pull request.
//
// Requests go to $GITHUB_API_URL and $GITHUB_GRAPHQL_URL when set (GitHub
// Actions sets both), with $GH_TOKEN when set. Approval comes from GraphQL,
// which needs the token; when it can't be read it is recorded as unknown with
// the reason, and whatever consumes the resolution decides whether that
// matters.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type PairingKey = 'merges-before' | 'merges-after';

export interface Pair {
  key: PairingKey;
  repository: string;
  number: number;
  url: string;
  headSha: string;
  merged: boolean;
  // A draft can't merge until it's marked ready, whatever its reviews say.
  draft: boolean;
  // GitHub's own verdict for an open pull request: true or false, or null
  // when it could not be read (see approvalError). Always false once merged.
  approved: boolean | null;
  approvalError?: string;
  // The open pull request this one is stacked on, while it targets that
  // pull request's branch rather than main.
  stackedOn?: string;
}

export interface Resolution {
  repository: string;
  number: number;
  pairs: Pair[];
  // The open pull request this one is stacked on, when it is.
  stackedOn?: string;
}

// Where a pull request's base leads. `main` is main itself. `stacked` is the
// branch of an open pull request, `parent`, reached directly or through the
// branches of parents that have merged since (`mergedVia`, the first of them).
// `landed` is a chain of merged parents that ends on main.
export type Landing =
  | { kind: 'main' }
  | { kind: 'stacked'; parent: string; branch: string; mergedVia?: string }
  | { kind: 'landed'; mergedVia: string }
  | { kind: 'problem'; problem: string };

// A pull request as the list endpoint returns it, which has `merged_at` but
// no `merged`.
interface ListedPull {
  number: number;
  state: string;
  merged_at: string | null;
  base: { ref: string };
  head: { repo: { full_name: string } | null };
}

// Deep enough for any stack a person builds, and a bound on a cycle of
// retargeted branches.
const MAX_STACK_DEPTH = 10;

interface Declaration {
  key: PairingKey;
  repository: string;
  number: number;
  line: string;
}

const KEY_LABEL: Record<PairingKey, string> = {
  'merges-before': 'Merges before',
  'merges-after': 'Merges after',
};

const INVERSE: Record<PairingKey, PairingKey> = {
  'merges-before': 'merges-after',
  'merges-after': 'merges-before',
};

const FENCE = /^\s*(```|~~~)/;
const KEY_LINE =
  /^\s*(?:[-*+]\s+)?`?\s*merges\s+(before|after)\s*:\s*(.*?)\s*`?\s*$/i;
const SHORT_REF = /^<?([\w.-]+\/[\w.-]+)#(\d+)>?$/;
const URL_REF =
  /^<?https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#][^\s>]*)?>?$/i;

export function pairingLine(key: PairingKey, repository: string, n: number) {
  return `${KEY_LABEL[key]}: ${repository}#${n}`;
}

function sameRepository(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

// The pairing declarations in a description, and the lines that look like one
// but can't be read.
export function readDeclarations(body: string) {
  let declarations: Declaration[] = [];
  let malformed: string[] = [];
  let inFence = false;
  let inComment = false;
  for (let rawLine of body.split(/\r?\n/)) {
    let line = rawLine;
    if (!inComment && FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    // HTML comments don't render, so nothing in one declares anything, even
    // when the comment spans lines.
    if (inComment) {
      let end = line.indexOf('-->');
      if (end === -1) {
        continue;
      }
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    let open = line.indexOf('<!--');
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    let match = KEY_LINE.exec(line);
    if (!match) {
      continue;
    }
    let key: PairingKey =
      match[1].toLowerCase() === 'before' ? 'merges-before' : 'merges-after';
    let value = match[2].replace(/^`+|`+$/g, '').trim();
    let ref = SHORT_REF.exec(value) ?? URL_REF.exec(value);
    if (!ref) {
      malformed.push(line.trim());
      continue;
    }
    declarations.push({
      key,
      repository: ref[1],
      number: Number(ref[2]),
      line: line.trim(),
    });
  }
  return { declarations, malformed };
}

function apiUrl(path: string) {
  let base = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  return `${base.replace(/\/$/, '')}/${path}`;
}

function authHeaders(): Record<string, string> {
  let token = process.env.GH_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface RestPull {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
  merged_at: string | null;
  draft?: boolean;
  body: string | null;
  base: { ref: string };
  head: { sha: string; repo: { full_name: string } | null };
}

async function getJson<T>(path: string): Promise<T | undefined> {
  let response = await fetch(apiUrl(path), {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...authHeaders(),
    },
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GET ${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

function fetchPull(repository: string, n: number) {
  return getJson<RestPull>(`repos/${repository}/pulls/${n}`);
}

// Where a pull request of `repository` that targets `base` leads. A base other
// than main belongs to a parent: the pull request of the same repository whose
// branch it is, not one pushed from a fork. An open parent makes this one
// stacked on it. A merged parent hands on to the branch it merged into, which
// is main once the whole stack has landed. `who` names the pull request in
// what this says, and `mergedAt` is when it merged, if it has. A change that
// merged into a branch reaches the branch below only through a merge of that
// branch's pull request after it, so a parent that had merged before it
// carried nothing of it: a branch is kept after its pull request merges, and
// can be merged into again or reused by a new pull request.
export async function landing(
  repository: string,
  who: string,
  base: string,
  mergedAt?: string,
): Promise<Landing> {
  let [owner] = repository.split('/');
  let branch = base;
  let mergedVia: string | undefined;
  let since = mergedAt;
  for (let depth = 0; depth < MAX_STACK_DEPTH; depth++) {
    if (branch === 'main') {
      return mergedVia ? { kind: 'landed', mergedVia } : { kind: 'main' };
    }
    let listed: ListedPull[] | undefined;
    try {
      listed = await getJson<ListedPull[]>(
        `repos/${repository}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      );
    } catch (error) {
      return {
        kind: 'problem',
        problem:
          `Could not read which pull request owns \`${branch}\`, which ` +
          `${who}'s base leads to (${error instanceof Error ? error.message : String(error)}). ` +
          `Re-run this check.`,
      };
    }
    let parents = (listed ?? []).filter(
      (pull) =>
        pull.head.repo && sameRepository(pull.head.repo.full_name, repository),
    );
    let open = parents.find((pull) => pull.state === 'open');
    if (open) {
      return {
        kind: 'stacked',
        parent: `${repository}#${open.number}`,
        branch,
        ...(mergedVia ? { mergedVia } : {}),
      };
    }
    let mergedParents = parents
      .filter((pull) => pull.merged_at != null)
      .sort((a, b) => a.merged_at!.localeCompare(b.merged_at!));
    let merged = since
      ? mergedParents.find((pull) => pull.merged_at! >= since!)
      : mergedParents[mergedParents.length - 1];
    if (!merged && mergedParents.length > 0) {
      let last = mergedParents[mergedParents.length - 1];
      return {
        kind: 'problem',
        problem:
          `${who} merged into \`${branch}\` after ${repository}#${last.number}, ` +
          `that branch's pull request, had already merged, so it never ` +
          `reached the branch below. Land it on main in a new pull request.`,
      };
    }
    if (!merged) {
      return {
        kind: 'problem',
        problem:
          `${who} targets \`${base}\`` +
          (branch === base ? '' : `, which leads to \`${branch}\``) +
          `, and that is not the branch of an open pull request. A pair's ` +
          `pull requests target main, or are stacked on an open pull ` +
          `request and retargeted to main once it merges.`,
      };
    }
    mergedVia ??= `${repository}#${merged.number}`;
    branch = merged.base.ref;
    since = merged.merged_at!;
  }
  return {
    kind: 'problem',
    problem:
      `${who} targets \`${base}\`, which leads through more than ` +
      `${MAX_STACK_DEPTH} merged pull requests without reaching main or an ` +
      `open pull request. Retarget ${who} to main.`,
  };
}

// What an open pull request whose base leads to `landed` is told, and the
// parent it is stacked on, if any.
function openSide(
  who: string,
  base: string,
  landed: Landing,
): { problem?: string; notice?: string; stackedOn?: string } {
  switch (landed.kind) {
    case 'main':
      return {};
    case 'problem':
      return { problem: landed.problem };
    case 'landed':
      return {
        problem:
          `${who} targets \`${base}\`, the branch of ${landed.mergedVia}, ` +
          `which has merged, and so has every parent after it. Retarget ` +
          `${who} to main.`,
      };
    case 'stacked':
      if (landed.mergedVia) {
        return {
          problem:
            `${who} targets \`${base}\`, the branch of ${landed.mergedVia}, ` +
            `which has merged into the stack below it. Retarget ${who} to ` +
            `\`${landed.branch}\`, the branch of ${landed.parent}.`,
        };
      }
      return {
        stackedOn: landed.parent,
        notice:
          `${who} is stacked on ${landed.parent}. Retarget ${who} to main ` +
          `once ${landed.parent} merges: the pair's merge order is between ` +
          `pull requests that land on main.`,
      };
  }
}

const APPROVAL_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewDecision
        latestOpinionatedReviews(first: 100, writersOnly: true) {
          nodes {
            state
          }
        }
      }
    }
  }
`;

// Whether GitHub counts the pull request approved. That is its own review
// decision, which counts only reviewers with write access and applies the base
// branch's review rules. When no rule requires a review GitHub reports no
// decision, so the latest review from each writer stands instead: an approval
// counts while no request for changes stands beside it.
async function fetchApproval(repository: string, n: number) {
  let token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GH_TOKEN is not set, and the GitHub GraphQL API needs it');
  }
  let [owner, name] = repository.split('/');
  let response = await fetch(
    process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        query: APPROVAL_QUERY,
        variables: { owner, name, number: n },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`the GitHub GraphQL API answered ${response.status}`);
  }
  let body = (await response.json()) as {
    data?: {
      repository: {
        pullRequest: {
          reviewDecision: string | null;
          latestOpinionatedReviews: { nodes: { state: string }[] } | null;
        } | null;
      } | null;
    };
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  let pull = body.data?.repository?.pullRequest;
  if (!pull) {
    throw new Error(`GraphQL has no pull request ${repository}#${n}`);
  }
  if (pull.reviewDecision) {
    return pull.reviewDecision === 'APPROVED';
  }
  let states = (pull.latestOpinionatedReviews?.nodes ?? []).map(
    (review) => review.state,
  );
  return states.includes('APPROVED') && !states.includes('CHANGES_REQUESTED');
}

// Checks each declaration against its counterpart and returns the pairs, or
// the problems, each one saying what to change on which pull request.
export async function resolvePairing(
  repository: string,
  n: number,
  base: string,
  counterpartRepository: string,
  body: string,
): Promise<{ resolution: Resolution; problems: string[]; notices: string[] }> {
  let here = `${repository}#${n}`;
  let notices: string[] = [];
  let { declarations, malformed } = readDeclarations(body);
  let problems: string[] = malformed.map(
    (line) =>
      `${here}'s description has \`${line}\`, which doesn't name a pull ` +
      `request. Write it as \`Merges before: owner/repo#N\` or \`Merges ` +
      `after: owner/repo#N\`, or as the pull request's URL.`,
  );
  let pairs: Pair[] = [];
  let before = declarations.find((d) => d.key === 'merges-before');
  let after = declarations.find((d) => d.key === 'merges-after');
  if (
    before &&
    after &&
    sameRepository(before.repository, after.repository) &&
    before.number === after.number
  ) {
    problems.push(
      `${here}'s description names ${before.repository}#${before.number} ` +
        `under both keys, but a pull request merges either before or after ` +
        `another. Keep the line that says which.`,
    );
    return { resolution: { repository, number: n, pairs }, problems, notices };
  }
  let stackedOn: string | undefined;
  if (declarations.length > 0) {
    let own = openSide(here, base, await landing(repository, here, base));
    if (own.problem) {
      problems.push(own.problem);
    }
    if (own.notice) {
      notices.push(own.notice);
    }
    stackedOn = own.stackedOn;
  }
  for (let key of Object.keys(KEY_LABEL) as PairingKey[]) {
    let declared = declarations.filter((d) => d.key === key);
    if (declared.length > 1) {
      problems.push(
        `${here}'s description has ${declared.length} \`${KEY_LABEL[key]}:\` ` +
          `lines. Keep one.`,
      );
      continue;
    }
    let declaration = declared[0];
    if (!declaration) {
      continue;
    }
    if (!sameRepository(declaration.repository, counterpartRepository)) {
      problems.push(
        `${here}'s description has \`${declaration.line}\`, but this ` +
          `repository pairs only with ${counterpartRepository} pull requests.`,
      );
      continue;
    }
    let there = `${counterpartRepository}#${declaration.number}`;
    let pull: RestPull | undefined;
    try {
      pull = await fetchPull(counterpartRepository, declaration.number);
    } catch (error) {
      problems.push(
        `Could not read ${there}, which ${here} pairs with ` +
          `(${error instanceof Error ? error.message : String(error)}). ` +
          `Re-run this check.`,
      );
      continue;
    }
    let backLine = pairingLine(INVERSE[key], repository, n);
    if (!pull) {
      problems.push(
        `${here} pairs with ${there}, which doesn't exist. Fix ` +
          `\`${declaration.line}\` in ${here}'s description.`,
      );
      continue;
    }
    if (pull.state !== 'open' && !pull.merged) {
      problems.push(
        `${here} pairs with ${there}, which was closed without merging. ` +
          `Remove \`${declaration.line}\` from ${here}'s description, or ` +
          `name the pull request that replaced it.`,
      );
      continue;
    }
    // A merged pull request has reached main once every parent below it has
    // merged too. Until then the pair waits.
    let counterpartLanding = await landing(
      counterpartRepository,
      there,
      pull.base.ref,
      pull.merged_at ?? undefined,
    );
    let counterpartStackedOn: string | undefined;
    if (pull.merged) {
      if (counterpartLanding.kind === 'problem') {
        problems.push(counterpartLanding.problem);
        continue;
      }
      if (counterpartLanding.kind === 'stacked') {
        problems.push(
          `${there} merged into \`${pull.base.ref}\`, which reaches main ` +
            `only when ${counterpartLanding.parent} merges. Re-run this ` +
            `check then.`,
        );
        continue;
      }
    } else {
      let theirs = openSide(there, pull.base.ref, counterpartLanding);
      if (theirs.problem) {
        problems.push(theirs.problem);
        continue;
      }
      if (theirs.notice) {
        notices.push(theirs.notice);
      }
      counterpartStackedOn = theirs.stackedOn;
    }
    if (
      !pull.head.repo ||
      !sameRepository(pull.head.repo.full_name, counterpartRepository)
    ) {
      problems.push(
        `${here} pairs with ${there}, whose branch is in ` +
          `${pull.head.repo?.full_name ?? 'a deleted repository'}. A paired ` +
          `pull request comes from a branch of ${counterpartRepository}.`,
      );
      continue;
    }
    let { declarations: theirs } = readDeclarations(pull.body ?? '');
    let namesUs = (k: PairingKey) =>
      theirs.some(
        (d) =>
          d.key === k &&
          sameRepository(d.repository, repository) &&
          d.number === n,
      );
    if (namesUs(key)) {
      problems.push(
        `${here} says \`${declaration.line}\`, and ${there} names ${here} ` +
          `with \`${KEY_LABEL[key]}:\` too, but only one of them can merge ` +
          `first. Agree which does, and give the other one ` +
          `\`${KEY_LABEL[INVERSE[key]]}:\` instead.`,
      );
      continue;
    }
    if (!namesUs(INVERSE[key])) {
      problems.push(
        `${here} says \`${declaration.line}\`, but ${there} doesn't name ` +
          `${here} back. Add \`${backLine}\` to ${there}'s description.`,
      );
      continue;
    }
    let approved: boolean | null = false;
    let approvalError: string | undefined;
    if (!pull.merged) {
      try {
        approved = await fetchApproval(counterpartRepository, pull.number);
      } catch (error) {
        approved = null;
        approvalError = error instanceof Error ? error.message : String(error);
      }
    }
    pairs.push({
      key,
      repository: counterpartRepository,
      number: pull.number,
      url: pull.html_url,
      headSha: pull.head.sha,
      merged: pull.merged,
      draft: Boolean(pull.draft),
      approved,
      ...(approvalError ? { approvalError } : {}),
      ...(counterpartStackedOn ? { stackedOn: counterpartStackedOn } : {}),
    });
  }
  return {
    resolution: {
      repository,
      number: n,
      pairs,
      ...(stackedOn ? { stackedOn } : {}),
    },
    problems,
    notices,
  };
}

// Whether catalog main may fail with the errors the change adds to it. A
// catalog pull request this change merges after has to land first, so while it
// is open the verdict is to wait for it. Otherwise they may only while a
// catalog pull request this change merges before is open, ready for review and
// approved, so it can land right after this one.
export function mainVerdict(resolution: Resolution) {
  let here = `${resolution.repository}#${resolution.number}`;
  let ref = (pair: Pair) => `${pair.repository}#${pair.number}`;
  let before = resolution.pairs.find(
    (p) => p.key === 'merges-before' && !p.merged,
  );
  let after = resolution.pairs.find(
    (p) => p.key === 'merges-after' && !p.merged,
  );
  if (after) {
    return {
      passes: false,
      message:
        `${here} merges after ${ref(after)}, so catalog main is linted ` +
        `against this change once that has landed: waiting on ${ref(after)} ` +
        `to merge. Re-run this check after it merges.`,
    };
  }
  // A stacked side lands on its parent's branch, not main, so merging it is
  // not the merge the other side can follow right after.
  if (before && resolution.stackedOn) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, but ${here} is stacked on ` +
        `${resolution.stackedOn}, so merging it doesn't put it on main and ` +
        `${ref(before)} can't follow right after. Retarget ${here} to main ` +
        `once ${resolution.stackedOn} merges, and re-run this check.`,
    };
  }
  if (before?.stackedOn) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, but ${ref(before)} is stacked ` +
        `on ${before.stackedOn}, so it can't land on catalog main right after ` +
        `this change. Retarget it to main once ${before.stackedOn} merges, ` +
        `and re-run this check.`,
    };
  }
  if (before?.draft) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, which is still a draft, so it ` +
        `can't merge right after this change. Mark it ready for review, get ` +
        `it approved, and re-run this check.`,
    };
  }
  if (before?.approved === true) {
    return {
      passes: true,
      message:
        `${here} merges before ${ref(before)}, which is approved: merge ` +
        `${ref(before)} right after this change, so catalog main fails with ` +
        `these errors only in between.`,
    };
  }
  if (before?.approved === false) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, which is not approved yet, so ` +
        `catalog main would fail with these errors until it is. Get it ` +
        `approved, re-run this check, and merge ${ref(before)} right after ` +
        `this change.`,
    };
  }
  if (before) {
    return {
      passes: false,
      message:
        `${here} merges before ${ref(before)}, and whether that is approved ` +
        `could not be read (${before.approvalError}). Re-run this check.`,
    };
  }
  let catalogRepository = 'cardstack/boxel-catalog';
  let pairing =
    `\`Merges before: ${catalogRepository}#<number>\` in ${here}'s ` +
    `description, and \`Merges after: ${here}\` in that pull request's`;
  let mergedBefore = resolution.pairs.find((p) => p.key === 'merges-before');
  if (mergedBefore) {
    return {
      passes: false,
      message:
        `Merging this change leaves catalog main failing with these errors, ` +
        `and ${ref(mergedBefore)}, which it merges before, has already ` +
        `merged, so it can't fix them. Keep the change compatible with the ` +
        `catalog as it is, or fix the catalog in a new ${catalogRepository} ` +
        `pull request and pair the two: replace the \`Merges before:\` line ` +
        `so there is ${pairing}.`,
    };
  }
  return {
    passes: false,
    message:
      `Merging this change leaves catalog main failing with these errors. ` +
      `Keep the change compatible with the catalog as it is, or fix the ` +
      `catalog in a ${catalogRepository} pull request and pair the two, ` +
      `with ${pairing}.`,
  };
}

function describe(here: string, pair: Pair) {
  let state = pair.merged
    ? 'merged'
    : pair.draft
      ? 'open, draft'
      : pair.approved === null
        ? `open, approval unknown: ${pair.approvalError}`
        : pair.approved
          ? 'open, approved'
          : 'open, not approved';
  let order = pair.key === 'merges-before' ? 'merges before' : 'merges after';
  return `${here} ${order} ${pair.repository}#${pair.number} (${state}, head ${pair.headSha.slice(0, 12)})`;
}

// A workflow command's message ends at the first newline unless it is escaped.
function annotation(message: string) {
  return message
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

async function main() {
  let args = process.argv.slice(2);
  let option = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  let repository = option('repository');
  let n = Number(option('number'));
  let base = option('base');
  let counterpart = option('counterpart');
  let out = option('out');
  if (
    !repository ||
    !Number.isInteger(n) ||
    n <= 0 ||
    !base ||
    !counterpart ||
    !out
  ) {
    console.error(
      'pairing: pass --repository=<owner/repo> --number=<n> --base=<branch> --counterpart=<owner/repo> --out=<file>, with the description in $PR_BODY',
    );
    process.exit(1);
  }
  let { resolution, problems, notices } = await resolvePairing(
    repository,
    n,
    base,
    counterpart,
    process.env.PR_BODY ?? '',
  );
  let here = `${repository}#${n}`;
  for (let pair of resolution.pairs) {
    console.log(`pairing: ${describe(here, pair)}`);
  }
  if (resolution.pairs.length === 0 && problems.length === 0) {
    console.log(`pairing: ${here} declares no pair with ${counterpart}`);
  }
  for (let notice of notices) {
    console.log(`::notice title=pairing::${annotation(notice)}`);
  }
  for (let problem of problems) {
    console.log(`::error title=pairing::${annotation(problem)}`);
  }
  writeFileSync(resolve(out), JSON.stringify(resolution, null, 2));
  process.exit(problems.length > 0 ? 1 : 0);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main().catch((error) => {
    console.error(`pairing: ${error instanceof Error ? error.stack : error}`);
    process.exit(1);
  });
}
