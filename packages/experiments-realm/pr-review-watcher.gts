import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import Modifier from 'ember-modifier';

import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  bxl,
  instance,
  operation,
  params,
  operations,
  OperationsError,
  type OperationDeclaration,
} from '@cardstack/base/operations';
import OpenSecureWindowTool from '@cardstack/boxel-host/tools/open-secure-window';

import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Collapsible } from '@cardstack/pretui/components/collapsible';
import { EmptyState } from '@cardstack/pretui/components/empty-state';
import { NativeSelect } from '@cardstack/pretui/components/native-select';
import { SegmentedControl } from '@cardstack/pretui/components/segmented-control';
import { RelativeTime } from '@cardstack/pretui/components/relative-time';
import { Spinner } from '@cardstack/pretui/components/spinner';
import { Tabs } from '@cardstack/pretui/components/tabs';
import { and, eq } from '@cardstack/pretui/helpers';

import {
  arrange,
  authoredBy,
  choicesOf,
  mergeFirstPage,
  waitingOnReviewBy,
  type PullRequestNode,
  type SortDirection,
  type SortKey,
  type WatchedPullRequest,
} from './pr-review-watcher/review-state';

// One GraphQL request answers a whole list: the pull requests a search finds,
// each with its review requests, reviews and comments. The two operations
// differ only in the search, so both carry this same document.
const SEARCH_PULL_REQUESTS = `query($q: String!, $after: String) {
  viewer { login }
  search(type: ISSUE, query: $q, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        createdAt
        updatedAt
        repository { nameWithOwner }
        author { __typename login }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 100) {
          nodes {
            ... on ReviewRequestedEvent {
              createdAt
              requestedReviewer {
                __typename
                ... on User { login }
                ... on Team { combinedSlug }
              }
            }
          }
        }
        latestOpinionatedReviews(first: 50) {
          nodes { state author { __typename login } }
        }
        comments(last: 100) { nodes { author { __typename login } } }
        reviews(last: 100) {
          nodes { state author { __typename login } comments { totalCount } }
        }
      }
    }
  }
}`;

// "Me" is whoever the token belongs to (`viewer`, `@me`), so the card needs no
// login of its own and each person sees what their own token can.
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const AUTH = { authorization: 'Bearer {{userKey}}' };
const ANSWER = bxl`{status: .status, viewer: .body.data.viewer.login, total: .body.data.search.issueCount, more: .body.data.search.pageInfo.hasNextPage, cursor: .body.data.search.pageInfo.endCursor, pullRequests: .body.data.search.nodes, errors: .body.errors}`;

// The line the secure window shows as the card's reason for opening it.
const SIGN_IN_REASON =
  'PR review watcher lists the pull requests waiting on your review, as you, by signing in to GitHub';
const TOKEN_REASON =
  'PR review watcher needs a GitHub token that can read the pull requests in your organization: a fine-grained token with read-only Pull requests and Members, or a classic token with repo and read:org';

// Boxel's own GitHub App, which a person signs in to GitHub through. It reads
// an organization's private repositories only once it is installed there.
const INSTALL_GITHUB_APP =
  'https://github.com/apps/boxel-read-only/installations/new';

interface SearchAnswer {
  status: number;
  viewer: string | null;
  total: number | null;
  more: boolean | null;
  cursor: string | null;
  pullRequests: (PullRequestNode | Record<string, never>)[] | null;
  errors: { message: string }[] | null;
}

type Tab = 'review' | 'mine';

// How often an open watcher asks GitHub again. Each time is two calls, which
// count against the key's limits in Boxel.
const POLL_EVERY_MS = 60_000;
// Each minute's poll reads only the first page of each search, the most
// recently updated, which is where any change to a pull request moves it.
// Every this often, and when the watcher opens, it walks every page.
const WALK_EVERY_MS = 10 * 60_000;
// A search is read at most this many pages deep (100 pull requests a page).
const MOST_PAGES = 20;

type SearchOperation = 'waitingOnMyReview' | 'myPullRequests';

