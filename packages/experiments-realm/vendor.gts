import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import UrlField from '@cardstack/base/url';
import EmailField from '@cardstack/base/email';
import BuildingIcon from '@cardstack/boxel-icons/building';

import { ScoreField } from './score-field';
import { DurationField } from './duration-field';

export class Vendor extends CardDef {
  static displayName = 'Vendor';
  static icon = BuildingIcon;

  @field name = contains(StringField);
  @field contactName = contains(StringField);
  @field email = contains(EmailField);
  @field website = contains(UrlField);
  @field serviceCategory = contains(StringField, {
    description: 'e.g. staffing agency, payroll, freelance design',
  });
  @field contractStart = contains(DateField);
  @field contractLength = contains(DurationField);
  @field performanceRating = contains(ScoreField);

  @field title = contains(StringField, {
    computeVia: function (this: Vendor) {
      return this.name?.trim() || 'Unnamed Vendor';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article
        class='vendor-isolated'
      >
        <div class='card-face'>
          <div class='face-glyph'>
            <span class='glyph-icon'>
              <BuildingIcon class='glyph-icon-svg' role='presentation' />
            </span>
            {{#if @model.performanceRating}}
              <div class='rating-badge'><@fields.performanceRating /></div>
            {{/if}}
          </div>
          <div class='face-identity'>
            {{#if @model.serviceCategory}}
              <p class='kicker'>{{@model.serviceCategory}}</p>
            {{/if}}
            <h1>{{@model.title}}</h1>
            <dl class='contact-lines'>
              {{#if @model.contactName}}
                <div><dt>Contact</dt><dd>{{@model.contactName}}</dd></div>
              {{/if}}
              {{#if @model.email}}
                <div><dt>Email</dt><dd>{{@model.email}}</dd></div>
              {{/if}}
              {{#if @model.website}}
                <div><dt>Web</dt><dd><@fields.website /></dd></div>
              {{/if}}
            </dl>
          </div>
        </div>
        <dl class='contract-strip'>
          <div><dt>Contract start</dt><dd><@fields.contractStart /></dd></div>
          <div><dt>Length</dt><dd><@fields.contractLength /></dd></div>
        </dl>
      </article>
      <style scoped>
        .vendor-isolated {
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          height: 100%;
          overflow-y: auto;
          animation: vendor-fade-in 0.2s ease-out;
        }
        @keyframes vendor-fade-in {
          from {
            opacity: 0;
            transform: translateY(0.25rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vendor-isolated {
            animation: none;
          }
        }
        .card-face {
          display: flex;
          gap: var(--boxel-sp-lg);
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .face-glyph {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex: none;
        }
        .glyph-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 4.5rem;
          height: 4.5rem;
          border-radius: var(--boxel-border-radius);
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-200));
        }
        .glyph-icon-svg {
          width: 2.25rem;
          height: 2.25rem;
          color: var(--primary, var(--boxel-highlight));
        }
        .face-identity {
          flex: 1;
          min-width: 0;
        }
        .kicker {
          margin: 0 0 var(--boxel-sp-5xs);
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--secondary, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-lg);
          font-family: var(--font-heading, inherit);
        }
        .contact-lines {
          margin-top: var(--boxel-sp);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
        }
        .contact-lines > div {
          display: flex;
          gap: var(--boxel-sp-xs);
        }
        .contact-lines dt {
          flex: none;
          width: 4.5rem;
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .contact-lines dd {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
        .contract-strip {
          margin-top: var(--boxel-sp-lg);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--boxel-sp);
        }
        .contract-strip > div {
          min-width: 0;
        }
        .contract-strip dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .contract-strip dd {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div
        class='vendor-embedded'
      >
        <header>
          <h3>{{@model.title}}</h3>
          <span class='category'>{{@model.serviceCategory}}</span>
        </header>
        <dl class='facts'>
          <div><dt>Contact</dt><dd>{{@model.contactName}}</dd></div>
          <div><dt>Contract start</dt><dd><@fields.contractStart /></dd></div>
          <div><dt>Length</dt><dd><@fields.contractLength /></dd></div>
          <div><dt>Rating</dt><dd><@fields.performanceRating /></dd></div>
        </dl>
      </div>
      <style scoped>
        .vendor-embedded {
          padding: var(--boxel-sp);
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          transition: box-shadow 0.15s ease-out;
        }
        header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        h3 {
          margin: 0;
          font-size: var(--boxel-font-size);
        }
        .category {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .facts {
          margin: var(--boxel-sp-xs) 0 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--boxel-sp-xs);
        }
        .facts > div {
          min-width: 0;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts dd {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='vendor-atom'>
        <BuildingIcon class='vendor-atom-icon' />
        <span class='vendor-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .vendor-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .vendor-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .vendor-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div
        class='vendor-fitted'
      >
        <BuildingIcon class='vendor-icon' role='presentation' />
        <div class='info'>
          <span class='name'>{{@model.title}}</span>
          <span class='meta'>{{@model.serviceCategory}}</span>
          {{#if @model.performanceRating}}
            <span class='body-line body-strong'>★
              {{@model.performanceRating}}/5</span>
          {{/if}}
          {{#if @model.contactName}}
            <span class='body-line'>{{@model.contactName}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .vendor-fitted {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          height: 100%;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          transition: background-color 0.15s ease-out;
        }
        .vendor-fitted:hover {
          background: var(--muted, var(--boxel-100));
        }
        .vendor-icon {
          width: 1.5rem;
          height: 1.5rem;
          flex: none;
          color: var(--primary, var(--boxel-highlight));
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .body-line {
          display: none;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          display: none;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .body-strong {
          color: var(--foreground, var(--boxel-dark));
          font-weight: 600;
        }
        @container fitted-card (height > 120px) {
          .body-line {
            display: -webkit-box;
          }
        }
        @container fitted-card (height <= 80px) {
          .vendor-fitted {
            align-items: center;
          }
        }
        @container fitted-card (height <= 40px) {
          .meta {
            display: none;
          }
        }
      </style>
    </template>
  };
}
