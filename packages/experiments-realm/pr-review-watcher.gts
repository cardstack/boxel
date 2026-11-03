import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import Modifier from 'ember-modifier';

import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  bxl,
  instance,
  operation,
  operations,
  OperationsError,
  type OperationDeclaration,
} from '@cardstack/base/operations';
import OpenSecureWindowTool from '@cardstack/boxel-host/tools/open-secure-window';

import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { EmptyState } from '@cardstack/pretui/components/empty-state';
import { RelativeTime } from '@cardstack/pretui/components/relative-time';
import { Spinner } from '@cardstack/pretui/components/spinner';
import { Tabs } from '@cardstack/pretui/components/tabs';
import { eq } from '@cardstack/pretui/helpers';

import {
  authoredBy,
  waitingOnReviewBy,
  type PullRequestNode,
  type WatchedPullRequest,
} from './pr-review-watcher/review-state';

// One GraphQL request answers a whole list: the pull requests a search finds,
// each with its review requests, reviews and comments. The two operations
// differ only in the search, so both carry this same document.
const SEARCH_PULL_REQUESTS = `query($q: String!) {
  viewer { login }
  search(type: ISSUE, query: $q, first: 100) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        createdAt
        repository { nameWithOwner }
        author { __typename login }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 50) {
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
const ANSWER = bxl`{status: .status, viewer: .body.data.viewer.login, total: .body.data.search.issueCount, pullRequests: .body.data.search.nodes, errors: .body.errors}`;

// What a person needs to give the card, said where it asks for the key.
const TOKEN_ADVICE =
  'a GitHub token that can read the private repositories and teams in your organization: a classic token with the repo and read:org scopes, or a fine-grained token for the organization (which the organization has to approve) with read access to pull requests and members';

interface SearchAnswer {
  status: number;
  viewer: string | null;
  total: number | null;
  pullRequests: (PullRequestNode | Record<string, never>)[] | null;
  errors: { message: string }[] | null;
}

type Tab = 'review' | 'mine';

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
  @tracked problem: string | undefined;
  // GitHub's errors for what it left out of an answer it otherwise gave.
  @tracked partial: string | undefined;
  openedWindow = false;
  tokenAdvice = TOKEN_ADVICE;

  get record(): PRReviewWatcher {
    return this.args.model as PRReviewWatcher;
  }

  get readiness() {
    return this.args.context?.keyReadiness?.('waitingOnMyReview', this.record);
  }

  get blockedOnKey() {
    return (
      this.readiness === 'needs-connect' || this.readiness === 'needs-approval'
    );
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

  get shown() {
    return this.tab === 'review' ? this.waitingOnMe : this.mine;
  }

  selectTab = (value: string) => {
    this.tab = value as Tab;
  };

  // The lists load when the watcher opens with its key ready, and again
  // whenever readiness comes back to ready, such as after the token is
  // replaced. With no key to send yet, the secure window opens once.
  readinessChanged = (readiness: string) => {
    if (readiness === 'ready' && !this.loading) {
      this.load();
    } else if (
      (readiness === 'needs-connect' || readiness === 'needs-approval') &&
      !this.openedWindow
    ) {
      this.openedWindow = true;
      this.openWindow('approve');
    }
  };

  load = async () => {
    this.loading = true;
    this.problem = undefined;
    try {
      let ops = operations<typeof PRReviewWatcher>(this.record);
      let [review, authored] = (await Promise.all([
        ops.waitingOnMyReview(),
        ops.myPullRequests(),
      ])) as [SearchAnswer, SearchAnswer];
      let failed = [review, authored].find(
        (a) => a.status !== 200 || !a.pullRequests,
      );
      if (failed) {
        this.problem = failed.errors?.length
          ? `GitHub answered: ${failed.errors.map((e) => e.message).join('; ')}`
          : `GitHub answered ${failed.status}`;
        return;
      }
      let viewer = review.viewer ?? '';
      let team = this.record.teamSlug ?? '';
      let nodesOf = (a: SearchAnswer) =>
        (a.pullRequests ?? []).filter(
          (n): n is PullRequestNode => 'number' in n,
        );
      this.waitingOnMe = waitingOnReviewBy(nodesOf(review), viewer, team);
      this.mine = authoredBy(nodesOf(authored), viewer);
      this.truncated = [review, authored].some(
        (a) => (a.total ?? 0) > (a.pullRequests?.length ?? 0),
      );
      let errors = [review, authored].flatMap((a) => a.errors ?? []);
      this.partial = errors.length
        ? errors.map((e) => e.message).join('; ')
        : undefined;
      this.rejected = false;
      this.loadedAt = new Date();
    } catch (err) {
      if (
        err instanceof OperationsError &&
        err.code === 'credential-rejected'
      ) {
        // Stop here: calling again only collects the same refusal until the
        // token is replaced or GitHub accepts it again.
        this.rejected = true;
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

  // The secure window approves every operation on the card in one
  // confirmation, so it is opened for the one the card is blocked on.
  openWindow = async (mode: 'approve' | 'review-changes' | 'replace-key') => {
    let toolContext = this.args.context?.toolContext;
    if (!toolContext || !this.record.id) {
      return;
    }
    try {
      await new OpenSecureWindowTool(toolContext).execute({
        mode,
        cardId: this.record.id,
        operation: 'waitingOnMyReview',
        reason:
          mode === 'replace-key'
            ? 'GitHub rejected your token. Replace it with ' + TOKEN_ADVICE
            : 'PR review watcher needs ' + TOKEN_ADVICE,
      });
    } catch (e) {
      this.problem = e instanceof Error ? e.message : String(e);
    }
  };
  connect = () => this.openWindow('approve');
  review = () => this.openWindow('review-changes');
  replace = () => this.openWindow('replace-key');

  <template>
    <article
      class='watcher'
      data-test-pr-review-watcher
      {{OnReadiness this.readiness this.readinessChanged}}
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
                Loaded
                <RelativeTime @date={{this.loadedAt}} @now={{this.loadedAt}} />
              </span>
            {{/if}}
            <Button
              @appearance='outlined'
              @size='s'
              @busy={{this.loading}}
              {{on 'click' this.load}}
              data-test-refresh
            >Refresh</Button>
          </div>
        {{/if}}
      </header>

      {{#if this.blockedOnKey}}
        <Alert
          @tone='info'
          @title='Connect your GitHub token'
          data-test-needs-key
        >
          <:default>
            The watcher lists pull requests as you, with
            {{this.tokenAdvice}}. You enter it in Boxel's secure window, never
            in this card.
          </:default>
          <:action>
            <Button
              @tone='primary'
              {{on 'click' this.connect}}
              data-test-connect
            >Connect GitHub</Button>
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
      {{else if (eq this.readiness 'rate-limited')}}
        <Alert @tone='warning' @title='Too many refreshes'>
          Try again in a moment. The lists below are the last ones loaded.
        </Alert>
      {{else if (eq this.readiness 'over-budget')}}
        <Alert @tone='warning' @title='Your limit for GitHub is reached'>
          The lists below are the last ones loaded.
        </Alert>
      {{/if}}

      {{#if (or this.rejected (eq this.readiness 'credential-rejected'))}}
        <Alert
          @tone='danger'
          @title='GitHub rejected your token'
          data-test-credential-rejected
        >
          <:default>
            It may have expired or been revoked. Replace it, or try again if you
            fixed it on GitHub.
          </:default>
          <:action>
            <Button
              @tone='primary'
              {{on 'click' this.replace}}
              data-test-replace-key
            >Replace token</Button>
            <Button
              @appearance='outlined'
              {{on 'click' this.load}}
              data-test-try-again
            >Try again</Button>
          </:action>
        </Alert>
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
        />
        {{#if this.partial}}
          <Alert @tone='warning' @title='GitHub left some pull requests out'>
            {{this.partial}}
          </Alert>
        {{/if}}
        {{#if this.truncated}}
          <p class='note'>Showing the 100 most recently updated of each search.</p>
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
                        {{pr.requested.from}}
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
      }
      .top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
      }
      h1 {
        margin: 0;
        font-size: var(--boxel-heading-font-size);
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
        margin: 0;
        font-size: var(--boxel-font-size-xs);
      }
      .refresh {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
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
        font-family: var(--font-mono, monospace);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .title {
        color: var(--foreground);
        font-weight: 600;
        text-decoration: none;
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
    label:
      "List your organization's open pull requests by others, with their review requests, reviews and comments",
    url: GITHUB_GRAPHQL,
    headers: AUTH,
    graphql: {
      document: SEARCH_PULL_REQUESTS,
      variables: { q: instance('reviewSearch') },
    },
    output: ANSWER,
  } satisfies OperationDeclaration;

  @operation static myPullRequests = {
    base: 'callApi',
    label:
      'List your open pull requests, with their review requests, reviews and comments',
    url: GITHUB_GRAPHQL,
    headers: AUTH,
    graphql: {
      document: SEARCH_PULL_REQUESTS,
      variables: { q: instance('authoredSearch') },
    },
    output: ANSWER,
  } satisfies OperationDeclaration;

  static isolated = PRReviewWatcherIsolated;
}
