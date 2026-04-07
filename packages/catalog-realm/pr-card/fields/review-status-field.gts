import {
  FieldDef,
  Component,
  StringField,
  field,
  contains,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import type { GithubEventCard } from '../../github-event/github-event';

import {
  renderPrActionLabel,
  buildCiItems,
  buildLatestReviewByReviewer,
  computeLatestReviewState,
  buildGithubEventCardRef,
  searchEventQuery,
  buildRealmHrefs,
} from '../utils';

export class PrReviewStatusField extends FieldDef {
  static displayName = 'PR Review Status';
  @field branchName = contains(StringField);

  static embedded = class Embedded extends Component<typeof PrReviewStatusField> {
    get realmHrefs() {
      return buildRealmHrefs(this.args.model[realmURL]?.href);
    }

    get githubEventCardRef() {
      return buildGithubEventCardRef(
        // @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
        import.meta.url,
        '../../github-event/github-event',
      );
    }

    // ── Queries ──
    get pullRequestEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.args.model.branchName,
        'pull_request',
      );
    }

    get checkRunEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.args.model.branchName,
        'check_run',
      );
    }

    get checkSuiteEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.args.model.branchName,
        'check_suite',
      );
    }

    get prReviewEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.args.model.branchName,
        'pull_request_review',
      );
    }

    // ── Live queries ──
    prEventData = this.args.context?.getCards(
      this,
      () => this.pullRequestEventQuery,
      () => this.realmHrefs,
      { isLive: true },
    );

    checkRunEventData = this.args.context?.getCards(
      this,
      () => this.checkRunEventQuery,
      () => this.realmHrefs,
      { isLive: true },
    );

    checkSuiteEventData = this.args.context?.getCards(
      this,
      () => this.checkSuiteEventQuery,
      () => this.realmHrefs,
      { isLive: true },
    );

    prReviewEventData = this.args.context?.getCards(
      this,
      () => this.prReviewEventQuery,
      () => this.realmHrefs,
      { isLive: true },
    );

    // ── PR state ──
    get latestPrEvent(): GithubEventCard | null {
      return (this.prEventData?.instances[0] as GithubEventCard) ?? null;
    }

    get latestPrActionLabel() {
      let event = this.latestPrEvent;
      return renderPrActionLabel(
        event?.action,
        event?.payload?.pull_request?.merged,
      );
    }

    get isClosed() {
      let label = this.latestPrActionLabel;
      return label === 'Closed' || label === 'Merged';
    }

    // ── CI (for merge blocked check) ──
    get ciItems() {
      return buildCiItems(
        this.checkRunEventData?.instances ?? [],
        this.checkSuiteEventData?.instances ?? [],
      );
    }

    // ── Review ──
    get latestReviewByReviewer() {
      return buildLatestReviewByReviewer(this.prReviewEventData?.instances ?? []);
    }

    get latestReviewState() {
      return computeLatestReviewState(this.latestReviewByReviewer);
    }

    // ── Mergeability ──
    get isMergeBlocked() {
      if (this.isClosed) return false;
      if (this.latestPrActionLabel === 'Draft') return true;
      if (this.ciItems.some((i) => i.state === 'failure')) return true;
      if (this.ciItems.some((i) => i.state === 'in_progress')) return true;
      if (this.latestReviewState !== 'approved') return true;
      return false;
    }

    <template>
      {{#if (eq this.latestReviewState 'changes_requested')}}
        <div class='review-status-row review-status-row--changes'>
          <span class='review-status-label'>Changes Requested</span>
          {{#if this.isMergeBlocked}}
            <Pill class='merge-blocked-pill' @pillBackgroundColor='#d73a49'>
              <:default><span class='merge-blocked-label'>Merge blocked</span></:default>
            </Pill>
          {{/if}}
        </div>
      {{else if (eq this.latestReviewState 'approved')}}
        <div class='review-status-row review-status-row--approved'>
          <span class='review-status-label'>Approved</span>
          {{#if this.isMergeBlocked}}
            <Pill class='merge-blocked-pill' @pillBackgroundColor='#d73a49'>
              <:default><span class='merge-blocked-label'>Merge blocked</span></:default>
            </Pill>
          {{/if}}
        </div>
      {{else}}
        <div class='review-status-row review-status-row--pending'>
          <span class='review-status-label'>Pending Review</span>
          {{#if this.isMergeBlocked}}
            <Pill class='merge-blocked-pill' @pillBackgroundColor='#d73a49'>
              <:default><span class='merge-blocked-label'>Merge blocked</span></:default>
            </Pill>
          {{/if}}
        </div>
      {{/if}}

      <style scoped>
        .review-status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
        }
        .review-status-row--changes {
          background: color-mix(
            in srgb,
            var(--destructive, #d73a49) 5%,
            var(--card, #ffffff)
          );
        }
        .review-status-row--approved {
          background: color-mix(
            in srgb,
            var(--chart-1, #28a745) 5%,
            var(--card, #ffffff)
          );
        }
        .review-status-row--pending {
          background: color-mix(in srgb, #9a6700 8%, var(--card, #ffffff));
        }
        .review-status-label {
          font-size: var(--boxel-font-sm);
          font-weight: 600;
        }
        .review-status-row--changes .review-status-label {
          color: var(--destructive, #d73a49);
        }
        .review-status-row--pending .review-status-label {
          color: #9a6700;
        }
        .review-status-row--approved .review-status-label {
          color: var(--chart-1, #28a745);
        }
        .merge-blocked-pill {
          --boxel-pill-border-radius: 2em;
        }
        .merge-blocked-label {
          font-size: 10px;
          font-weight: 600;
          color: #fff;
          text-align: center;
        }
      </style>
    </template>
  };
}
