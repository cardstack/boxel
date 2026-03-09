import GlimmerComponent from '@glimmer/component';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import type { ReviewState } from '../../utils';

// ── Sub-components ──────────────────────────────────────────────────────

interface ReviewStateBadgeSignature {
  Args: { state: ReviewState };
}

class ReviewStateBadge extends GlimmerComponent<ReviewStateBadgeSignature> {
  get stateClass() {
    if (this.args.state === 'changes_requested')
      return 'review-state-badge--changes';
    if (this.args.state === 'approved') return 'review-state-badge--approved';
    return '';
  }

  get label() {
    if (this.args.state === 'changes_requested') return 'Changes Requested';
    if (this.args.state === 'approved') return 'Approved';
    return '';
  }

  get hasState() {
    return (
      this.args.state === 'changes_requested' || this.args.state === 'approved'
    );
  }

  <template>
    {{#if this.hasState}}
      <span class='review-state-badge {{this.stateClass}}'>{{this.label}}</span>
    {{/if}}

    <style scoped>
      .review-state-badge {
        display: inline-flex;
        align-self: center;
        font-size: 11px;
        font-weight: 600;
        border-radius: 2em;
        padding: 2px 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
      }
      .review-state-badge--changes {
        background: color-mix(
          in srgb,
          var(--destructive, #d73a49) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #d73a49);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #d73a49) 30%,
            var(--card, #ffffff)
          );
      }
      .review-state-badge--approved {
        background: color-mix(
          in srgb,
          var(--chart-1, #28a745) 10%,
          var(--card, #ffffff)
        );
        color: var(--chart-1, #28a745);
        border: 1px solid
          color-mix(in srgb, var(--chart-1, #28a745) 35%, var(--card, #ffffff));
      }
    </style>
  </template>
}

// ── Main Section ────────────────────────────────────────────────────────

interface ReviewSectionSignature {
  Args: {
    reviewState: ReviewState;
    reviewerName: string;
    comment: string;
    reviewUrl: string | undefined;
    hasReview: boolean;
  };
}

export class ReviewSection extends GlimmerComponent<ReviewSectionSignature> {
  get reviewItemStateClass() {
    if (this.args.reviewState === 'changes_requested') {
      return 'review-item--changes';
    }
    if (this.args.reviewState === 'approved') {
      return 'review-item--approved';
    }
    return '';
  }

  <template>
    <div class='review-section'>
      <div class='review-heading-row'>
        <h2 class='section-heading'>Reviews</h2>
        <ReviewStateBadge @state={{@reviewState}} />
      </div>

      {{#if @hasReview}}
        <ul class='review-list'>
          <li class='review-item {{this.reviewItemStateClass}}'>
            <div class='review-item-header'>
              <span class='review-author'>{{@reviewerName}}</span>
              {{#if @reviewUrl}}
                <a
                  href={{@reviewUrl}}
                  target='_blank'
                  rel='noopener noreferrer'
                  class='review-github-link'
                  title='View review on GitHub'
                  aria-label='View review on GitHub'
                >
                  <ExternalLinkIcon class='review-github-link-icon' />
                </a>
              {{/if}}
            </div>
            <blockquote class='review-comment'>{{@comment}}</blockquote>
          </li>
        </ul>
      {{else}}
        <div class='empty-state {{this.reviewItemStateClass}}'>
          <span class='empty-state-icon' aria-hidden='true'>
            <span class='empty-state-dot'></span>
          </span>
          <span class='empty-state-text'>-</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .review-section {
        flex: 1;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        overflow-y: auto;
      }
      .section-heading {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--foreground, #1f2328);
        margin: 0;
      }
      .review-heading-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .review-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .review-item {
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .review-item-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .review-author {
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        color: var(--foreground, #1f2328);
      }
      .review-github-link {
        margin-left: auto;
        color: var(--muted-foreground, #656d76);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: color 0.15s ease;
        flex-shrink: 0;
      }
      .review-github-link:hover {
        color: var(--primary, #0969da);
      }
      .review-github-link-icon {
        width: 13px;
        height: 13px;
      }
      .review-comment {
        margin-block: 0;
        margin-inline: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-sm);
        color: var(--card-foreground, #1f2328);
        border-left: 3px solid var(--border, var(--boxel-border-color));
        font-style: normal;
        line-height: 1.6;
        background: var(--card, #ffffff);
        border-radius: 0 var(--radius, 6px) var(--radius, 6px) 0;
        transition:
          border-left-color 0.15s ease,
          background 0.15s ease;
        cursor: default;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .review-comment:hover {
        border-left-color: var(--destructive, #d73a49);
        background: color-mix(
          in srgb,
          var(--destructive, #d73a49) 5%,
          var(--card, #ffffff)
        );
      }
      .empty-state {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
      }
      .empty-state-icon {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 2px solid var(--chart-4, #dbab09);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .empty-state-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--chart-4, #dbab09);
      }
      .empty-state-text {
        font-size: var(--boxel-font-xs);
        color: var(--muted-foreground, #656d76);
      }
      .review-item--changes {
        background: color-mix(
          in srgb,
          var(--destructive, #d73a49) 10%,
          var(--card, #ffffff)
        );
        border-color: color-mix(
          in srgb,
          var(--destructive, #d73a49) 30%,
          var(--card, #ffffff)
        );
      }
      .review-item--approved {
        background: color-mix(
          in srgb,
          var(--chart-1, #28a745) 10%,
          var(--card, #ffffff)
        );
        border-color: color-mix(
          in srgb,
          var(--chart-1, #28a745) 35%,
          var(--card, #ffffff)
        );
      }
    </style>
  </template>
}
