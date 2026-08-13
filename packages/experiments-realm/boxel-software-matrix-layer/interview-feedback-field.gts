import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import MessageSquareIcon from '@cardstack/boxel-icons/message-square';

import { Employee } from './employee';

export class InterviewFeedbackField extends FieldDef {
  static displayName = 'Interview Feedback';
  static icon = MessageSquareIcon;

  @field interviewer = linksTo(() => Employee);
  @field interviewDate = contains(DateField);
  @field rating = contains(NumberField, {
    description: 'Interviewer score, 1-5',
  });
  @field notes = contains(TextAreaField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='feedback-row'>
        <div class='feedback-head'>
          <span class='interviewer'>{{if
              @model.interviewer.name
              @model.interviewer.name
              'Unknown interviewer'
            }}</span>
          {{#if @model.rating}}
            <span class='rating'>&#9733; {{@model.rating}}/5</span>
          {{/if}}
        </div>
        {{#if @model.notes}}
          <p class='notes'>{{@model.notes}}</p>
        {{/if}}
      </div>
      <style scoped>
        .feedback-row {
          padding: var(--boxel-sp-sm) 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .feedback-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .interviewer {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
        }
        .rating {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          font-weight: 600;
        }
        .notes {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.5;
        }
      </style>
    </template>
  };
}
