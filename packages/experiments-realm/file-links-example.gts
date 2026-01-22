import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { gt } from '@cardstack/boxel-ui/helpers';
import { FileDef } from 'https://cardstack.com/base/file-api';

/**
 * Example card demonstrating the use of FileDef with linksTo and linksToMany.
 *
 * This card shows how to:
 * - Link to a single file using `linksTo(FileDef)`
 * - Link to multiple files using `linksToMany(FileDef)`
 *
 * Note: FileDef links are read-only in edit mode. Files must already exist
 * in the realm - they are referenced by their file URL.
 */
export class FileLinksExample extends CardDef {
  static displayName = 'File Links Example';

  @field title = contains(StringField);
  @field description = contains(StringField);

  // Single file link - e.g., a main document or primary attachment
  @field primaryDocument = linksTo(FileDef);

  // Multiple file links - e.g., supporting documents or attachments
  @field attachments = linksToMany(FileDef);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='file-links-example'>
        <header>
          <h1>Title: {{@model.title}}</h1>
          {{#if @model.description}}
            <p class='description'>{{@model.description}}</p>
          {{/if}}
        </header>

        <section class='primary-document'>
          <h2>Primary Document</h2>
          {{#if @model.primaryDocument}}
            <div class='primary-document-card'>
              <@fields.primaryDocument @format='embedded' />
            </div>
          {{else}}
            <p class='empty-state'>No primary document linked</p>
          {{/if}}
        </section>

        <section class='attachments'>
          <h2>Attachments ({{@model.attachments.length}})</h2>
          {{#if (gt @model.attachments.length 0)}}
            <div class='attachments-list'>
              <@fields.attachments @format='embedded' />
            </div>
          {{else}}
            <p class='empty-state'>No attachments linked</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .file-links-example {
          padding: var(--boxel-sp-lg);
          font-family: var(--boxel-font-family);
        }
        header {
          margin-bottom: var(--boxel-sp-lg);
        }
        h1 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-lg);
        }
        h2 {
          font-size: var(--boxel-font-med);
          margin: 0 0 var(--boxel-sp-sm);
          color: var(--boxel-dark);
        }
        .description {
          margin: 0;
          color: var(--boxel-500);
        }
        section {
          margin-bottom: var(--boxel-sp-lg);
        }
        .attachments-list {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }
        .primary-document-card > :deep(.linksTo-field),
        .attachments-list > :deep(.linksToMany-field) {
          padding: var(--boxel-sp-sm);
          background: var(--boxel-light);
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-radius-sm);
        }
        .empty-state {
          color: var(--boxel-400);
          font-style: italic;
          margin: 0;
        }
        a {
          color: var(--boxel-highlight);
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </template>
  };
}
