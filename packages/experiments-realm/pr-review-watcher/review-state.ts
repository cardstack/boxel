// What the PR review watcher shows about a pull request, worked out from the
// fields its GraphQL query asks GitHub for. Nothing here talks to GitHub or to
// Boxel, so the rules can be read, and tested, on their own.

export interface Actor {
  // `User`, `Bot`, `Organization`, `Mannequin` or `EnterpriseUserAccount`.
  __typename: string;
  login: string;
}

export interface Reviewer {
  __typename: string;
  // A User's.
  login?: string;
  // A Team's, as `org/slug`.
  combinedSlug?: string;
}

export interface PullRequestNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  // The searches list the most recently updated first.
  updatedAt: string;
  repository: { nameWithOwner: string };
  // Null for a deleted account ("ghost").
  author: Actor | null;
  // Every time a review was requested, from anyone, in the order it happened.
  // GitHub keeps these after it drops the reviewer from the PR's requested
  // reviewers, which it does for a team as soon as one member reviews.
  timelineItems: {
    nodes: ({ createdAt: string; requestedReviewer: Reviewer | null } | {})[];
  };
  // Each reviewer's latest review that approved or requested changes.
  latestOpinionatedReviews: {
    nodes: { state: string; author: Actor | null }[];
  };
  // Conversation comments.
  comments: { nodes: { author: Actor | null }[] };
  // Reviews, each with how many line comments it left.
  reviews: {
    nodes: {
      state: string;
      author: Actor | null;
      comments: { totalCount: number };
    }[];
  };
}

export interface ReviewRequest {
  // When review was first requested from the viewer or the team.
  at: string;
  // Whom it was requested from: the viewer's login, or the team's slug.
  from: string;
}

export interface WatchedPullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  // Absent when nobody has been asked to review it.
  requested: ReviewRequest | undefined;
  // Comments from people other than the author, bots left out.
  comments: number;
  // Reviewers whose latest opinionated review approved it.
  approvedBy: string[];
  // Reviewers whose latest opinionated review requested changes.
  changesRequestedBy: string[];
}

function isPerson(actor: Actor | null | undefined): actor is Actor {
  return Boolean(actor && actor.__typename !== 'Bot');
}

function requestsOf(pr: PullRequestNode) {
  return pr.timelineItems.nodes.filter(
    (n): n is { createdAt: string; requestedReviewer: Reviewer | null } =>
      'createdAt' in n,
  );
}

// The first time review was requested from `viewer` directly or from `team`.
// A request stays once made: a later review, comment or removed request
// doesn't take it back.
export function reviewRequestFor(
  pr: PullRequestNode,
  viewer: string,
  team: string,
): ReviewRequest | undefined {
  let viewerLogin = viewer.toLowerCase();
  let teamSlug = team.toLowerCase();
  for (let event of requestsOf(pr)) {
    let reviewer = event.requestedReviewer;
    if (reviewer?.login?.toLowerCase() === viewerLogin) {
      return { at: event.createdAt, from: reviewer.login };
    }
    if (reviewer?.combinedSlug?.toLowerCase() === teamSlug) {
      return { at: event.createdAt, from: reviewer.combinedSlug };
    }
  }
  return undefined;
}

// The first time review was requested from anyone.
export function firstReviewRequest(
  pr: PullRequestNode,
): ReviewRequest | undefined {
  for (let event of requestsOf(pr)) {
    let reviewer = event.requestedReviewer;
    let from = reviewer?.login ?? reviewer?.combinedSlug;
    if (from) {
      return { at: event.createdAt, from };
    }
  }
  return undefined;
}

export function commentCount(pr: PullRequestNode): number {
  let author = pr.author?.login;
  let byOthers = (actor: Actor | null) =>
    isPerson(actor) && actor.login !== author;
  let conversation = pr.comments.nodes.filter((c) => byOthers(c.author)).length;
  let inReviews = pr.reviews.nodes
    .filter((r) => byOthers(r.author))
    .reduce(
      // A "Comment" review with no line comments is its summary alone, which
      // is a comment of its own.
      (sum, r) =>
        sum +
        (r.comments.totalCount > 0
          ? r.comments.totalCount
          : r.state === 'COMMENTED'
            ? 1
            : 0),
      0,
    );
  return conversation + inReviews;
}

function reviewersWhose(pr: PullRequestNode, state: string): string[] {
  let author = pr.author?.login;
  return pr.latestOpinionatedReviews.nodes
    .filter(
      (r) =>
        r.state === state && isPerson(r.author) && r.author.login !== author,
    )
    .map((r) => r.author!.login);
}

function watched(
  pr: PullRequestNode,
  requested: ReviewRequest | undefined,
): WatchedPullRequest {
  return {
    repo: pr.repository.nameWithOwner,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login ?? 'ghost',
    isDraft: pr.isDraft,
    requested,
    comments: commentCount(pr),
    approvedBy: reviewersWhose(pr, 'APPROVED'),
    changesRequestedBy: reviewersWhose(pr, 'CHANGES_REQUESTED'),
  };
}

