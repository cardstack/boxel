import {
  Component,
  field,
  contains,
  StringField,
  realmURL,
} from '@cardstack/base/card-api';
import { type Query, rri } from '@cardstack/runtime-common';
import CardList from '@cardstack/base/components/card-list';
import enumField from '@cardstack/base/enum';
import CircleUserIcon from '@cardstack/boxel-icons/circle-user';

import { PersonBase } from './person-base';

// The Ticket CodeRef, built from the REALM URL at read time.
//
// Two things it is deliberately not. Not an `import { Ticket }`: `ticket.gts`
// imports this module, so importing back closes a cycle, and a cycle in a card
// module fails as `Class extends value undefined` at index time across every
// instance in the realm. Not a `_cardType: 'Ticket'` string either: that is an
// EXACT display-name match and silently drops Incident and ServiceRequest, the
// two subclasses this mostly holds.
//
// It was `import.meta.url` until `import.meta` turned out to be unavailable
// under the checker's CommonJS inference (TS1470). The realm URL is already on
// the model, it is what `service-desk.gts` uses to create a ticket, and it
// makes the ref a per-instance value instead of a module-level constant — so
// the same module is correct in whichever realm it is copied into.
function ticketRefIn(realm: string | undefined) {
  return realm
    ? { module: rri(new URL('./ticket', realm).href), name: 'Ticket' }
    : undefined;
}

import { StatePill } from './components/state-pill';
import { type Hue } from './utils/index';

export const CUSTOMER_TIERS = ['VIP', 'Standard', 'Trial'] as const;

export const CustomerTierField = enumField(StringField, {
  displayName: 'Customer Tier',
  options: CUSTOMER_TIERS as unknown as string[],
});

/**
 * Someone who asks for help.
 *
 * Extends `PersonBase` rather than restating name/email/photo — that block was
 * built for the talent tracker, and consuming it here is what turns it from
 * "works" into "reusable". The only things added are the two facts support
 * actually reasons about: who they work for, and what we promised them.
 */
export class SupportContact extends PersonBase {
  static displayName = 'Contact';
  static icon = CircleUserIcon;

  @field company = contains(StringField);
  @field tier = contains(CustomerTierField);

  @field title = contains(StringField, {
    computeVia: function (this: SupportContact) {
      return this.name?.trim() || 'Unnamed contact';
    },
  });

