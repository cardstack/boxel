import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateTimeField from 'https://cardstack.com/base/datetime';
import ClipboardListIcon from '@cardstack/boxel-icons/clipboard-list';
import { SurveyQuestion } from './survey-question';
import { SurveyIsolated } from './components/survey/isolated-template';
import { EditSectionNav } from './components/edit-section-nav';
import { SurveyFitted } from './components/survey/fitted-template';

export class Survey extends CardDef {
  static displayName = 'Survey';
  static icon = ClipboardListIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field questions = containsMany(SurveyQuestion);

  @field questionCount = contains(NumberField, {
    computeVia: function (this: Survey) {
      return this.questions?.length ?? 0;
    },
  });

  // ---- Added for Publish Survey (additive only) ---------------------------
  // Event fact, not a flag: PublishSurveyCommand writes this once and it is
  // monotonic — `isPublished` derives from it, so the boolean can never
  // drift from the event that made it true.
  @field publishedAt = contains(DateTimeField);

  @field isPublished = contains(BooleanField, {
    computeVia: function (this: Survey) {
      return Boolean(this.publishedAt);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Survey) {
      return this.cardInfo?.name ?? this.title ?? 'Survey';
    },
  });

  // The form for authoring a survey: name it and frame it, then write the
  // questions. `questionCount`, `isPublished`, and `cardTitle` are computed
  // and never appear here; `publishedAt` is an event fact written once by
  // PublishSurveyCommand, exposed only with a warning hint. Two sections
  // tracked by a left anchor rail (EditSectionNav).
  static edit = class Edit extends Component<typeof this> {
    @tracked activeSection = 'survey';

    sections = [
      { id: 'survey', label: 'Survey' },
      { id: 'questions', label: 'Questions' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.survey-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='survey-edit'>
        {{! the container element cannot be restyled by its own query
            (edit-card Rule 1 corollary) — responsive layout lives inside }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
          <section
            class='sect {{if (eq this.activeSection "survey") "focused"}}'
            data-sect='survey'
          >
            <h3>Survey</h3>
            <FieldContainer @label='Title' @vertical={{true}}>
              <@fields.title />
            </FieldContainer>
            <FieldContainer
              @label='Description (shown to respondents)'
              @vertical={{true}}
            >
              <@fields.description />
            </FieldContainer>
            <FieldContainer
              @label='Published at (stamped once by the Publish command — edit only to correct)'
              @vertical={{true}}
            >
              <@fields.publishedAt />
            </FieldContainer>
          </section>

          <section
            class='sect {{if (eq this.activeSection "questions") "focused"}}'
            data-sect='questions'
          >
            <h3>Questions
              <span class='sect-hint'>respondents see them in this order</span></h3>
            <FieldContainer @label='Questions' @vertical={{true}}>
              <@fields.questions />
            </FieldContainer>
          </section>
          </div>
        </div>
      </div>
      <style scoped>
        .survey-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* the root is the scroller, so sticky pins the nav to its top */
        .sect-nav {
          position: sticky;
          top: 0;
        }
        .sects {
          display: grid;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        /* the section the rail points at mirrors the rail's active state */
        .sect.focused {
          outline-color: var(--foreground, var(--boxel-dark));
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--foreground, var(--boxel-dark)) 10%, transparent);
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        @container edit (width < 640px) {
          .edit-body {
            grid-template-columns: 1fr;
          }
          .sect-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
          }
          .sect-nav::before {
            display: none;
          }
        }
      </style>
    </template>
  };
}

Survey.isolated = SurveyIsolated;
Survey.fitted = SurveyFitted;