// Whether this browser has opened the GitHub sign-in for a watcher card.
// Signing in leaves readiness at needs-connect until the watcher's calls are
// approved, so opening the sign-in again on the next visit would make a
// second connection; the next visit opens the approve page instead.
function signInStarted(cardId: string) {
  try {
    return (
      localStorage.getItem(`pr-review-watcher:signed-in:${cardId}`) === '1'
    );
  } catch {
    return false;
  }
}

function rememberSignIn(cardId: string) {
  try {
    localStorage.setItem(`pr-review-watcher:signed-in:${cardId}`, '1');
  } catch {
    // Not remembered; at worst the next visit opens the sign-in again.
  }
}

const NEW_FINE_GRAINED_TOKEN =
  'https://github.com/settings/personal-access-tokens/new';
const NEW_CLASSIC_TOKEN =
  'https://github.com/settings/tokens/new?description=Boxel%20PR%20review%20watcher&scopes=repo,read:org';

// Step by step, how to make the token the watcher needs on GitHub, for
// whoever opens the card without one.
class TokenGuide extends GlimmerComponent<{
  Args: { org: string | undefined; defaultOpen?: boolean };
}> {
  fineGrained = NEW_FINE_GRAINED_TOKEN;
  classic = NEW_CLASSIC_TOKEN;

  <template>
    <Collapsible
      @label='Or use a GitHub token: how to make one'
      @defaultOpen={{@defaultOpen}}
      class='token-guide'
      data-test-token-guide
    >
      <ol class='steps'>
        <li>
          Open
          <a
            href={{this.fineGrained}}
            target='_blank'
            rel='noopener noreferrer'
          >
            GitHub's page for a new fine-grained token</a>.
        </li>
        <li>
          Name it (for example, "Boxel PR review watcher") and choose when it
          expires.
        </li>
        <li>
          Under
          <strong>Resource owner</strong>, choose
          <strong>{{@org}}</strong>. The organization's owners approve a token
          before it can read the organization's private repositories.
        </li>
        <li>
          Under
          <strong>Repository access</strong>, choose
          <strong>All repositories</strong>.
        </li>
        <li>
          Under
          <strong>Permissions</strong>, give
          <strong>Pull requests</strong>
          (a repository permission) and
          <strong>Members</strong>
          (an organization permission) read-only access. GitHub adds read-only
          Metadata for you. The watcher needs nothing else, and nothing that
          writes.
        </li>
        <li>
          Choose
          <strong>Generate token</strong>
          and copy it. GitHub shows it only once.
        </li>
        <li>
          Back here, choose
          <strong>Use a token instead</strong>. In the window that opens, check
          that its address bar shows Boxel's secure address, choose
          <strong>Add a new key</strong>, and paste the token there. Never paste
          it into a card, a chat or a file.
        </li>
      </ol>
      <p class='alternative'>
        A
        <a href={{this.classic}} target='_blank' rel='noopener noreferrer'>
          classic token</a>
        with the
        <code>repo</code>
        and
        <code>read:org</code>
        scopes works too, without waiting for approval, but it can also write to
        every repository you can. If
        {{@org}}
        signs in with single sign-on, choose
        <strong>Configure SSO</strong>
        beside the classic token on GitHub and authorize it for
        {{@org}}.
      </p>
    </Collapsible>
    <style scoped>
      .steps {
        margin: var(--boxel-sp-xs) 0;
        padding-left: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .alternative {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

// Runs `act` with the readiness answer whenever it changes, after the render
// that showed it, so loading the lists or opening the secure window is never
// part of a render.
class OnReadiness extends Modifier<{
  Args: {
    Positional: [readiness: string | undefined, act: (r: string) => void];
  };
}> {
  last: string | undefined;
  modify(
    _element: Element,
    [readiness, act]: [string | undefined, (r: string) => void],
  ) {
    if (readiness === undefined || readiness === this.last) {
      return;
    }
    this.last = readiness;
    Promise.resolve().then(() => act(readiness));
  }
}

class PRReviewWatcherIsolated extends Component<typeof PRReviewWatcher> {
  @tracked tab: Tab = 'review';
  @tracked loading = false;
  @tracked loadedAt: Date | undefined;
  @tracked waitingOnMe: WatchedPullRequest[] = [];
  @tracked mine: WatchedPullRequest[] = [];
  @tracked truncated = false;
  @tracked rejected = false;
  // A call refused for the key's limits, while the watcher waits it out.
  @tracked limited: string | undefined;
  @tracked problem: string | undefined;
  // GitHub's errors for what it left out of an answer it otherwise gave.
  @tracked partial: string | undefined;
  openedWindow = false;
  // Signing in leaves a connection that isn't approved for the watcher's
  // calls yet, and readiness reads the same until it is.
  // Remembered across visits in this browser, so a later visit before the
  // calls are approved opens the approve page instead of signing in again.
  @tracked signedIn = signInStarted(this.args.model.id ?? '');
  // What each search found, as GitHub answered it, between full walks.
  held: Record<SearchOperation, PullRequestNode[]> = {
    waitingOnMyReview: [],
    myPullRequests: [],
  };
  walkedAt = 0;
  // The GitHub login the key belongs to.
  @tracked viewer = '';
  // Calls wait until then after a refusal for the key's limits.
  pausedUntil = 0;
  poller: ReturnType<typeof setInterval> | undefined;

  willDestroy() {
    super.willDestroy();
    this.stopPolling();
  }

  // Polls from the first load until the component is torn down. A tick does
  // nothing while the browser tab is hidden, while a load is still running,
  // while GitHub is rejecting the key, before the time a limit refusal named,
  // or while readiness isn't ready; reading readiness here also asks it
  // again, so a refilled limit or a replaced key picks polling back up.
  startPolling() {
    if (this.poller) {
      return;
    }
    this.poller = setInterval(() => {
      if (
        document.visibilityState === 'hidden' ||
        this.loading ||
        this.rejected ||
        Date.now() < this.pausedUntil ||
        this.readiness !== 'ready'
      ) {
        return;
      }
      this.load();
    }, POLL_EVERY_MS);
  }

  stopPolling() {
    clearInterval(this.poller);
    this.poller = undefined;
  }

  get record(): PRReviewWatcher {
    return this.args.model as PRReviewWatcher;
  }

  get readiness() {
    return this.args.context?.keyReadiness?.('waitingOnMyReview', this.record);
  }

  installApp = INSTALL_GITHUB_APP;
  mostShown = (MOST_PAGES * 100).toLocaleString();

  get loadedAtTime() {
    return this.loadedAt?.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  get tabs() {
    return [
      {
        value: 'review',
        label: `Waiting on my review (${this.waitingOnMe.length})`,
      },
      { value: 'mine', label: `My PRs (${this.mine.length})` },
    ];
  }

  @tracked sortBy: SortKey = 'requested';
  @tracked direction: SortDirection = 'asc';
  // Empty for every author or repository.
  @tracked authorFilter = '';
  @tracked repoFilter = '';

  // Every pull request is the viewer's own in "My PRs", so sorting or
  // filtering it by author would do nothing.
  get byAuthorApplies() {
    return this.tab === 'review';
  }

  get unfiltered() {
    return this.tab === 'review' ? this.waitingOnMe : this.mine;
  }

  get sortOptions() {
    return [
      { value: 'requested', label: 'Requested' },
      ...(this.byAuthorApplies ? [{ value: 'author', label: 'Author' }] : []),
      { value: 'repo', label: 'Repository' },
    ];
  }

  get activeSort(): SortKey {
    return this.sortBy === 'author' && !this.byAuthorApplies
      ? 'requested'
      : this.sortBy;
  }

  get directionOptions() {
    return this.activeSort === 'requested'
      ? [
          { value: 'asc', label: 'Oldest first' },
          { value: 'desc', label: 'Newest first' },
        ]
      : [
          { value: 'asc', label: 'A to Z' },
          { value: 'desc', label: 'Z to A' },
        ];
  }

  get authorOptions() {
    return [
      { value: '', label: 'All authors' },
      ...choicesOf(this.unfiltered, 'author').map((a) => ({
        value: a,
        label: a,
      })),
    ];
  }

  get repoOptions() {
    return [
      { value: '', label: 'All repositories' },
      ...choicesOf(this.unfiltered, 'repo').map((r) => ({
        value: r,
        label: r,
      })),
    ];
  }

  // A filter whose value isn't in this list (the other tab's author, or one
  // whose last pull request closed) filters nothing.
  get activeAuthor() {
    return this.byAuthorApplies &&
      choicesOf(this.unfiltered, 'author').includes(this.authorFilter)
      ? this.authorFilter
      : '';
  }

  get activeRepo() {
    return choicesOf(this.unfiltered, 'repo').includes(this.repoFilter)
      ? this.repoFilter
      : '';
  }

  get filtering() {
    return Boolean(this.activeAuthor || this.activeRepo);
  }

  get shown() {
    return arrange(this.unfiltered, {
      sortBy: this.activeSort,
      direction: this.direction,
      author: this.activeAuthor || undefined,
      repo: this.activeRepo || undefined,
    });
  }

  selectSort = (value: string) => {
    this.sortBy = value as SortKey;
  };
  selectDirection = (value: string) => {
    this.direction = value as SortDirection;
  };
  selectAuthor = (value: string) => {
    this.authorFilter = value;
  };
  selectRepo = (value: string) => {
    this.repoFilter = value;
  };
  clearFilters = () => {
    this.authorFilter = '';
    this.repoFilter = '';
  };

  selectTab = (value: string) => {
    this.tab = value as Tab;
  };

  // The lists load when the watcher opens with its key ready, and again
  // whenever readiness comes back to ready, such as after the key is
  // replaced. Opened with nothing to send yet, the watcher opens the secure
  // window once, on the page that fixes it: signing in to GitHub when the
  // person has no key for it, approving the watcher's requests when they
  // have one.
  readinessChanged = (readiness: string) => {
    if (readiness === 'ready') {
      if (!this.loading) {
        this.load();
      }
      return;
    }
    if (this.openedWindow) {
      return;
    } else if (readiness === 'needs-connect' && !this.signedIn) {
      this.openedWindow = true;
      this.signIn();
    } else if (
      readiness === 'needs-connect' ||
      readiness === 'needs-approval'
    ) {
      this.openedWindow = true;
      this.openWindow('approve');
    }
  };

  load = async () => {
    this.loading = true;
    this.problem = undefined;
    try {
      let walk = Date.now() - this.walkedAt >= WALK_EVERY_MS;
      let [review, authored] = await Promise.all([
        this.search('waitingOnMyReview', walk),
        this.search('myPullRequests', walk),
      ]);
      let failed = [review, authored].find((r) => r.failure);
      if (failed) {
        this.problem = failed.failure;
        return;
      }
      if (walk) {
        this.walkedAt = Date.now();
      }
      let viewer = review.viewer;
      this.viewer = viewer;
      let team = this.record.teamSlug ?? '';
      this.waitingOnMe = waitingOnReviewBy(
        this.held.waitingOnMyReview,
        viewer,
        team,
      );
      this.mine = authoredBy(this.held.myPullRequests, viewer);
      this.truncated = review.truncated || authored.truncated;
      this.partial = describeLeftOut([...review.errors, ...authored.errors]);
      this.rejected = false;
      this.limited = undefined;
      this.loadedAt = new Date();
      this.startPolling();
    } catch (err) {
      if (
        err instanceof OperationsError &&
        err.code === 'credential-rejected'
      ) {
        // Polls skip from here: calling again only collects the same refusal
        // until the key is replaced or GitHub accepts it again. Try again,
        // or readiness coming back to ready, loads again and clears it.
        this.rejected = true;
        return;
      }
      if (
        err instanceof OperationsError &&
        (err.code === 'rate-limited' ||
          err.code === 'over-budget' ||
          err.code === 'rate-limit-unavailable')
      ) {
        // Keep the last lists and wait as long as the refusal says.
        this.pausedUntil = Date.now() + (err.retryAfterSeconds ?? 60) * 1000;
        this.limited = err.code;
        return;
      }
      this.problem =
        err instanceof OperationsError
          ? (err.detail ?? err.message)
          : String(err);
    } finally {
      this.loading = false;
    }
  };

  // One search, as GitHub answers it, into `held`: every page when `walk`,
  // otherwise its first page merged into what is held.
  search = async (
    name: SearchOperation,
    walk: boolean,
  ): Promise<{
    viewer: string;
    errors: { message: string }[];
    truncated: boolean;
    failure?: string;
  }> => {
    let ops = operations<typeof PRReviewWatcher>(this.record);
    let nodes: PullRequestNode[] = [];
    let errors: { message: string }[] = [];
    let viewer = '';
    let after: string | undefined;
    for (let page = 1; ; page++) {
      // The first page sends no cursor, which GitHub reads as the start.
      let call = ops[name] as (payload: { after?: string }) => Promise<unknown>;
      let answer = (await call(after ? { after } : {})) as SearchAnswer;
      if (answer.status !== 200 || !answer.pullRequests) {
        return {
          viewer,
          errors,
          truncated: false,
          failure: answer.errors?.length
            ? `GitHub answered: ${answer.errors.map((e) => e.message).join('; ')}`
            : `GitHub answered ${answer.status}`,
        };
      }
      viewer = answer.viewer ?? viewer;
      errors.push(...(answer.errors ?? []));
      nodes.push(
        ...answer.pullRequests.filter(
          (n): n is PullRequestNode => 'number' in n,
        ),
      );
      let more = Boolean(answer.more && answer.cursor);
      if (!walk) {
        this.held[name] = mergeFirstPage(this.held[name], nodes, !more);
        return { viewer, errors, truncated: false };
      }
      if (!more || page === MOST_PAGES) {
        this.held[name] = nodes;
        return { viewer, errors, truncated: more };
      }
      after = answer.cursor!;
    }
  };

  // The secure window approves every operation on the card in one
  // confirmation, so it is opened for the one the card is blocked on.
  openWindow = async (
    mode: 'connect' | 'approve' | 'review-changes' | 'replace-key',
  ) => {
    let toolContext = this.args.context?.toolContext;
    if (!toolContext || !this.record.id) {
      return;
    }
    try {
      await new OpenSecureWindowTool(toolContext).execute({
        mode,
        cardId: this.record.id,
        operation: 'waitingOnMyReview',
        reason: mode === 'connect' ? SIGN_IN_REASON : TOKEN_REASON,
      });
    } catch (e) {
      this.problem = e instanceof Error ? e.message : String(e);
    }
  };
  signIn = () => {
    this.signedIn = true;
    if (this.record.id) {
      rememberSignIn(this.record.id);
    }
    this.openWindow('connect');
  };
  // The approve page's key choice adds a pasted key as well as choosing one.
  allow = () => this.openWindow('approve');
  review = () => this.openWindow('review-changes');
  replace = () => this.openWindow('replace-key');

  <template>
    <article
      class='watcher'
      {{OnReadiness this.readiness this.readinessChanged}}
      data-test-pr-review-watcher
    >
      <header class='top'>
        <div>
          <h1><@fields.cardTitle /></h1>
          <p class='scope'>
            Open pull requests across
            <strong>{{@model.org}}</strong>, with review requested from you or
            <strong>{{@model.teamSlug}}</strong>.
          </p>
        </div>
        {{#if (eq this.readiness 'ready')}}
          <div class='refresh'>
            {{#if this.loadedAt}}
              <span class='loaded'>
                Updated at
                {{this.loadedAtTime}}, every minute while open
              </span>
            {{/if}}
            {{#if this.loading}}<Spinner @size='xs' />{{/if}}
          </div>
        {{/if}}
      </header>

      {{#if (and (eq this.readiness 'needs-connect') this.signedIn)}}
        <Alert
          @tone='info'
          @title='Allow the watcher to use your GitHub sign-in'
          data-test-needs-approval
        >
          <:default>
            Once you've signed in to GitHub, allow the watcher's two calls to
            send your sign-in when you open the card. Choose
            <strong>On a schedule and when the card is opened</strong>
            in Boxel's secure window.
          </:default>
          <:action>
            <Button
              @tone='primary'
              {{on 'click' this.allow}}
              data-test-allow
            >Allow</Button>
            <Button
              @appearance='outlined'
              {{on 'click' this.signIn}}
              data-test-sign-in
            >Sign in again</Button>
          </:action>
        </Alert>
      {{else if (eq this.readiness 'needs-connect')}}
        <Alert
          @tone='info'
          @title='Sign in to GitHub to see your pull requests'
          data-test-needs-key
        >
          <:default>
            The watcher reads pull requests as you, with your own GitHub
            account, so it lists exactly what you can see on GitHub. You sign in
            on GitHub's own page, through Boxel's read-only GitHub app; nothing
            is ever typed into this card. For
            {{@model.org}}'s private repositories, the app has to be
            <a
              class='inline-link'
              href={{this.installApp}}
              target='_blank'
              rel='noopener noreferrer'
            >
              installed on
              {{@model.org}}</a>
            once, by one of its owners.
          </:default>
          <:action>
            <Button
              @tone='primary'
              {{on 'click' this.signIn}}
              data-test-sign-in
            >Sign in with GitHub</Button>
            <Button
              @appearance='outlined'
              {{on 'click' this.allow}}
              data-test-use-token
            >Use a token instead</Button>
          </:action>
        </Alert>
        <TokenGuide @org={{@model.org}} />
      {{else if (eq this.readiness 'needs-approval')}}
        <Alert
          @tone='info'
          @title='Allow the watcher to use your GitHub key'
          data-test-needs-approval
        >
          <:default>
            You have a GitHub key in Boxel. Allow the watcher's two requests to
            send it, when you open the card, in Boxel's secure window.
          </:default>
          <:action>
            <Button
              @tone='primary'
              {{on 'click' this.allow}}
              data-test-allow
            >Allow</Button>
          </:action>
        </Alert>
      {{else if (eq this.readiness 'needs-reapproval')}}
        <Alert @tone='warning' @title='The watcher changed what it sends'>
          <:default>
            Review the changed requests before it sends your token again.
          </:default>
          <:action>
            <Button {{on 'click' this.review}}>Review changes</Button>
          </:action>
        </Alert>
      {{else if (eq this.readiness 'needs-sign-in')}}
        <Alert @tone='info' @title='Sign in to see your pull requests' />
      {{else if
        (or (eq this.readiness 'rate-limited') (eq this.limited 'rate-limited'))
      }}
        <Alert @tone='warning' @title='Paused for a moment'>
          Your GitHub key has made as many calls as its limit allows for now.
          The watcher tries again shortly; the lists below are the last ones
          loaded.
        </Alert>
      {{else if (eq this.limited 'rate-limit-unavailable')}}
        <Alert @tone='warning' @title='Boxel could not count this call'>
          So it wasn't sent. The watcher tries again in a minute.
        </Alert>
      {{else if
        (or (eq this.readiness 'over-budget') (eq this.limited 'over-budget'))
      }}
        <Alert @tone='warning' @title='Your limit for GitHub is reached'>
          The lists below are the last ones loaded.
        </Alert>
      {{/if}}

      {{#if (or this.rejected (eq this.readiness 'credential-rejected'))}}
        <Alert
          @tone='danger'
          @title='GitHub rejected your key'
          data-test-credential-rejected
        >
          <:default>
            The token may have expired or been revoked, or your sign-in was
            revoked on GitHub. Replace it, or try again if you fixed it on
            GitHub.
          </:default>
          <:action>
            <Button
              @tone='primary'
              {{on 'click' this.replace}}
              data-test-replace-key
            >Replace key</Button>
            <Button
              @appearance='outlined'
              {{on 'click' this.load}}
              data-test-try-again
            >Try again</Button>
          </:action>
        </Alert>
        <TokenGuide @org={{@model.org}} />
      {{/if}}

      {{#if this.problem}}
        <Alert @tone='danger' @title='Could not load the lists'>
          {{this.problem}}
        </Alert>
      {{/if}}

      {{#if this.loadedAt}}
        <Tabs
          @options={{this.tabs}}
          @value={{this.tab}}
          @onValueChange={{this.selectTab}}
        >
          {{#if this.partial}}
            <Alert @tone='warning' @title='GitHub left some pull requests out'>
              {{this.partial}}
            </Alert>
          {{/if}}
          {{#if this.unfiltered.length}}
            <div
              class='arrange'
              role='toolbar'
              aria-label='Sort and filter'
              data-test-arrange
            >
              <SegmentedControl
                @label='Sort by'
                @options={{this.sortOptions}}
                @value={{this.activeSort}}
                @onValueChange={{this.selectSort}}
                data-test-sort
              />
              <SegmentedControl
                @label='Order'
                @options={{this.directionOptions}}
                @value={{this.direction}}
                @onValueChange={{this.selectDirection}}
                data-test-direction
              />
              {{#if this.byAuthorApplies}}
                <div class='filter'><NativeSelect
                    @label='Author'
                    @size='s'
                    @options={{this.authorOptions}}
                    @value={{this.activeAuthor}}
                    @onValueChange={{this.selectAuthor}}
                    data-test-author-filter
                  /></div>
              {{/if}}
              <div class='filter'><NativeSelect
                  @label='Repository'
                  @size='s'
                  @options={{this.repoOptions}}
                  @value={{this.activeRepo}}
                  @onValueChange={{this.selectRepo}}
                  data-test-repo-filter
                /></div>
            </div>
          {{/if}}
          {{#if this.truncated}}
            <p class='note'>Showing the
              {{this.mostShown}}
              most recently updated pull requests of a search that found more.</p>
          {{/if}}
          {{#if this.shown.length}}
            <ul class='prs' data-test-list={{this.tab}}>
              {{#each this.shown as |pr|}}
                <li class='pr' data-test-pr='{{pr.repo}}#{{pr.number}}'>
                  <div class='pr-head'>
                    <span class='ref'>{{pr.repo}}#{{pr.number}}</span>
                    {{#if pr.isDraft}}
                      <Chip @label='Draft' @dot={{false}} data-test-draft />
                    {{/if}}
                  </div>
                  <a
                    class='title'
                    href={{pr.url}}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    {{pr.title}}
                  </a>
                  <div class='facts'>
                    {{#if (eq this.tab 'review')}}
                      <span>by {{pr.author}}</span>
                    {{/if}}
                    {{#if pr.approvedBy.length}}
                      <Chip @tone='success' data-test-approved>
                        Approved by
                        {{join pr.approvedBy}}
                      </Chip>
                    {{else if pr.requested}}
                      <span data-test-waiting>
                        Review requested
                        <RelativeTime
                          @date={{pr.requested.at}}
                          @now={{this.loadedAt}}
                        />
                        {{#if (eq this.tab 'review')}}
                          from
                          {{if
                            (eq pr.requested.from this.viewer)
                            'you'
                            pr.requested.from
                          }}
                        {{/if}}
                      </span>
                    {{else}}
                      <span class='muted'>No review requested</span>
                    {{/if}}
                    {{#if pr.changesRequestedBy.length}}
                      <Chip @tone='danger' data-test-changes-requested>
                        Changes requested by
                        {{join pr.changesRequestedBy}}
                      </Chip>
                    {{/if}}
                    {{#if pr.comments}}
                      <Chip @dot={{false}} data-test-comments>
                        {{pr.comments}}
                        {{if (eq pr.comments 1) 'comment' 'comments'}}
                      </Chip>
                    {{else}}
                      <span class='muted'>No comments</span>
                    {{/if}}
                  </div>
                </li>
              {{/each}}
            </ul>
          {{else if this.filtering}}
            <EmptyState
              @title='No pull requests match'
              @message='Nothing in this list matches the author and repository chosen.'
              data-test-empty='filtered'
            >
              <:action>
                <Button
                  @appearance='outlined'
                  {{on 'click' this.clearFilters}}
                  data-test-clear-filters
                >Show all</Button>
              </:action>
            </EmptyState>
          {{else if (eq this.tab 'review')}}
            <EmptyState
              @title='Nothing is waiting on your review'
              @message='A pull request shows here once review is requested from you or your team, and stays until it is approved, merged or closed.'
              data-test-empty='review'
            />
          {{else}}
            <EmptyState
              @title='You have no open pull requests'
              @message='Your open pull requests, drafts included, show here with how long each has waited for review.'
              data-test-empty='mine'
            />
          {{/if}}
        </Tabs>
      {{else if this.loading}}
        <div class='loading'><Spinner /> Loading pull requests…</div>
      {{/if}}
    </article>
    <style scoped>
      .watcher {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        container-type: inline-size;
        height: 100%;
        overflow-y: auto;
      }
      .top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
      }
      .scope,
      .note,
      .loaded,
      .muted {
        color: var(--muted-foreground);
      }
      .scope {
        margin: var(--boxel-sp-4xs) 0 0;
      }
      .note {
        font-size: var(--boxel-font-size-xs);
      }
      .refresh {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .arrange {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .filter {
        width: 11rem;
      }
      .prs {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .pr {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-sm) 0;
        border-bottom: 1px solid var(--border);
      }
      .pr-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .ref {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .title {
        color: var(--foreground);
        font-weight: 600;
        text-decoration: none;
      }
      .inline-link {
        color: inherit;
        text-decoration: underline;
      }
      .title:hover {
        text-decoration: underline;
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
      }
      .loading {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

// GitHub reports one error for every part of an answer it held back, so the
// same message can come back dozens of times. Each is said once, with how
// often, and the one an app sees without permission to read the
// organization's teams says what to do about it.
function describeLeftOut(errors: { message: string }[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  let counts = new Map<string, number>();
  for (let { message } of errors) {
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts]
    .map(([message, count]) => {
      let times = count > 1 ? ` (${count} times)` : '';
      return message === 'Resource not accessible by integration'
        ? `GitHub hid some review requests from a team${times}. The GitHub app needs read access to the organization's members to show which team was asked.`
        : `${message}${times}`;
    })
    .join(' ');
}

function join(names: string[]) {
  return names.join(', ');
}

function or(a: unknown, b: unknown) {
  return Boolean(a || b);
}

export class PRReviewWatcher extends CardDef {
  static displayName = 'PR Review Watcher';

  // The GitHub organization whose repositories are searched.
  @field org = contains(StringField);
  // The team whose review requests count as yours, by its slug in `org`.
  @field team = contains(StringField);

  @field teamSlug = contains(StringField, {
    computeVia: function (this: PRReviewWatcher) {
      return this.org && this.team ? `${this.org}/${this.team}` : undefined;
    },
  });
  // Every open pull request in the organization by someone else. Which of
  // them asked for your review is read from each one's history, because
  // GitHub stops listing a team as a requested reviewer once any member of it
  // reviews, which a `team-review-requested:` search would miss.
  @field reviewSearch = contains(StringField, {
    computeVia: function (this: PRReviewWatcher) {
      return `is:pr is:open archived:false org:${this.org} -author:@me sort:updated-desc`;
    },
  });
  @field authoredSearch = contains(StringField, {
    computeVia: function (this: PRReviewWatcher) {
      return `is:pr is:open archived:false org:${this.org} author:@me sort:updated-desc`;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PRReviewWatcher) {
      return this.cardInfo?.name?.trim() || 'PR Review Watcher';
    },
  });

  @operation static waitingOnMyReview = {
    base: 'callApi',
    params: { after: StringField },
    label:
      "List others' open pull requests in your organization, with their reviews",
    url: GITHUB_GRAPHQL,
    headers: AUTH,
    graphql: {
      document: SEARCH_PULL_REQUESTS,
      variables: { q: instance('reviewSearch'), after: params('after') },
    },
    output: ANSWER,
  } satisfies OperationDeclaration;

  @operation static myPullRequests = {
    base: 'callApi',
    params: { after: StringField },
    label:
      'List your open pull requests in your organization, with their reviews',
    url: GITHUB_GRAPHQL,
    headers: AUTH,
    graphql: {
      document: SEARCH_PULL_REQUESTS,
      variables: { q: instance('authoredSearch'), after: params('after') },
    },
    output: ANSWER,
  } satisfies OperationDeclaration;

  static isolated = PRReviewWatcherIsolated;
}
