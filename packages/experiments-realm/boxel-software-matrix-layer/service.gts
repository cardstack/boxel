import {
  CardDef,
  Component,
  contains,
  field,
  StringField,
} from '@cardstack/base/card-api';
import WrenchIcon from '@cardstack/boxel-icons/wrench';

// Service — a billable, non-recurring unit (implementation, support hours,
// onboarding). Kept separate from Plan per the domain-neutral rule: Plan is
// the recurring tier, Service is one-time/ad-hoc. Same Price-lookup pattern
// as Plan — no stored back-link, a Price links to the Service it prices.

export class Service extends CardDef {
  static displayName = 'Service';
  static icon = WrenchIcon;

  @field name = contains(StringField);
  @field description = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Service) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Service> {
    <template>
      <span class='service-atom'>
        <WrenchIcon class='sa-icon' />
        <span class='sa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .service-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .sa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .sa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Service> {
    <template>
      <div class='service-row'>
        <WrenchIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.description}}
            <span class='meta'>{{@model.description}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .service-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Service> {
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <WrenchIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
        </div>
        <div class='fmt strip'>
          <WrenchIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
        </div>
        <div class='fmt tile'>
          <WrenchIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.description}}
            <span class='meta'>{{@model.description}}</span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <WrenchIcon class='doc-icon' />
              <span class='name name-lg'>{{@model.cardTitle}}</span>
            </div>
            {{#if @model.description}}
              <span class='meta'>{{@model.description}}</span>
            {{/if}}
          </div>
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
        }
        .doc-icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .name-lg {
          font-size: 0.9375rem;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .col {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 0;
          flex: 1;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) and (max-height: 169px) {
          .strip {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            padding: 0.625rem 0.75rem;
          }
        }
        @container fitted-card (max-width: 399px) and (min-height: 170px) {
          .tile {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.875rem;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .card {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1.25rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Service> {
    <template>
      <article class='service-page'>
        <header class='sh'>
          <WrenchIcon class='avatar-icon' />
          <div class='sh-id'>
            <p class='doc-kind'>Service</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
        </header>
        {{#if @model.description}}
          <p class='desc'>{{@model.description}}</p>
        {{/if}}
      </article>
      <style scoped>
        .service-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .sh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .avatar-icon {
          width: 40px;
          height: 40px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .desc {
          font-size: 0.9375rem;
          color: var(--muted-foreground, #6b7280);
          margin: 0;
        }
      </style>
    </template>
  };
}
