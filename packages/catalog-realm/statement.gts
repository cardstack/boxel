import { eq } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

// Position field to define where a statement appears relative to another
class PositionField extends FieldDef {
  static displayName = 'Position';

  @field referenceId = contains(StringField);
  @field type = contains(StringField); // 'inside' or 'follow'

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='position-info'>
        {{if @model.type @model.type 'follow'}}
        {{if @model.referenceId @model.referenceId}}
      </span>
    </template>
  };
}

export class Statement extends CardDef {
  static displayName = 'Statement';

  @field reference = contains(StringField);
  @field topicName = contains(StringField);
  @field content = contains(MarkdownField);
  @field position = contains(PositionField);

  @field title = contains(StringField, {
    computeVia: function (this: Statement) {
      return this.topicName || this.reference || 'Untitled Statement';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='statement-card'>
        <div class='statement-header'>
          <h3 class='statement-title'>
            {{if @model.topicName @model.topicName 'Untitled'}}
          </h3>
          {{#if @model.reference}}
            <span class='statement-reference'>{{@model.reference}}</span>
          {{/if}}
        </div>

        {{#if @model.content}}
          <div class='statement-content'>
            <@fields.content />
          </div>
        {{else}}
          <div class='empty-content'>No content provided</div>
        {{/if}}

        {{#if @model.position}}
          <div class='statement-position'>
            <svg
              class='position-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='9 18 15 12 9 6' />
            </svg>
            <span>
              {{if (eq @model.position.type 'inside') 'Inside' 'After'}}
              {{if
                @model.position.referenceId
                @model.position.referenceId
                'root'
              }}
            </span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .statement-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          padding: 1.5rem;
          transition: all 0.2s;
        }

        .statement-card:hover {
          border-color: #6366f1;
          box-shadow: 0 4px 6px rgba(99, 102, 241, 0.1);
        }

        .statement-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .statement-title {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: #0f172a;
          flex: 1;
        }

        .statement-reference {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6366f1;
          background: #eef2ff;
          padding: 0.25rem 0.625rem;
          border-radius: 0.375rem;
          font-family: 'JetBrains Mono', monospace;
        }

        .statement-content {
          font-size: 0.9375rem;
          line-height: 1.6;
          color: #475569;
        }

        .empty-content {
          font-size: 0.875rem;
          color: #94a3b8;
          font-style: italic;
        }

        .statement-position {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
          font-size: 0.8125rem;
          color: #64748b;
        }

        .position-icon {
          width: 1rem;
          height: 1rem;
          color: #94a3b8;
        }
      </style>
    </template>
  };
}
