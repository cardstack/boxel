import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ClipboardCheckIcon from '@cardstack/boxel-icons/clipboard-check';
import { Survey } from './survey';

export class SurveyAnswer extends FieldDef {
  static displayName = 'Survey Answer';
  @field prompt = contains(StringField);
  @field response = contains(StringField);
}

export class SurveyResponse extends CardDef {
  static displayName = 'Survey Response';
  static icon = ClipboardCheckIcon;

  // Real link to the survey (live — reflects later title changes). surveyId is a
  // denormalized copy used for reliable querying; surveyTitle is a display
  // snapshot fallback for when the linked survey can't be loaded.
  @field survey = linksTo(() => Survey, { searchable: true });
  @field surveyId = contains(StringField);
  @field surveyTitle = contains(StringField);
  @field answers = containsMany(SurveyAnswer);

  @field title = contains(StringField, {
    computeVia: function (this: SurveyResponse) {
      let name = this.survey?.title ?? this.surveyTitle;
      return name ? `Response: ${name}` : 'Survey Response';
    },
  });

  static embedded = class Embedded extends Component<typeof SurveyResponse> {
    <template>
      <article class='resp'>
        <header class='resp-head'>
          <span class='resp-eyebrow'>Response</span>
          <h3 class='resp-title'>
            {{if @model.surveyTitle @model.surveyTitle 'Survey'}}
          </h3>
        </header>
        <dl class='resp-list'>
          {{#each @model.answers as |a|}}
            <div class='resp-row'>
              <dt>{{if a.prompt a.prompt 'Question'}}</dt>
              <dd>{{if a.response a.response '—'}}</dd>
            </div>
          {{/each}}
        </dl>
      </article>
      <style scoped>
        .resp {
          padding: var(--boxel-sp, 1rem);
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          color: var(--foreground, var(--boxel-dark));
          font-family: var(
            --font-sans,
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif
          );
        }
        .resp-eyebrow {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--primary, var(--boxel-highlight));
        }
        .resp-title {
          margin: 0.1rem 0 0;
          font-size: 1.1rem;
          font-weight: 700;
        }
        .resp-list {
          margin: 0;
          display: grid;
          gap: 0.4rem;
        }
        .resp-row {
          display: grid;
          gap: 0.1rem;
          padding-bottom: 0.4rem;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .resp-row dt {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .resp-row dd {
          margin: 0;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof SurveyResponse> {
    get count(): number {
      return this.args.model?.answers?.length ?? 0;
    }
    <template>
      <div class='resp-fitted'>
        <span class='resp-fitted-eyebrow'>Response</span>
        <span class='resp-fitted-title'>{{if
            @model.surveyTitle
            @model.surveyTitle
            'Survey'
          }}</span>
        <span class='resp-fitted-count'>{{this.count}} answers</span>
      </div>
      <style scoped>
        .resp-fitted {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.2rem;
          overflow: hidden;
          font-family: var(
            --font-sans,
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif
          );
          color: var(--foreground, var(--boxel-dark));
        }
        .resp-fitted-eyebrow {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--primary, var(--boxel-highlight));
        }
        .resp-fitted-title {
          font-size: 0.95rem;
          font-weight: 800;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .resp-fitted-count {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
