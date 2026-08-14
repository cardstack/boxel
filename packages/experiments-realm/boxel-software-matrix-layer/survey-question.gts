import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import enumField from 'https://cardstack.com/base/enum';

export const QuestionKindField = enumField(StringField, {
  displayName: 'Question Kind',
  options: [
    { value: 'short-text', label: 'Short text' },
    { value: 'long-text', label: 'Long text' },
    { value: 'single-choice', label: 'Single choice' },
    { value: 'multi-choice', label: 'Multiple choice' },
    { value: 'rating', label: 'Rating (1–5)' },
    { value: 'yes-no', label: 'Yes / No' },
  ],
});

export class SurveyQuestion extends FieldDef {
  static displayName = 'Survey Question';

  @field prompt = contains(StringField);
  @field helpText = contains(StringField);
  @field kind = contains(QuestionKindField);
  @field options = containsMany(StringField);
  @field required = contains(BooleanField);

  @field title = contains(StringField, {
    computeVia: function (this: SurveyQuestion) {
      return this.prompt ?? 'Untitled question';
    },
  });

  static embedded = class Embedded extends Component<typeof SurveyQuestion> {
    get usesOptions(): boolean {
      return (
        this.args.model.kind === 'single-choice' ||
        this.args.model.kind === 'multi-choice'
      );
    }
    <template>
      <div class='sq-row'>
        <span class='sq-kind'><@fields.kind /></span>
        <div class='sq-main'>
          <span class='sq-prompt'>
            {{if @model.prompt @model.prompt 'Untitled question'}}
            {{#if @model.required}}<span
                class='sq-req'
                title='Required'
              >*</span>{{/if}}
          </span>
          {{#if @model.helpText}}
            <span class='sq-help'>{{@model.helpText}}</span>
          {{/if}}
          {{#if this.usesOptions}}
            <span class='sq-options'>{{#each @model.options as |opt|}}<span
                  class='sq-opt'
                >{{opt}}</span>{{/each}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .sq-row {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: var(--boxel-sp-sm);
          align-items: start;
          padding: var(--boxel-sp-xs) 0;
        }
        .sq-kind {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, var(--boxel-450));
          background: var(--muted, var(--boxel-100));
          border-radius: 999px;
          padding: 0.1rem 0.5rem;
          white-space: nowrap;
        }
        .sq-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .sq-prompt {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .sq-req {
          color: var(--destructive, var(--boxel-danger));
          margin-left: 0.15rem;
        }
        .sq-help {
          font-size: var(--boxel-font-size-sm, 0.8125rem);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sq-options {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
          margin-top: 0.15rem;
        }
        .sq-opt {
          font-size: 0.75rem;
          color: var(--foreground, var(--boxel-dark));
          background: var(--secondary, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 0.375rem;
          padding: 0.05rem 0.4rem;
        }
      </style>
    </template>
  };
}
