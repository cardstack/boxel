import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  StringField,
  NumberField,
} from '@cardstack/base/card-api';
import StarIcon from '@cardstack/boxel-icons/star';
import { Plan } from './plan';
import { Service } from './service';

// Product Review — customer feedback on a Plan or Service, not on a
// specific purchase. Deliberately NOT rendered inside RevenueOs (an internal
// sales-ops console, not a public review surface) — instead self-hosted by
// consuming `plan.gts`/`service.gts`'s own isolated views, which is a real
// consumer without forcing the wrong UI into the wrong app.

export class ProductReview extends CardDef {
  static displayName = 'Product Review';
  static icon = StarIcon;

  @field rating = contains(NumberField);
  @field body = contains(StringField);
  @field plan = linksTo(Plan);
  @field service = linksTo(Service);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ProductReview) {
      let subject = this.plan?.cardTitle ?? this.service?.cardTitle;
      return subject
        ? `Review of ${subject}`
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof ProductReview> {
    <template>
      <span class='review-atom'>
        <StarIcon class='ra-icon' />
        <span class='ra-rating'>{{if @model.rating @model.rating '—'}}/5</span>
      </span>
      <style scoped>
        .review-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .ra-icon {
          width: 14px;
          height: 14px;
          color: #f59e0b;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ProductReview> {
    get stars() {
      let rating = this.args.model?.rating ?? 0;
      return [1, 2, 3, 4, 5].map((n) => ({ on: n <= rating }));
    }
    <template>
      <div class='review-row'>
        <div class='stars'>
          {{#each this.stars as |star|}}
            <StarIcon class='star {{if star.on "star-on"}}' />
          {{/each}}
        </div>
        {{#if @model.body}}
          <p class='body'>{{@model.body}}</p>
        {{/if}}
      </div>
      <style scoped>
        .review-row {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .stars {
          display: flex;
          gap: 0.125rem;
        }
        .star {
          width: 14px;
          height: 14px;
          color: var(--border, #e5e7eb);
        }
        .star-on {
          color: #f59e0b;
        }
        .body {
          margin: 0;
          color: var(--foreground, #111111);
          line-height: 1.5;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ProductReview> {
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <StarIcon class='doc-icon' />
          <span class='figure'>{{if @model.rating @model.rating '—'}}/5</span>
        </div>
        <div class='fmt strip'>
          <StarIcon class='doc-icon' />
          <span class='figure'>{{if @model.rating @model.rating '—'}}/5</span>
          {{#if @model.body}}
            <span class='meta'>{{@model.body}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          color: var(--foreground, #111111);
        }
        .fmt {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
          align-items: center;
          gap: 0.5rem;
        }
        .doc-icon {
          width: 18px;
          height: 18px;
          color: #f59e0b;
          flex-shrink: 0;
        }
        .figure {
          font-weight: 700;
          font-size: 0.875rem;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) {
          .strip {
            display: flex;
            padding: 0.625rem 0.75rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ProductReview> {
    get stars() {
      let rating = this.args.model?.rating ?? 0;
      return [1, 2, 3, 4, 5].map((n) => ({ on: n <= rating }));
    }
    <template>
      <article class='review-page'>
        <div class='stars-lg'>
          {{#each this.stars as |star|}}
            <StarIcon class='star {{if star.on "star-on"}}' />
          {{/each}}
        </div>
        {{#if @model.body}}
          <p class='body'>{{@model.body}}</p>
        {{/if}}
      </article>
      <style scoped>
        .review-page {
          max-width: 32rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
        }
        .stars-lg {
          display: flex;
          gap: 0.25rem;
          margin-bottom: 1rem;
        }
        .star {
          width: 22px;
          height: 22px;
          color: var(--border, #e5e7eb);
        }
        .star-on {
          color: #f59e0b;
        }
        .body {
          font-size: 1rem;
          line-height: 1.6;
        }
      </style>
    </template>
  };
}
