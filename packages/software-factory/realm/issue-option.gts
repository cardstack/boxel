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
  @field value = contains(StringField);
  @field label = contains(StringField);
  @field color = contains(ColorField);

  static edit = class Edit extends Component<typeof IssueOptionField> {
    <template>
      <div class='option-edit'>
        <div class='option-edit-row'>
          {{#if @model.color}}
            <FieldContainer
              class='option-edit-field preview-field'
              @label='Preview'
              @vertical={{true}}
            >
              <StatusPill @color={{@model.color}}>
                {{if @model.label @model.label '…'}}
              </StatusPill>
            </FieldContainer>
          {{/if}}
          <FieldContainer
            class='option-edit-field'
            @label='Label'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.label />
            <em>Required</em>
          </FieldContainer>
          <FieldContainer
            class='option-edit-field'
            @label='ID'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.value />
            <em>Required</em>
          </FieldContainer>
          <FieldContainer
            class='option-edit-field'
            @label='Color'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.color />
          </FieldContainer>
        </div>
      </div>
      <style scoped>
        .option-edit {
          container-type: inline-size;
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .option-edit-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--boxel-sp-xs);
          align-items: start;
        }
        .option-edit-field {
          min-width: 0;
          overflow: hidden;
          --boxel-field-label-font-size: 0.6875rem;
        }
        .option-edit-field em {
          opacity: 0.6;
          font-size: 0.75rem;
        }
        @container (width < 48rem) {
          .option-edit-row {
            grid-template-columns: repeat(3, 1fr);
          }
          .preview-field {
            grid-column: -1 / 1;
          }
        }
        @container (width < 26rem) {
          .option-edit-row {
            grid-template-columns: repeat(2, 1fr);
          }
          .preview-field {
            grid-column: 1;
          }
        }
        @container (width < 18rem) {
          .option-edit-row {
            grid-template-columns: 1fr;
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
