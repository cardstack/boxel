import {
  Component,
  field,
  contains,
  containsMany,
  StringField,
  realmURL,
} from '@cardstack/base/card-api';
import { type Query, rri } from '@cardstack/runtime-common';
import CardList from '@cardstack/base/components/card-list';
import enumField from '@cardstack/base/enum';
import HeadsetIcon from '@cardstack/boxel-icons/headset';

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

export const AGENT_TIERS = ['L1', 'L2', 'L3'] as const;

export const AGENT_TIER_LABELS: Record<string, string> = {
  L1: 'L1 · Front line',
  L2: 'L2 · Specialist',
  L3: 'L3 · Engineering',
};

export const AgentTierField = enumField(StringField, {
  displayName: 'Support Tier',
  options: AGENT_TIERS as unknown as string[],
});

/** The next tier up, or undefined at the top. Escalation reads this. */
export function nextTier(tier?: string | null): string | undefined {
  let idx = AGENT_TIERS.indexOf(tier as never);
  return idx >= 0 && idx < AGENT_TIERS.length - 1
    ? AGENT_TIERS[idx + 1]
    : undefined;
}

/**
 * Someone who answers.
 *
 * Extends `PersonBase` for the same reason `SupportContact` does. `skills` is
 * the field auto-assignment reads: routing on tier alone sends every SSO
 * question to whoever is least busy, which is how a ticket takes three days
 * and two escalations to reach the person who could have answered it in five
 * minutes.
 */
export class SupportAgent extends PersonBase {
  static displayName = 'Agent';
  static icon = HeadsetIcon;

  @field tier = contains(AgentTierField);
  @field skills = containsMany(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: SupportAgent) {
      return this.name?.trim() || 'Unnamed agent';
    },
  });

  @field tierLabel = contains(StringField, {
    computeVia: function (this: SupportAgent) {
      return AGENT_TIER_LABELS[this.tier ?? ''] ?? this.tier ?? '';
    },
  });

  @field skillSummary = contains(StringField, {
    computeVia: function (this: SupportAgent) {
      let skills = (this.skills ?? []).filter(Boolean);
      if (!skills.length) {
        return 'No skills listed';
      }
      return skills.length <= 3
        ? skills.join(', ')
        : `${skills.slice(0, 3).join(', ')} +${skills.length - 3}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get assignedQuery(): Query | undefined {
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
          eq: { assigneeName: this.args.model?.title ?? '\u2014' },
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
            <p class='org'>{{@model.tierLabel}}</p>
          </div>
        </header>

        <dl class='facts'>
          {{#if @model.email}}
            <div><dt>Email</dt><dd><@fields.email /></dd></div>
          {{/if}}
          <div><dt>Skills</dt><dd>{{@model.skillSummary}}</dd></div>
        </dl>

        {{#if @model.skills.length}}
          <ul class='skills'>
            {{#each @model.skills as |skill|}}
              <li><StatePill @label={{skill}} @hue='teal' /></li>
            {{/each}}
          </ul>
        {{/if}}

        <section class='work'>
          <h2>Assigned to them</h2>
          {{#if this.realms.length}}
            <CardList
              @context={{@context}}
              @query={{this.assignedQuery}}
              @realms={{this.realms}}
              @isLive={{true}}
              @format='fitted'
            />
          {{else}}
            <p class='empty'>Nothing assigned right now.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .iso {
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
        .skills {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
        }
        .work h2 {
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
        }
      </style>
    </template>
  };

  /**
   * The row a ticket shows when it embeds its owner.
   *
   * For an agent looking at somebody else's ticket the question is not "who
   * is this person" but "can they take it" — so the tier and the skills are
   * the content, and the name is the label on them.
   */
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='sa-row'>
        <span class='sa-avatar' aria-hidden='true'>{{@model.initials}}</span>
        <span class='sa-main'>
          <span class='sa-line'>
            <span class='sa-name'>{{if
                @model.name
                @model.name
                'Unnamed agent'
              }}</span>
            {{#if @model.tierLabel}}
              <StatePill @label={{@model.tierLabel}} @chrome={{true}} />
            {{/if}}
          </span>
          <span class='sa-dim'>{{if
              @model.skillSummary
              @model.skillSummary
              'No skills recorded'
            }}</span>
        </span>
      </article>

      <style scoped>
        .sa-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-width: 0;
          padding: var(--boxel-sp-4xs) 0;
          font-family: var(--font-sans, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
        .sa-avatar {
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
        .sa-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .sa-line {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          min-width: 0;
        }
        .sa-name {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sa-dim {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>
        <span class='atom-av'>{{@model.initials}}</span>
        <span class='atom-name'>{{@model.title}}</span>
        {{#if @model.tier}}<span class='atom-tier'>{{@model.tier}}</span>{{/if}}
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
        .atom-tier {
          font-size: 0.5625rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
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
          <span class='line'>{{@model.tierLabel}}</span>
          <span class='line line-2'>{{@model.skillSummary}}</span>
          <p class='blurb'>{{@model.skillSummary}}</p>
          <span class='tail'>{{@model.email}}</span>
        </div>
        <footer class='r-meta'>{{@model.tierLabel}}</footer>
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
