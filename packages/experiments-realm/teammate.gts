import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Avatar } from '@cardstack/boxel-ui/components';
import { User } from './user';

export class Teammate extends User {
  static displayName = 'Teammate';

  @field jobTitle = contains(StringField);

  static embedded = class Embedded extends Component<typeof Teammate> {
    <template>
      <div class='teammate'>
        <Avatar
          class='avatar'
          @userId={{@model.email}}
          @displayName={{@model.name}}
          @isReady={{true}}
        />
        <div class='info'>
          <div class='name'>{{if @model.name @model.name 'Unnamed'}}</div>
          {{#if @model.jobTitle}}
            <div class='meta'>{{@model.jobTitle}}</div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .teammate {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .avatar {
          --profile-avatar-icon-size: 32px;
          --profile-avatar-icon-border: 0;
          font-weight: 700;
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Teammate> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Teammate';
    }
    <template>
      <div class='fitted'>
        <Avatar
          class='avatar'
          @userId={{@model.email}}
          @displayName={{@model.name}}
          @isReady={{true}}
        />
        <div class='info'>
          <span class='name'>{{this.name}}</span>
          {{#if @model.jobTitle}}
            <span class='meta line-title'>{{@model.jobTitle}}</span>
          {{/if}}
          {{#if @model.email}}
            <span class='meta line-email'>{{@model.email}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fitted {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .avatar {
          --profile-avatar-icon-size: 28px;
          --profile-avatar-icon-border: 0;
          font-weight: 700;
          flex-shrink: 0;
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
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
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-title,
        .line-email {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-title {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .fitted {
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            padding: 0.875rem;
          }
          .avatar {
            --profile-avatar-icon-size: 40px;
          }
          .line-email {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Teammate> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Teammate';
    }
    <template>
      <article class='teammate-page'>
        <header class='th'>
          <Avatar
            class='avatar'
            @userId={{@model.email}}
            @displayName={{@model.name}}
            @isReady={{true}}
          />
          <div class='th-id'>
            <p class='doc-kind'>Teammate</p>
            <h1>{{this.name}}</h1>
            {{#if @model.jobTitle}}
              <p class='job-title'>{{@model.jobTitle}}</p>
            {{/if}}
          </div>
        </header>
        {{#if @model.email}}
          <section class='panel'>
            <h2>Contact</h2>
            <dl>
              <dt>Email</dt>
              <dd><@fields.email /></dd>
            </dl>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .teammate-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .th {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .avatar {
          --profile-avatar-icon-size: 56px;
          font-weight: 700;
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
        .job-title {
          margin: 0.25rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
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
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5rem 1.25rem;
          font-size: 0.875rem;
          align-items: center;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
      </style>
    </template>
  };
}
