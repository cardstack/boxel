import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import UsersIcon from '@cardstack/boxel-icons/users';

import { Employee } from './employee';
import { initialsOf, liveCount } from './utils/index';

export class Team extends CardDef {
  static displayName = 'Team';
  static icon = UsersIcon;

  @field name = contains(StringField);
  @field mission = contains(StringField);
  @field lead = linksTo(() => Employee);
  @field members = linksToMany(() => Employee);

  @field title = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name?.trim() || 'Unnamed Team';
    },
  });

  // Denormalized for fitted: prerendered fitted does not resolve linksTo,
  // so the lead's name and the member tally must exist as own attributes.
  @field leadName = contains(StringField, {
    computeVia: function (this: Team) {
      return this.lead?.name ?? '';
    },
  });

  @field memberTally = contains(StringField, {
    computeVia: function (this: Team) {
      return String(liveCount(this.members));
    },
  });

  @field headcount = contains(StringField, {
    computeVia: function (this: Team) {
      let count = liveCount(this.members);
      return `${count} ${count === 1 ? 'member' : 'members'}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get initials() {
      return initialsOf(this.args.model?.name);
    }

    get memberCount(): number {
      return liveCount(this.args.model?.members);
    }

    get members() {
      return (this.args.model?.members ?? []).filter(Boolean);
    }

    // Members carry their own status; surfacing the split here means a
    // manager sees "3 active, 1 onboarding" without opening anyone.
    get statusSplit() {
      let counts: Record<string, number> = {};
      for (let m of this.members) {
        let k = (m as any)?.status ?? 'unknown';
        counts[k] = (counts[k] ?? 0) + 1;
      }
      return Object.entries(counts).map(([status, count]) => ({
        status,
        count,
      }));
    }

    get leadName(): string | undefined {
      return (this.args.model?.lead as any)?.name ?? undefined;
    }

    <template>
      <article class='team-isolated'>
        <header class='hero'>
          <span class='avatar' aria-hidden='true'>{{this.initials}}</span>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{if @model.headcount @model.headcount '0 members'}}
              {{#if this.leadName}}
                <span class='sep-dot'>&middot;</span>
                led by
                {{this.leadName}}
              {{/if}}
            </p>
            {{#if @model.mission}}
              <p class='mission'>{{@model.mission}}</p>
            {{/if}}
          </div>
          <div class='hero-num'>
            <span class='num'>{{this.memberCount}}</span>
            <span class='num-label'>on the team</span>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Members</h2>
            {{#if this.members.length}}
              <ul class='member-list'>
                {{#each @fields.members as |Member|}}
                  <li><Member
                      @format='embedded'
                      @displayContainer={{false}}
                    /></li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No members yet. Link an employee to build the
                team.</p>
            {{/if}}
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Composition</h2>
            <dl class='facts stacked'>
              <dt>Headcount</dt>
              <dd>{{if @model.headcount @model.headcount '0 members'}}</dd>
              <dt>Lead</dt>
              <dd>{{#if @model.lead}}<@fields.lead
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
            </dl>

            {{#if this.statusSplit.length}}
              <h2 class='panel-title spaced'>By status</h2>
              <dl class='facts stacked'>
                {{#each this.statusSplit as |row|}}
                  <dt>{{row.status}}</dt>
                  <dd>{{row.count}}</dd>
                {{/each}}
              </dl>
            {{/if}}
          </aside>
        </div>
      </article>
      <style scoped>
        .team-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --team-id: var(--primary, var(--boxel-highlight));
          --team-strong: color-mix(
            in oklch,
            var(--team-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: var(--boxel-border-radius);
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          background: var(--team-strong);
          color: var(--background, var(--boxel-light));
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .mission {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          max-width: 52ch;
        }
        .hero-num {
          flex: none;
          text-align: right;
        }
        .num {
          display: block;
          font-size: 1.9rem;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .num-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          /* Fill whatever height is left so the aside's surface reaches the
             bottom edge. Without this the grid is only as tall as its content
             and the panel stops mid-card, reading as a cut-off seam. */
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        .member-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .member-list > li {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          overflow: hidden;
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding-top: 0.4rem;
        }
        .facts dd {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
          .hero {
            flex-wrap: wrap;
          }
          .hero-num {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='team-embedded'>
        <header>
          <h3>{{@model.title}}</h3>
          <span class='headcount'>{{@model.headcount}}</span>
        </header>
        {{#if @model.mission}}
          <p class='mission'>{{@model.mission}}</p>
        {{/if}}
        {{#if @model.lead}}
          <div class='lead'>
            <span class='label'>Lead</span>
            <@fields.lead @format='atom' @displayContainer={{false}} />
          </div>
        {{/if}}
      </div>
      <style scoped>
        .team-embedded {
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
        .headcount {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .mission {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .lead {
          margin-top: var(--boxel-sp-xs);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .label {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='team-atom'>
        <UsersIcon class='team-atom-icon' />
        <span class='team-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .team-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .team-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .team-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get initials() {
      return initialsOf(this.args.model?.name);
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <span class='avatar' aria-hidden='true'>{{this.initials}}</span>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.leadName}}
              <span class='fit-eb'>led by {{@model.leadName}}</span>
            {{/if}}
          </div>
          {{! Headcount rides in the pill slot — it is this card's status. }}
          <span class='fit-pill'>
            <span class='pill-dot'></span>{{if
              @model.headcount
              @model.headcount
              '0 members'
            }}
          </span>
        </div>

        {{#if @model.mission}}
          <p class='fit-mission'>{{@model.mission}}</p>
        {{/if}}

        <dl class='fit-add'>
          <div><dt>Members</dt><dd>{{if
                @model.memberTally
                @model.memberTally
                '0'
              }}</dd></div>
          {{#if @model.leadName}}
            <div><dt>Lead</dt><dd>{{@model.leadName}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING a field. Nothing shrinks below 11px. */
        .fit {
          height: 100%;
          /* Flex, not a three-row grid: with `minmax(0, 1fr)` in the middle
             a taller bottom block squeezed the middle row and clipped its
             text. Here the middle keeps its natural height and the extras
             block is pushed to the bottom by `margin-top: auto`. */
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --team-id: var(--primary, var(--boxel-highlight));
          --team-strong: color-mix(
            in oklch,
            var(--team-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 4px;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--team-strong);
          color: var(--background, var(--boxel-light));
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-pill {
          flex: none;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          align-self: flex-start;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
          background: var(--muted, var(--boxel-100));
          color: var(--team-strong);
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-mission {
          display: none;
          margin: 0;
          font-size: var(--fit-small);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-add {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-add > div {
          display: flex;
          gap: 0.25rem;
          min-width: 0;
        }
        .fit-add dt {
          flex: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* TIER 2 — add the lead. Two rules: container queries have no `or`. */
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }
        /* TIER 3 — add the mission. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-mission {
            display: -webkit-box;
          }
        }
        /* TIER 4 — width-driven extra facts (previously missing entirely). */
        @container fitted-card (height > 150px) and (width > 180px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }
        /* Short strip: horizontal, one-line name. */
        @container fitted-card (height <= 90px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-pill {
            align-self: center;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
        /* Smallest: drop the lead, keep the headcount pill. */
        @container fitted-card (height <= 50px) {
          .avatar {
            width: 1.25rem;
            height: 1.25rem;
          }
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