function byLongestWaiting(a: WatchedPullRequest, b: WatchedPullRequest) {
  if (a.requested && b.requested) {
    return a.requested.at.localeCompare(b.requested.at);
  }
  // Those nobody has been asked to review go last.
  return a.requested ? -1 : b.requested ? 1 : b.number - a.number;
}

// Open pull requests by others whose review was ever requested from `viewer`
// or `team`, approved or not; `arrange` narrows them by approval. The search
// that finds `nodes` keeps them to open ones; a closed or merged one never
// reaches here.
export function waitingOnReviewBy(
  nodes: PullRequestNode[],
  viewer: string,
  team: string,
): WatchedPullRequest[] {
  return nodes
    .filter((pr) => pr.author?.login !== viewer)
    .map((pr) => watched(pr, reviewRequestFor(pr, viewer, team)))
    .filter((pr) => pr.requested)
    .sort(byLongestWaiting);
}

// The viewer's own open pull requests, drafts among them.
export function authoredBy(
  nodes: PullRequestNode[],
  viewer: string,
): WatchedPullRequest[] {
  return nodes
    .filter((pr) => pr.author?.login === viewer)
    .map((pr) => watched(pr, firstReviewRequest(pr)))
    .sort(byLongestWaiting);
}

export type SortKey = 'requested' | 'author' | 'repo';
export type SortDirection = 'asc' | 'desc';

export interface Arrangement {
  sortBy: SortKey;
  // Ascending is the oldest request first, or A to Z.
  direction: SortDirection;
  // A login, or absent for every author.
  author?: string;
  // An `owner/name`, or absent for every repository.
  repo?: string;
  // Absent for every pull request.
  approval?: Approval;
}

// Whether at least one reviewer's latest opinionated review approved it.
export type Approval = 'unapproved' | 'approved';

// The longest waiting first, and pull requests nobody has been asked to
// review after every one that has.
function byRequestTime(a: WatchedPullRequest, b: WatchedPullRequest) {
  if (!a.requested || !b.requested) {
    return a.requested ? -1 : b.requested ? 1 : 0;
  }
  return a.requested.at.localeCompare(b.requested.at);
}

// A list as the watcher shows it: filtered by author and repository, then
// sorted. Pull requests nobody has been asked to review have no request time
// and go last either way. Ties on an author or repository go to the longest
// waiting.
export function arrange(
  prs: WatchedPullRequest[],
  { sortBy, direction, author, repo, approval }: Arrangement,
): WatchedPullRequest[] {
  let sign = direction === 'asc' ? 1 : -1;
  let compare = (a: WatchedPullRequest, b: WatchedPullRequest) => {
    if (sortBy === 'requested') {
      if (!a.requested || !b.requested) {
        return byRequestTime(a, b);
      }
      return sign * byRequestTime(a, b);
    }
    let field: 'author' | 'repo' = sortBy === 'author' ? 'author' : 'repo';
    return (
      sign *
        a[field].localeCompare(b[field], undefined, { sensitivity: 'base' }) ||
      byRequestTime(a, b)
    );
  };
  return prs
    .filter((pr) => (author ? pr.author === author : true))
    .filter((pr) => (repo ? pr.repo === repo : true))
    .filter((pr) =>
      approval ? pr.approvedBy.length > 0 === (approval === 'approved') : true,
    )
    .sort(compare);
}

// The distinct values of `field` in a list, sorted, for its filter menu.
export function choicesOf(
  prs: WatchedPullRequest[],
  field: 'author' | 'repo',
): string[] {
  return [...new Set(prs.map((pr) => pr[field]))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

// Brings a list held from an earlier walk of every page up to date with a
// fresh first page, which holds the most recently updated pull requests.
// Anything that changed (a review, a comment, a push, a close) moved a pull
// request onto that page, so:
//
// - a pull request on the fresh page replaces the one held;
// - one held that was updated at least as recently as the oldest on the fresh
//   page, and isn't on it, was closed or merged and is dropped;
// - when the fresh page is the whole list, it replaces the list.
export function mergeFirstPage(
  held: PullRequestNode[],
  fresh: PullRequestNode[],
  freshIsWholeList: boolean,
): PullRequestNode[] {
  if (freshIsWholeList) {
    return fresh;
  }
  let onFresh = new Set(fresh.map((pr) => pr.url));
  let oldestFresh = fresh.reduce(
    (oldest, pr) => (pr.updatedAt < oldest ? pr.updatedAt : oldest),
    fresh[0]?.updatedAt ?? '',
  );
  let older = held.filter(
    (pr) => !onFresh.has(pr.url) && pr.updatedAt < oldestFresh,
  );
  return [...fresh, ...older];
}
