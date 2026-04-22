import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { FieldContainer } from '@cardstack/boxel-ui/components';

export class IssueOptionField extends FieldDef {
  static displayName = 'Issue Option';
  @field value = contains(StringField);
  @field label = contains(StringField);

  static edit = class Edit extends Component<typeof IssueOptionField> {
    <template>
      <div class='option-edit'>
        <FieldContainer @label='Label' @vertical={{true}}>
          <@fields.label />
        </FieldContainer>
        <FieldContainer @label='ID' @vertical={{true}}>
          <@fields.value />
        </FieldContainer>
      </div>
      <style scoped>
        .option-edit {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: var(--boxel-sp);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof IssueOptionField> {
    <template>
      <span class='option-item'>
        <span class='option-label'>{{if @model.label @model.label '—'}}</span>
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
