import {
  FieldDef,
  Component,
  StringField,
  field,
  contains,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import {
  buildCiItems,
  buildGithubEventCardRef,
  searchEventQuery,
  buildRealmHrefs,
  pluralize,
} from '../utils';

export class PrCiStatusField extends FieldDef {
  static displayName = 'PR CI Status';
  @field branchName = contains(StringField);

  static embedded = class Embedded extends Component<typeof PrCiStatusField> {
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

    get ciItems() {
      return buildCiItems(
        this.checkRunEventData?.instances ?? [],
        this.checkSuiteEventData?.instances ?? [],
      );
    }

    get ciFailedCount() {
      return this.ciItems.filter((i) => i.state === 'failure').length;
    }

    get ciSuccessCount() {
      return this.ciItems.filter((i) => i.state === 'success').length;
    }

    get ciInProgressCount() {
      return this.ciItems.filter((i) => i.state === 'in_progress').length;
    }

    get ciTotalCount() {
      return this.ciItems.length;
    }

    get isLoading() {
      return (
        this.checkRunEventData?.isLoading ||
        this.checkSuiteEventData?.isLoading
      ) ?? false;
    }

    get ciHeadline() {
      if (this.ciTotalCount === 0) return null;
      if (this.ciFailedCount > 0) return 'Some checks were not successful';
      if (this.ciInProgressCount > 0) return 'Some checks are in progress';
      return 'All checks have passed';
    }

    get ciSubtitle() {
      if (this.ciTotalCount === 0) return null;
      let parts: string[] = [];
      if (this.ciFailedCount > 0) parts.push(`${this.ciFailedCount} failing`);
      if (this.ciInProgressCount > 0)
        parts.push(`${this.ciInProgressCount} in progress`);
      if (this.ciSuccessCount > 0)
        parts.push(`${this.ciSuccessCount} successful`);
      let suffix = pluralize(this.ciTotalCount, 'check', 'checks');
      return `${parts.join(', ')} ${suffix}`;
    }

    get ciDonutStyle() {
      let success = this.ciSuccessCount;
      let failed = this.ciFailedCount;
      let total = this.ciTotalCount;
      if (total === 0) return 'background: var(--muted-foreground, #656d76)';
      let successPct = (success / total) * 100;
      let failedPct = (failed / total) * 100;
      let s1 = successPct;
      let s2 = s1 + failedPct;
      return `background: conic-gradient(var(--chart-1, #28a745) 0% ${s1}%, var(--destructive, #d73a49) ${s1}% ${s2}%, var(--chart-4, #dbab09) ${s2}% 100%)`;
    }

    <template>
      {{#if this.ciHeadline}}
        <div class='ci-status-row'>
          <span class='ci-donut' style={{this.ciDonutStyle}}>
            <span class='ci-donut-hole'></span>
          </span>
          <div class='ci-status-text'>
            <span class='ci-headline'>{{this.ciHeadline}}</span>
            <span class='ci-subtitle'>{{this.ciSubtitle}}</span>
          </div>
        </div>
      {{else if this.isLoading}}
        <div class='ci-status-row ci-status-loading'>
          <span class='ci-donut ci-donut-loading'>
            <span class='ci-donut-hole'></span>
          </span>
          <div class='ci-status-text'>
            <span class='ci-headline'>Loading CI checks...</span>
          </div>
        </div>
      {{/if}}

      <style scoped>
        .ci-status-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          background: var(--card, #ffffff);
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
          min-width: 0;
        }
        .ci-donut {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ci-donut-hole {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--card, #ffffff);
        }
        .ci-status-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .ci-headline {
          font-size: var(--boxel-font-sm);
          font-weight: 600;
          color: var(--foreground, #1f2328);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ci-subtitle {
          font-size: var(--boxel-font-xs);
          color: var(--muted-foreground, #656d76);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ci-donut-loading {
          background: var(--muted-foreground, #656d76);
          animation: ci-donut-pulse 1.2s ease-in-out infinite;
        }
        .ci-status-loading .ci-headline {
          color: var(--muted-foreground, #656d76);
        }
        @keyframes ci-donut-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      </style>
    </template>
  };
}
