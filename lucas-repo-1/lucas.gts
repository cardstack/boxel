// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { CardDef, Component, field, contains } from 'https://cardstack.com/base/card-api'; // ¹
import StringField from 'https://cardstack.com/base/string'; // ²
import EmailField from 'https://cardstack.com/base/email'; // ³
import UserIcon from '@cardstack/boxel-icons/user'; // ⁴

export class Lucas extends CardDef { // ⁵
  static displayName = 'Lucas';
  static icon = UserIcon;

  @field username = contains(StringField); // ⁶
  @field email = contains(EmailField); // ⁷

  @field cardTitle = contains(StringField, { // ⁸
    computeVia: function (this: Lucas) {
      return this.username ?? 'Unknown User';
    },
  });

  static isolated = class Isolated extends Component<typeof this> { // ⁹
    <template>
      <article class="lucas-card">
        <h1 class="title">{{if @model.username @model.username "No username"}}</h1>
        {{#if @model.email}}
          <p class="email"><@fields.email @format="atom" /></p>
        {{else}}
          <p class="email placeholder">No email provided</p>
        {{/if}}
      </article>
      <style scoped>
        .lucas-card {
          max-width: 32rem;
          margin: 0 auto;
          padding: var(--boxel-sp-lg, 1.5rem);
          background: var(--card, #fff);
          color: var(--card-foreground, #111);
          border-radius: var(--boxel-border-radius, 8px);
          box-shadow: var(--shadow, 0 2px 4px rgba(0,0,0,0.1));
        }
        .title {
          font-size: var(--boxel-font-size-xl, 1.5rem);
          margin: 0 0 var(--boxel-sp-sm, 0.5rem);
        }
        .email {
          font-size: var(--boxel-font-size, 1rem);
          color: var(--muted-foreground, #666);
          margin: 0;
        }
        .placeholder {
          font-style: italic;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> { // ¹⁰
    <template>
      <div class="lucas-embedded">
        <span class="name">{{if @model.username @model.username "Unknown"}}</span>
        <span class="email"><@fields.email @format="atom" /></span>
      </div>
      <style scoped>
        .lucas-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs, 0.5rem);
          padding: var(--boxel-sp-xs, 0.5rem);
        }
        .name {
          font-weight: 600;
        }
        .email {
          color: var(--muted-foreground, #666);
          font-size: var(--boxel-font-size-sm, 0.875rem);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> { // ¹¹
    <template>
      <div class="lucas-fitted">
        <span class="name">{{if @model.username @model.username "Unknown"}}</span>
      </div>
      <style scoped>
        .lucas-fitted {
          display: flex;
          align-items: center;
          padding: var(--boxel-sp-4xs, 0.25rem) var(--boxel-sp-xs, 0.5rem);
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        .name {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}
