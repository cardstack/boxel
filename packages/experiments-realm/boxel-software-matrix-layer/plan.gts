import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  StringField,
} from '@cardstack/base/card-api';
import LayersIcon from '@cardstack/boxel-icons/layers';

// Plan — a named, recurring tier of the product (e.g. "Pro", "Enterprise").
// Deliberately has no Price field of its own: a Plan's prices are looked up
// by querying Price cards that link to it (Price -> Plan is one-directional,
// per this realm's rollup-split rule — an unbounded/reporting relationship
// gets a live query, not a stored back-link on the parent).

export class Plan extends CardDef {
  static displayName = 'Plan';
  static icon = LayersIcon;

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field features = containsMany(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Plan) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Plan> {
    <template>
      <span class='plan-atom'>
        <LayersIcon class='pa-icon' />
        <span class='pa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .plan-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .pa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Plan> {
    <template>
      <div class='plan-row'>
        <LayersIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.description}}
            <span class='meta'>{{@model.description}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .plan-row {
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

  static fitted = class Fitted extends Component<typeof Plan> {
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <LayersIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
        </div>
        <div class='fmt strip'>
          <LayersIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
          </div>
        </div>
        <div class='fmt tile'>
          <LayersIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.description}}
            <span class='meta'>{{@model.description}}</span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <LayersIcon class='doc-icon' />
              <span class='name name-lg'>{{@model.cardTitle}}</span>
            </div>
            {{#if @model.description}}
              <span class='meta'>{{@model.description}}</span>
            {{/if}}
            {{#if @model.features.length}}
              <span class='meta'>{{@model.features.length}} features</span>
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
        .col,
        .info {
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

  static isolated = class Isolated extends Component<typeof Plan> {
    <template>
      <article class='plan-page'>
        <header class='ph'>
          <LayersIcon class='avatar-icon' />
          <div class='ph-id'>
            <p class='doc-kind'>Plan</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
        </header>
        {{#if @model.description}}
          <p class='desc'>{{@model.description}}</p>
        {{/if}}
        {{#if @model.features.length}}
          <section class='panel'>
            <h2>Features</h2>
            <ul>
              {{#each @model.features as |f|}}
                <li>{{f}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .plan-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .ph {
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
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        ul {
          margin: 0;
          padding-left: 1.25rem;
          font-size: 0.875rem;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
      </style>
    </template>
  };
}
