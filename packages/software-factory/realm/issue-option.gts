import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import ColorField from 'https://cardstack.com/base/color';
import StringField from 'https://cardstack.com/base/string';

import { FieldContainer } from '@cardstack/boxel-ui/components';
import { StatusPill } from './status-pill';

export class IssueOptionField extends FieldDef {
  static displayName = 'Issue Option';
  @field value = contains(StringField);
  @field label = contains(StringField);
  @field color = contains(ColorField);

  static edit = class Edit extends Component<typeof IssueOptionField> {
    <template>
      <div class='option-edit'>
        <div class='option-preview'>
          <span class='option-preview-label'>Preview</span>
          <div class='option-preview-card'>
            {{#if @model.color}}
              <StatusPill @color={{@model.color}}>
                {{if @model.label @model.label 'Untitled option'}}
              </StatusPill>
            {{else}}
              <span class='option-preview-name'>{{if
                  @model.label
                  @model.label
                  'Untitled option'
                }}</span>
            {{/if}}
          </div>
        </div>

        <FieldContainer
          class='option-edit-field'
          @label='Label'
          @vertical={{true}}
        >
          <@fields.label />
        </FieldContainer>
        <FieldContainer
          class='option-edit-field'
          @label='ID'
          @vertical={{true}}
        >
          <@fields.value />
        </FieldContainer>
        <FieldContainer
          class='option-edit-field'
          @label='Color'
          @vertical={{true}}
        >
          <@fields.color />
        </FieldContainer>
      </div>
      <style scoped>
        .option-edit {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
          gap: var(--boxel-sp);
        }
        .option-preview {
          grid-column: 1 / -1;
          display: grid;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--boxel-border-color, var(--border));
          border-radius: var(--boxel-border-radius-lg);
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--background) 96%, var(--foreground)),
            var(--background)
          );
        }
        .option-preview-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .option-preview-card {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          min-height: 2rem;
        }
        .option-preview-name {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground);
        }
        .option-preview-value {
          font-size: 0.75rem;
          color: var(--muted-foreground);
        }
        .option-edit-field {
          min-width: 0;
        }
        @media (max-width: 40rem) {
          .option-edit {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof IssueOptionField> {
    <template>
      <span class='option-item'>
        {{#if @model.color}}
          <StatusPill @color={{@model.color}}>
            {{if @model.label @model.label '—'}}
          </StatusPill>
        {{else}}
          <span class='option-label'>{{if @model.label @model.label '—'}}</span>
        {{/if}}
        <span class='option-value'>{{@model.value}}</span>
      </span>
      <style scoped>
        .option-item {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: 0.8125rem;
        }
        .option-label {
          font-weight: 500;
          color: var(--foreground);
        }
        .option-value {
          font-size: 0.75rem;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
