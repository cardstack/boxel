import {
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { get, array } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

export class QuizQuestionField extends FieldDef {
  static displayName = 'Quiz Question';

  @field question = contains(StringField);
  @field choices = containsMany(StringField);
  @field correctAnswer = contains(StringField);

  static embedded = class Embedded extends Component<typeof QuizQuestionField> {
    <template>
      <div class='quiz-question-field'>
        <div class='question-text'>{{@model.question}}</div>
        <div class='choices-preview'>
          {{#each @model.choices as |choice index|}}
            <div class='choice-preview'>
              {{get (array 'A' 'B' 'C' 'D') index}}
              {{choice}}
              {{#if
                (eq (get (array 'A' 'B' 'C' 'D') index) @model.correctAnswer)
              }}
                ✓
              {{/if}}
            </div>
          {{/each}}
        </div>
      </div>

      <style scoped>
        .quiz-question-field {
          padding: 0.75rem;
          background: #0f172a;
          border-radius: 6px;
          font-size: 0.8125rem;
          border: 1px solid rgba(148, 163, 184, 0.2);
        }

        .question-text {
          font-weight: 700;
          margin-bottom: 0.5rem;
          color: #e2e8f0;
        }

        .choice-preview {
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 0.25rem;
        }
      </style>
    </template>
  };
}