  @field isVip = contains(StringField, {
    computeVia: function (this: SupportContact) {
      return this.tier === 'VIP' ? 'VIP' : '';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // Live, not a maintained list of links: a ticket that moves queue, gets
    // merged or is closed must leave this list without anyone editing the
    // contact. It matches on the ticket's denormalized customer name — the
    // same string the tiles themselves render.
    get historyQuery(): Query | undefined {
      let ticketRef = ticketRefIn(this.realms[0]);
      if (!ticketRef) {
        return undefined;
      }
      return {
        // ONE anchored node. A bare type node beside an unanchored `eq`
        // translates to a wire filter whose predicate names no type, and the
        // result is always empty. `on` anchors the field path AND constrains
        // the type, adoption-aware, so Incident and ServiceRequest count.
        filter: {
          on: ticketRef,
          eq: { customerName: this.args.model?.title ?? '\u2014' },
        },
      };
    }

    get realms(): string[] {
      let url = this.args.model?.[realmURL];
      return url ? [url.href] : [];
    }

    <template>
      <article class='iso'>
        <header class='iso-head'>
          {{#if @model.photo.resolvedUrl}}
            <img class='avatar' src={{@model.photo.resolvedUrl}} alt='' />
          {{else}}
            <span class='avatar initials'>{{@model.initials}}</span>
          {{/if}}
          <div class='who'>
            <h1>{{@model.title}}</h1>
            {{#if @model.company}}
              <p class='org'>{{@model.company}}</p>
            {{/if}}
          </div>
          <StatePill
            @label={{@model.tier}}
            @hue={{if @model.isVip 'purple' 'slate'}}
            @emphatic={{if @model.isVip true false}}
          />
        </header>

        <dl class='facts'>
          {{#if @model.email}}
            <div><dt>Email</dt><dd><@fields.email /></dd></div>
          {{/if}}
          {{#if @model.phone}}
            <div><dt>Phone</dt><dd>{{@model.phone}}</dd></div>
          {{/if}}
        </dl>

        <section class='hist'>
          <h2>Their tickets</h2>
          {{#if this.realms.length}}
            <CardList
              @context={{@context}}
              @query={{this.historyQuery}}
              @realms={{this.realms}}
              @isLive={{true}}
              @format='fitted'
            />
          {{else}}
            <p class='empty'>No tickets yet. When they write in, everything they
              have asked before will be here — which is the difference between
              support and a stranger asking you to explain it again.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .iso {
          container-name: iso;
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          min-height: 100%;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .iso-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .avatar {
          width: 3rem;
          height: 3rem;
          border-radius: 50%;
          flex: none;
          object-fit: cover;
        }
        .initials {
          display: grid;
          place-items: center;
          font-weight: 700;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-light));
        }
        .who {
          flex: 1;
          min-width: 0;
        }
        .who h1 {
          margin: 0;
          font-family: var(--font-heading, inherit);
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
        }
        .org {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
        .facts {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
          gap: var(--boxel-sp-sm);
          margin: 0;
        }
        /* min-width:0 on the wrapper and anywhere-wrapping on the value: a real
           corporate email is long enough to shove the next column off the row
           otherwise, and short demo data hides it. */
        .facts > div {
          min-width: 0;
        }
        .facts dt {
          font-size: 0.625rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts dd {
          margin: 0;
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
        .hist h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.625rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          max-width: 62ch;
          line-height: 1.6;
        }
      </style>
    </template>
  };

  /**
   * The row a ticket shows when it embeds its customer.
   *
   * An agent picking up a ticket asks three things about the person on the
   * other end, in this order: who are they, who do they work for, and what
   * did we promise them. VIP is the only one that changes what happens next,
   * so it is the only one that carries colour.
   */
  static embedded = class Embedded extends Component<typeof this> {
    get tierHue(): Hue {
      return this.args.model?.tier === 'VIP' ? 'purple' : 'slate';
    }

    <template>
      <article class='sc-row'>
        <span class='sc-avatar' aria-hidden='true'>{{@model.initials}}</span>
        <span class='sc-main'>
          <span class='sc-line'>
            <span class='sc-name'>{{if
                @model.name
                @model.name
                'Unnamed contact'
              }}</span>
            {{#if @model.tier}}
              <StatePill
                @label={{@model.tier}}
                @hue={{this.tierHue}}
                @emphatic={{if @model.isVip true false}}
              />
            {{/if}}
          </span>
          <span class='sc-dim'>{{if
              @model.company
              @model.company
              'No company on file'
            }}</span>
        </span>
        {{#if @model.email}}
          <span class='sc-contact'><@fields.email /></span>
        {{/if}}
      </article>

      <style scoped>
        .sc-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-width: 0;
          padding: var(--boxel-sp-4xs) 0;
          font-family: var(--font-sans, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
        .sc-avatar {
          flex: none;
          width: 1.9rem;
          height: 1.9rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
        }
        .sc-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .sc-line {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          min-width: 0;
        }
        .sc-name {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sc-dim,
        .sc-contact {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Constant slot so a list of contacts column-aligns whether or not a
           given one has an email on file. */
        .sc-contact {
          flex: none;
          width: 12rem;
          text-align: end;
        }
        /* Narrow wraps the email under the name rather than dropping it —
           "how do I reach them" is not a detail worth deleting on a phone. */
        @container (max-width: 26rem) {
          .sc-row {
            flex-wrap: wrap;
          }
          .sc-contact {
            width: 100%;
            padding-left: calc(1.9rem + var(--boxel-sp-xs));
            text-align: start;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>
        <span class='atom-av'>{{@model.initials}}</span>
        <span class='atom-name'>{{@model.title}}</span>
        {{#if @model.isVip}}<span class='atom-vip'>VIP</span>{{/if}}
      </span>
      <style scoped>
        .atom {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.8125rem;
        }
        .atom-av {
          width: 1.1rem;
          height: 1.1rem;
          border-radius: 50%;
          display: inline-grid;
          place-items: center;
          font-size: 0.5625rem;
          font-weight: 700;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-light));
          flex: none;
        }
        .atom-name {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .atom-vip {
          font-size: 0.5625rem;
          letter-spacing: 0.08em;
          font-weight: 700;
          color: var(--boxel-purple);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <header class='r-head'>
          {{#if @model.photo.resolvedUrl}}
            <img class='av' src={{@model.photo.resolvedUrl}} alt='' />
          {{else}}
            <span class='av'>{{@model.initials}}</span>
          {{/if}}
          <h3 class='title'>{{@model.title}}</h3>
          <span class='badge'>{{@model.tier}}</span>
        </header>
        <div class='r-body'>
          <span class='line'>{{@model.company}}</span>
          <span class='line line-2'>{{@model.email}}</span>
          <p class='blurb'>{{@model.email}}</p>
          <span class='tail'>{{@model.phone}}</span>
        </div>
        <footer class='r-meta'>{{@model.company}}</footer>
      </article>
      <style scoped>
        /* Same skeleton as ticket.gts: one `.fit` grid, no container declared
           here (the host provides `fitted-card`), one continuous type scale,
           and tiers that ADD a row rather than un-crop one. */
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 2px;
          padding: 7px 9px;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --type-base: clamp(9.5px, 2.7cqi, 12px);
          --type-title: max(11px, calc(var(--type-base) * 1.25));
        }
        .fit > * {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }
        .av {
          flex: none;
          width: 1.35rem;
          height: 1.35rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          object-fit: cover;
          font-size: var(--type-base);
          font-weight: 700;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-light));
        }
        .title {
          flex: 1;
          min-width: 0;
          margin: 0;
          font-size: var(--type-title);
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .badge {
          flex: none;
          margin-left: auto;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .r-body {
          grid-area: body;
          display: none;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .line {
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .blurb {
          display: none;
          margin: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tail {
          display: none;
          margin-top: auto;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .r-meta {
          grid-area: meta;
          display: none;
          align-items: center;
          gap: 6px;
          min-width: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 50px) {
          .r-meta {
            display: flex;
          }
        }
        @container fitted-card (height > 50px) and (height <= 105px) {
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 80px) {
          .r-body {
            display: flex;
          }
        }
        @container fitted-card (height > 160px) {
          .blurb {
            display: -webkit-box;
          }
        }
        @container fitted-card (height > 240px) {
          .blurb {
            -webkit-line-clamp: 4;
          }
          .tail {
            display: block;
          }
        }
        @container fitted-card (width > 300px) and (height <= 130px) {
          .fit {
            grid-template-columns: minmax(200px, 1fr) auto;
            grid-template-areas: 'head meta' 'body meta';
            align-items: center;
          }
          .r-meta {
            flex-direction: column;
            align-items: flex-end;
            gap: 1px;
          }
        }
        @container fitted-card (width <= 170px) {
          .line-2 {
            display: none;
          }
        }
      </style>
    </template>
  };
}
