import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

// Re-export (not subclass) so `darkfactory#Issue` stays identical to
// `issue-tracker#Issue` — subclassing forks the type identity.
import { Issue, Project, IssueTracker } from './issue-tracker.gts';
export { Issue, Project, IssueTracker };
export { AgentProfile } from './agent-profile.gts';
export { Comment } from './comment.gts';
export { KnowledgeArticle } from './knowledge-article.gts';

export class DarkFactory extends CardDef {
  static displayName = 'Dark Factory';

  @field factoryName = contains(StringField);
  @field description = contains(MarkdownField);
  @field activeProjects = linksToMany(() => Project);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: DarkFactory) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.factoryName ?? 'Dark Factory');
    },
  });

  static fitted = class Fitted extends Component<typeof DarkFactory> {
    <template>
      <div class='compact'>
        <h3><@fields.cardTitle /></h3>
      </div>
      <style scoped>
        .compact {
          padding: 0.75rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof DarkFactory> {
    <template>
      <article class='surface'>
        <h1><@fields.cardTitle /></h1>
        {{#if @model.description}}
          <section>
            <h2>Description</h2>
            <@fields.description />
          </section>
        {{/if}}
        {{#if @model.activeProjects.length}}
          <section>
            <h2>Active Projects</h2>
            <@fields.activeProjects />
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
