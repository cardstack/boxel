import type { Query } from '@cardstack/runtime-common';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import GitPullRequestClosedIcon from '@cardstack/boxel-icons/git-pull-request-closed';
import GitPullRequestDraftIcon from '@cardstack/boxel-icons/git-pull-request-draft';
import GitMergeIcon from '@cardstack/boxel-icons/git-merge';

// ── Types ────────────────────────────────────────────────────────────────

export type CiStatus = 'success' | 'failure' | 'in_progress';
export type CiEventType = 'check_run' | 'check_suite';

export type CiItem = {
  name: string;
  statusText: string;
  isInProgress: boolean;
  state: CiStatus;
  url: string | null;
};

export type CiGroup = {
  items: CiItem[];
};

export type ReviewState =
  | 'changes_requested'
  | 'approved'
  | 'commented'
  | 'dismissed'
  | 'pending'
  | 'unknown';

// ── PR State Helpers ─────────────────────────────────────────────────────

export function renderPrActionLabel(
  action: string | null | undefined,
  merged?: boolean | null,
): string {
  switch (action) {
    case 'opened':
    case 'reopened':
    case 'review_requested':
      return 'Open';
    case 'closed':
      return merged ? 'Merged' : 'Closed';
    case 'draft':
      return 'Draft';
    default:
      return 'Open';
  }
}

export function getStateColor(label: string): string {
  switch (label) {
    case 'Open':
      return '#28a745';
    case 'Closed':
      return '#d73a49';
    case 'Merged':
      return '#6f42c1';
    case 'Draft':
      return '#57606a';
    default:
      return '#28a745';
  }
}

export function getPrActionIcon(label: string) {
  switch (label) {
    case 'Merged':
      return GitMergeIcon;
    case 'Closed':
      return GitPullRequestClosedIcon;
    case 'Draft':
      return GitPullRequestDraftIcon;
    default:
      return GitPullRequestIcon;
  }
}

// ── CI Helpers ───────────────────────────────────────────────────────────

