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

import { Employee } from './trt-employee';

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

  @field headcount = contains(StringField, {
    computeVia: function (this: Team) {
      let count = this.members?.length ?? 0;
      return `${count} ${count === 1 ? 'member' : 'members'}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get memberCount(): number {
      return this.args.model?.members?.length ?? 0;
    }

    <template>
      <article
        class='team-isolated'
      >
        <header class='team-header'>
          <p class='kicker'>Team</p>
          <h1>{{@model.title}}</h1>
          {{#if @model.mission}}
            <p class='mission'>{{@model.mission}}</p>
          {{/if}}
        </header>
        <div class='stat-strip'>
          <div class='stat'>
            <span class='stat-value'>{{this.memberCount}}</span>
            <span class='stat-label'>members</span>
          </div>
          {{#if @model.lead}}
            <div class='lead-chip'>
              <span class='lead-label'>Lead</span>
              <@fields.lead @format='atom' />
            </div>
          {{/if}}
        </div>
        {{#if @model.members.length}}
          <section class='roster'>
            <h2>Roster</h2>
            <ul class='roster-grid'>
              {{#each @model.members as |member|}}
                <li class='roster-tile'>
                  {{#if member.photoUrl}}
                    <img class='roster-avatar' src={{member.photoUrl}} alt='' />
                  {{else}}
                    <span
                      class='roster-avatar initials'
                    >{{member.initials}}</span>
                  {{/if}}
                  <span class='roster-name'>{{member.title}}</span>
                  {{#if member.role}}
                    <span class='roster-role'>{{member.role}}</span>
                  {{/if}}
                </li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .team-isolated {
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          height: 100%;
          overflow-y: auto;
          animation: team-fade-in 0.2s ease-out;
        }
        @keyframes team-fade-in {
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
          .team-isolated {
            animation: none;
          }
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
        .mission {
          margin: var(--boxel-sp-xs) 0 0;
          font-style: italic;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .stat-strip {
          margin-top: var(--boxel-sp-lg);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp) 0;
          border-top: 1px solid var(--border, var(--boxel-200));
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .stat {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-4xs);
        }
        .stat-value {
          font-family: var(--font-serif, serif);
          font-size: var(--boxel-font-size-xl);
          font-weight: 600;
          color: var(--primary, var(--boxel-dark));
        }
        .stat-label {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .lead-chip {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .lead-label {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        section {
          margin-top: var(--boxel-sp-lg);
        }
        h2 {
          font-size: var(--boxel-font-size-sm);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          margin: 0 0 var(--boxel-sp);
        }
        .roster-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
          gap: var(--boxel-sp);
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .roster-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-200));
          text-align: center;
          transition:
            transform 0.15s ease-out,
            box-shadow 0.15s ease-out;
        }
        .roster-tile:hover {
          transform: translateY(-0.125rem);
          box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.08);
        }
        .roster-avatar {
          width: 2.75rem;
          height: 2.75rem;
          border-radius: 50%;
          object-fit: cover;
        }
        .roster-avatar.initials {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          color: var(--primary-foreground, var(--boxel-light));
          background: var(--primary, var(--boxel-highlight));
        }
        .roster-name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .roster-role {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div
        class='team-embedded'
      >
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
            <@fields.lead @format='atom' />
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
          color: var(--foreground, #111111);
        }
        .team-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
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
    <template>
      <div
        class='team-fitted'
      >
        <UsersIcon class='team-icon' role='presentation' />
        <div class='info'>
          <span class='name'>{{@model.title}}</span>
          <span class='meta'>{{@model.headcount}}</span>
          {{#if @model.mission}}
            <span class='body-line'>{{@model.mission}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .team-fitted {
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
        .team-fitted:hover {
          background: var(--muted, var(--boxel-100));
        }
        .team-icon {
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
          .team-fitted {
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
