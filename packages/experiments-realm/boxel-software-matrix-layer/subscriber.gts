import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import RepeatIcon from '@cardstack/boxel-icons/repeat';

import { Contact } from './contact';
import { Subscription } from './subscription';

/**
 * The party on the receiving end of subscriptions — who holds them, since
 * when, and which ones. The Subscription card owns each plan's own life
 * (price, billing cycle, status); this card is the holder-side view that
 * groups them, which is what renewals, upgrade prompts and "your plans"
 * pages address.
 *
 * `subscriptions` is a link array deliberately: a holder's subscriptions
 * are a small, bounded set maintained by whatever command starts or stops
 * one — the rollup rule's link-array case, not its query case.
 */
export class Subscriber extends CardDef {
  static displayName = 'Subscriber';
  static icon = RepeatIcon;

  @field holder = linksTo(Contact);
  @field since = contains(DateField);
  @field subscriptions = linksToMany(Subscription);

  @field activeCount = contains(NumberField, {
    computeVia: function (this: Subscriber) {
      return (this.subscriptions ?? []).filter(
        (s) => s?.status === 'active',
      ).length;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Subscriber) {
      return this.holder?.name ?? `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Subscriber> {
    <template>
      <span class='sub-atom'>
        <RepeatIcon class='sub-icon' />
        <span class='sub-name'>{{if
            @model.holder.name
            @model.holder.name
            'Unassigned subscriber'
          }}</span>
      </span>
      <style scoped>
        .sub-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .sub-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, #6b7280);
        }
        .sub-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Subscriber> {
    get planCount() {
      let n = (this.args.model.subscriptions ?? []).length;
      return n === 1 ? '1 plan' : `${n} plans`;
    }
    <template>
      <div class='sub-row'>
        <div class='sub-id'>
          <span class='sub-name'>{{if
              @model.holder.name
              @model.holder.name
              'Unassigned subscriber'
            }}</span>
          <span class='sub-meta'>{{this.planCount}}
            {{#if @model.since}}· since <@fields.since />{{/if}}</span>
        </div>
        <span class='sub-active'>
          {{#if @model.activeCount}}
            {{@model.activeCount}} active
          {{else}}
            none active
          {{/if}}
        </span>
      </div>
      <style scoped>
        .sub-row {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .sub-id {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .sub-name {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sub-meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        /* Constant-width slot so subscriber rows column-align. */
        .sub-active {
          width: 5.5rem;
          text-align: right;
          flex-shrink: 0;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Subscriber> {
    get planCount() {
      let n = (this.args.model.subscriptions ?? []).length;
      return n === 1 ? '1 plan' : `${n} plans`;
    }
    <template>
      <div class='fitted'>
        <span class='name'>{{if
            @model.holder.name
            @model.holder.name
            'Unassigned subscriber'
          }}</span>
        <span class='meta line-plans'>{{this.planCount}}</span>
        {{#if @model.since}}
          <span class='meta line-since'>Since <@fields.since /></span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .line-plans,
        .line-since {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-plans {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-since {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Subscriber> {
    <template>
      <article class='sub-page'>
        <header class='sh'>
          <div class='sh-id'>
            <p class='doc-kind'>Subscriber</p>
            <h1>{{if
                @model.holder.name
                @model.holder.name
                'Unassigned subscriber'
              }}</h1>
            {{#if @model.since}}
              <p class='sh-since'>Subscriber since <@fields.since /></p>
            {{/if}}
          </div>
          <span class='sh-count'>
            {{if @model.activeCount @model.activeCount 0}}
            active
          </span>
        </header>
        {{#if @model.holder}}
          <section class='panel'>
            <h2>Holder</h2>
            <div class='linked'><@fields.holder @format='embedded' /></div>
          </section>
        {{/if}}
        <section class='panel'>
          <h2>Subscriptions</h2>
          {{#if @model.subscriptions.length}}
            <div class='subs'><@fields.subscriptions @format='embedded' /></div>
          {{else}}
            <p class='empty'>No subscriptions yet</p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .sub-page {
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
        .sh-id {
          flex: 1;
          min-width: 0;
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
        .sh-since {
          margin: 0.25rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .sh-count {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
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
        .linked,
        .subs {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .subs :deep(.boxel-card-container--boundaries) {
          box-shadow: none;
          background: transparent;
        }
        .empty {
          margin: 0;
          font-size: 0.875rem;
          font-style: italic;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}