export function formatCiValue(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getCiStatusFromEvent(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): CiStatus {
  if (status && status !== 'completed') {
    return 'in_progress';
  }
  switch (conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'success';
    case 'failure':
    case 'cancelled':
    case 'timed_out':
    case 'action_required':
    case 'stale':
    case 'startup_failure':
      return 'failure';
    default:
      return status === 'completed' ? 'failure' : 'in_progress';
  }
}

export function buildCiItemFromEvent(event: any, type: CiEventType): CiItem {
  const checkData =
    type === 'check_run'
      ? event?.payload?.check_run
      : event?.payload?.check_suite;
  const status = checkData?.status ?? null;
  const conclusion = checkData?.conclusion ?? null;
  const state = getCiStatusFromEvent(status, conclusion);
  const name =
    type === 'check_run'
      ? (checkData?.name ?? 'Check run')
      : (checkData?.head_branch ?? 'Check suite');
  const statusText =
    conclusion != null
      ? `${formatCiValue(status)} - ${formatCiValue(conclusion)}`
      : formatCiValue(status);

  return {
    name,
    statusText,
    isInProgress: state === 'in_progress',
    state,
    url: checkData?.html_url ?? checkData?.url ?? null,
  };
}

export function eventMatchesPrNumber(
  event: any,
  targetPrNumber: number | null | undefined,
): boolean {
  if (targetPrNumber == null) {
    return true;
  }

  let checkRunPrs = event.payload?.check_run?.pull_requests;
  let checkSuitePrs = event.payload?.check_suite?.pull_requests;

  return (
    event.prNumber === targetPrNumber ||
    event.payload?.pull_request?.number === targetPrNumber ||
    checkRunPrs?.some(
      (pr: { number?: number }) => pr?.number === targetPrNumber,
    ) ||
    checkSuitePrs?.some(
      (pr: { number?: number }) => pr?.number === targetPrNumber,
    )
  );
}

function ciNameFromEvent(event: any, type: CiEventType): string {
  let checkData =
    type === 'check_run'
      ? event?.payload?.check_run
      : event?.payload?.check_suite;
  if (type === 'check_run') {
    return checkData?.name ?? 'Check run';
  }
  return checkData?.head_branch ?? 'Check suite';
}

function eventLastModified(event: any): number {
  return event?.meta?.lastModified ?? event?.lastModified ?? 0;
}

function latestEventsByCheckId(
  events: any[],
  type: CiEventType,
  prNumber: number | null | undefined,
): any[] {
  let latestById = new Map<string, any>();
  for (let event of events) {
    if (!eventMatchesPrNumber(event, prNumber)) {
      continue;
    }
    const checkData =
      type === 'check_run'
        ? event?.payload?.check_run
        : event?.payload?.check_suite;
    const rawId = checkData?.id ?? event?.id;
    const key = `${type}:${String(rawId)}`;
    if (!latestById.has(key)) {
      latestById.set(key, event);
    }
  }
  return [...latestById.values()];
}

/**
 * Build CI items from check_run and check_suite event instances,
 * deduped by name and sorted by most recent.
 */
export function buildCiItems(
  checkRunInstances: any[],
  checkSuiteInstances: any[],
  prNumber: number | null | undefined,
): CiItem[] {
  let events: { event: any; type: CiEventType }[] = [];

  let latestSuites = latestEventsByCheckId(
    checkSuiteInstances,
    'check_suite',
    prNumber,
  );
  for (let event of latestSuites) {
    events.push({ event, type: 'check_suite' });
  }

  let latestRuns = latestEventsByCheckId(
    checkRunInstances,
    'check_run',
    prNumber,
  );
  for (let event of latestRuns) {
    events.push({ event, type: 'check_run' });
  }

  events.sort(
    (a, b) => eventLastModified(b.event) - eventLastModified(a.event),
  );

  let seenNames = new Set<string>();
  let items: CiItem[] = [];
  for (let { event, type } of events) {
    let name = ciNameFromEvent(event, type);
    if (seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);
    items.push(buildCiItemFromEvent(event, type));
  }

  return items;
}

export function buildCiGroups(ciItems: CiItem[]): CiGroup[] {
  let failed = ciItems.filter((item) => item.state === 'failure');
  let inProgress = ciItems.filter((item) => item.state === 'in_progress');
  let success = ciItems.filter((item) => item.state === 'success');

  let groups: CiGroup[] = [];
  if (failed.length) groups.push({ items: failed });
  if (inProgress.length) groups.push({ items: inProgress });
  if (success.length) groups.push({ items: success });
  return groups;
}

// ── Review Helpers ───────────────────────────────────────────────────────

export function normalizeReviewState(
  state: string | null | undefined,
): ReviewState {
  switch ((state ?? '').toLowerCase()) {
    case 'changes_requested':
      return 'changes_requested';
    case 'approved':
      return 'approved';
    case 'commented':
      return 'commented';
    default:
      return 'unknown';
  }
}

export function buildLatestReviewByReviewer(
  reviewInstances: any[],
): Map<string, any> {
  let latestByReviewer = new Map<string, any>();
  for (let event of reviewInstances) {
    let reviewerId = event?.payload?.review?.user?.id;
    if (reviewerId == null) continue;
    let key = String(reviewerId);
    if (latestByReviewer.has(key)) continue;
    latestByReviewer.set(key, event);
  }
  return latestByReviewer;
}

export function computeLatestReviewState(
  latestReviewByReviewer: Map<string, any>,
): ReviewState {
  let latestStates = [...latestReviewByReviewer.values()].map((event) =>
    normalizeReviewState(event?.payload?.review?.state),
  );
  if (latestStates.includes('changes_requested')) return 'changes_requested';
  if (latestStates.includes('approved')) return 'approved';
  return 'unknown';
}

export function findLatestChangesRequestedEvent(
  latestReviewByReviewer: Map<string, any>,
): any | null {
  let activeChangesRequestedEvents = [...latestReviewByReviewer.values()].filter(
    (event: any) =>
      normalizeReviewState(event?.payload?.review?.state) ===
        'changes_requested' &&
      (event?.payload?.review?.body ?? '').trim().length > 0,
  );
  return activeChangesRequestedEvents[0] ?? null;
}

// ── Query Builders ───────────────────────────────────────────────────────

export function buildGithubEventCardRef(moduleBaseUrl: string) {
  return {
    module: new URL('../github-event/github-event', moduleBaseUrl).href,
    name: 'GithubEventCard' as const,
  };
}

export function searchEventQuery(
  cardRef: { module: string; name: string },
  prNumber: number | null | undefined,
  eventType: string,
): Query {
  return {
    filter: {
      on: cardRef,
      eq: {
        prNumber: prNumber ?? null,
        eventType,
      },
    },
    sort: [{ by: 'lastModified', direction: 'desc' }],
  };
}

export function buildRealmHrefs(realmHref: string | undefined): string[] {
  if (!realmHref) return [];
  const url = new URL(realmHref);
  return [new URL('/submissions/', url.origin).href];
}

// ── Misc ─────────────────────────────────────────────────────────────────

export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}
