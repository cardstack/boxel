import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BookOpenIcon from '@cardstack/boxel-icons/book-open';

export class AdventureScenario extends CardDef {
  static displayName = 'Adventure Scenario';
  static icon = BookOpenIcon;

  @field key = contains(StringField);
  @field title = contains(StringField);
  @field description = contains(StringField);

  // Open-ended guidance
  @field tags = containsMany(StringField); // narrative/style hints (free-form)
  @field imageStyles = containsMany(StringField); // visual-only hints (e.g., "pixel-art")

  static isolated = class Isolated extends Component<typeof AdventureScenario> {
    <template>
      <article class='scenario-iso'>
        <header class='head'>
          <h1 class='name'>{{if
              @model.title
              @model.title
              'Unnamed Scenario'
            }}</h1>
          <div class='meta'>
            {{#if (Number @model.tags.length)}}
              <div class='tags'>
                {{#each @model.tags as |t|}}<span
                    class='chip'
                  >{{t}}</span>{{/each}}
              </div>
            {{/if}}
            {{#if (Number @model.imageStyles.length)}}
              <div class='tags light'>
                {{#each @model.imageStyles as |s|}}<span
                    class='chip subtle'
                  >{{s}}</span>{{/each}}
              </div>
            {{/if}}
          </div>
        </header>

        {{#if @model.description}}
          <p class='desc'>{{@model.description}}</p>
        {{else}}
          <p class='desc muted'>No description provided yet.</p>
        {{/if}}

        <footer class='foot'>
          {{#if @model.key}}<span class='hint'>Key: {{@model.key}}</span>{{/if}}
        </footer>
      </article>

      <style scoped>
        .scenario-iso {
          padding: 1rem;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          display: grid;
          gap: 0.5rem;
          max-width: 48rem;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .name {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 800;
          color: #111827;
        }
        .meta {
          display: inline-flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .pill {
          border: 1px solid #e5e7eb;
          border-radius: 999px;
          padding: 0.125rem 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: #334155;
          background: #fff;
        }
        .pill.subtle {
          color: #64748b;
        }
        .tags {
          display: inline-flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .tags.light .chip {
          color: #64748b;
        }
        .chip {
          border: 1px solid #e5e7eb;
          border-radius: 999px;
          padding: 0.125rem 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: #334155;
          background: #fff;
        }
        .desc {
          margin: 0.25rem 0 0;
          color: #374151;
          line-height: 1.4;
          font-size: 0.9375rem;
        }
        .desc.muted {
          color: #9ca3af;
          font-style: italic;
        }
        .foot {
          color: #6b7280;
          font-size: 0.8125rem;
        }
        .hint {
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          padding: 0.125rem 0.375rem;
          border-radius: 0.375rem;
        }
      </style>
    </template>
  };

  // ⁷ Embedded format (compact row)
  static embedded = class Embedded extends Component<typeof AdventureScenario> {
    <template>
      <div class='scenario-emb'>
        <div class='row'>
          <strong class='title'>{{if
              @model.title
              @model.title
              'Unnamed Scenario'
            }}</strong>
          <div class='tags'>
            {{#if (Number @model.tags.length)}}
              {{#each @model.tags as |t|}}<span
                  class='tag subtle'
                >{{t}}</span>{{/each}}
            {{/if}}
          </div>
        </div>
        {{#if @model.description}}<div
            class='one-line'
          >{{@model.description}}</div>{{/if}}
      </div>

      <style scoped>
        .scenario-emb {
          display: grid;
          gap: 0.25rem;
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .title {
          color: #111827;
        }
        .tags {
          display: inline-flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .tag {
          border: 1px solid #e5e7eb;
          border-radius: 999px;
          padding: 0.125rem 0.5rem;
          font-size: 0.75rem;
          color: #374151;
          background: #fff;
          white-space: nowrap;
        }
        .tag.subtle {
          color: #6b7280;
        }
        .one-line {
          color: #6b7280;
          font-size: 0.875rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof AdventureScenario> {
    <template>
      <div class='fit'>
        <div class='badge'>
          <div class='dot'></div>
          <div class='lbl'>
            <div class='t'>{{if @model.title @model.title 'Scenario'}}</div>
          </div>
        </div>

        <div class='strip'>
          <div class='main'>
            <div class='t'>{{if @model.title @model.title 'Scenario'}}</div>
            {{#if @model.description}}<div
                class='s'
              >{{@model.description}}</div>{{/if}}
          </div>

        </div>

        <div class='tile'>
          <h4 class='t'>{{if @model.title @model.title 'Scenario'}}</h4>

          {{#if @model.description}}<p
              class='p'
            >{{@model.description}}</p>{{/if}}
        </div>

        <div class='card'>
          <div class='h'>
            <h3 class='t'>{{if @model.title @model.title 'Scenario'}}</h3>

          </div>
          {{#if @model.description}}<div
              class='p'
            >{{@model.description}}</div>{{/if}}
        </div>
      </div>

      <style scoped>
        .fit {
          container-type: size;
          width: 100%;
          height: 100%;
        }
        .badge,
        .strip,
        .tile,
        .card {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        @container (max-width:150px) and (max-height:169px) {
          .badge {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
        }
        @container (min-width:151px) and (max-height:169px) {
          .strip {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
        }
        @container (max-width:399px) and (min-height:170px) {
          .tile {
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
          }
        }
        @container (min-width:400px) and (min-height:170px) {
          .card {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
        }

        .dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          background: #10b981;
        }
        .lbl .t {
          font-size: 0.875rem;
          font-weight: 700;
          color: #111827;
        }
        .lbl .s {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .main {
          flex: 1;
          min-width: 0;
        }
        .strip .t {
          font-size: 0.875rem;
          font-weight: 600;
          color: #111827;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .strip .s {
          font-size: 0.75rem;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .strip .r {
          font-size: 0.75rem;
          color: #374151;
        }

        .tile .t {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
        }
        .tile .chip {
          background: #eef2ff;
          color: #4338ca;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          width: max-content;
        }
        .tile .p {
          margin: 0;
          color: #6b7280;
          font-size: 0.8125rem;
          line-height: 1.3;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .card .h {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.5rem;
        }
        .card .t {
          margin: 0;
          font-size: 1.0625rem;
          font-weight: 700;
          color: #111827;
        }
        .card .meta {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .chip {
          border: 1px solid #e5e7eb;
          border-radius: 999px;
          padding: 0.125rem 0.5rem;
          font-size: 0.75rem;
          color: #374151;
          background: #fff;
        }
        .chip.subtle {
          color: #6b7280;
        }
        .card .p {
          color: #4b5563;
          font-size: 0.875rem;
          line-height: 1.35;
        }
      </style>
    </template>
  };
}
