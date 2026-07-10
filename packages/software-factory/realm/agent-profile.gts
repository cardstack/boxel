import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import StringField from '@cardstack/base/string';

export class AgentProfile extends CardDef {
  static displayName = 'Agent Profile';

  @field agentId = contains(StringField);
  @field capabilities = containsMany(StringField);
  @field specialization = contains(StringField);
  @field notes = contains(MarkdownField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: AgentProfile) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.agentId ?? 'Unnamed Agent');
    },
  });

  static fitted = class Fitted extends Component<typeof AgentProfile> {
    <template>
      <div class='agent-card compact'>
        <strong>{{if @model.agentId @model.agentId 'Unknown Agent'}}</strong>
        {{#if @model.specialization}}
          <span>{{@model.specialization}}</span>
        {{/if}}
      </div>
      <style scoped>
        .agent-card {
          display: grid;
          gap: 0.25rem;
        }
        .compact {
          padding: 0.75rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof AgentProfile> {
    <template>
      <article class='surface'>
        <h1>{{if @model.agentId @model.agentId 'Unknown Agent'}}</h1>
        {{#if @model.specialization}}<p>{{@model.specialization}}</p>{{/if}}
        {{#if @model.capabilities.length}}
          <section>
            <h2>Capabilities</h2>
            <ul>
              {{#each @model.capabilities as |capability|}}
                <li>{{capability}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
        {{#if @model.notes}}
          <section>
            <h2>Notes</h2>
            <@fields.notes />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
      </style>
    </template>
  };
}
