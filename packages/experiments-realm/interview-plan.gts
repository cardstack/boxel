import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import MarkdownField from '@cardstack/base/markdown';
import ListChecksIcon from '@cardstack/boxel-icons/list-checks';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';

import { InterviewRoundField } from './interview-round-field';
import { Position } from './position';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

// Colocated with InterviewPlanRoundField — colors each round's pill in the
// isolated plan list and the embedded/compact previews. Distinct hues from
// CANDIDATE_STAGE_COLORS/MEETING_TYPE_COLORS (this classifies a PLAN round's
// content, not a candidate's stage or a meeting's type), but the same
// stateColor()/stateColorOf() machinery from utils/index.
export const INTERVIEW_ROUND_COLORS: Record<string, StateColor> = {
  'phone-screen': stateColor('green'),
  technical: stateColor('purple'),
  onsite: stateColor('blue'),
  panel: stateColor('teal'),
  final: stateColor('orange'),
};

function questionsPreview(markdown?: string | null): string {
  if (!markdown) {
    return '';
  }
  let plain = markdown
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 140 ? `${plain.slice(0, 140)}…` : plain;
}

// One round's worth of interview content — which stage of the loop
// (InterviewRoundField, reused from meeting.gts's Meeting.roundType so the
// same vocabulary classifies both a scheduled Meeting and a plan's round)
// paired with the markdown question set for that stage. See
// GenerateInterviewQuestionsCommand for how these get created/upserted, and
// Meeting.interviewPlanRound for how a scheduled interview looks its own
// round's questions back up here.
export class InterviewPlanRoundField extends FieldDef {
  static displayName = 'Interview Plan Round';

  @field roundType = contains(InterviewRoundField);
  @field questions = contains(MarkdownField);

  static embedded = class Embedded extends Component<typeof this> {
    get pillStyle() {
      let c = stateColorOf(INTERVIEW_ROUND_COLORS, this.args.model?.roundType);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    get preview(): string {
      return questionsPreview(this.args.model?.questions);
    }
    <template>
      <div class='ipr-row'>
        <div class='ipr-top'>
          {{#if @model.roundType}}
            <span class='ipr-pill' style={{this.pillStyle}}>
              <span class='ipr-dot'></span>{{@model.roundType}}
            </span>
          {{else}}
            <span class='ipr-empty'>No round type set</span>
          {{/if}}
        </div>
        {{#if @model.questions}}
          <p class='ipr-preview'>{{this.preview}}</p>
        {{else}}
          <p class='ipr-empty'>No questions written yet.</p>
        {{/if}}
      </div>
      <style scoped>
        .ipr-row {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .ipr-top {
          display: flex;
          align-items: center;
        }
        .ipr-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .ipr-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .ipr-preview {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ipr-empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

// A structured set of interview questions for one Position, organized into
// rounds (InterviewPlanRoundField). Array order IS the loop order — there is
// no separate integer `order` field, so reordering the `rounds` array (via
// the move up/down controls in the isolated view) is the only mechanism for
// resequencing the loop.
export class InterviewPlan extends CardDef {
  static displayName = 'Interview Plan';
  static icon = ListChecksIcon;

  @field position = linksTo(() => Position);
  @field rounds = containsMany(InterviewPlanRoundField);
  @field createdDate = contains(DateField);

  @field title = contains(StringField, {
    computeVia: function (this: InterviewPlan) {
      let positionTitle = this.position?.title;
      return positionTitle
        ? `Interview Plan — ${positionTitle}`
        : 'Untitled Interview Plan';
    },
  });

  @field roundTally = contains(StringField, {
    computeVia: function (this: InterviewPlan) {
      let n = this.rounds?.length ?? 0;
      return n === 0 ? '' : String(n);
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked reorderError: string | undefined;

    isFirst = (index: number): boolean => index === 0;
    isLast = (index: number): boolean => {
      let n = this.args.model?.rounds?.length ?? 0;
      return index === n - 1;
    };

    indexLabel = (index: number): number => index + 1;

    moveRound = (index: number, direction: -1 | 1) => {
      void this.moveRoundTask(index, direction);
    };

    private moveRoundTask = async (index: number, direction: -1 | 1) => {
      let model = this.args.model;
      let rounds = model?.rounds ?? [];
      let target = index + direction;
      if (!model || target < 0 || target >= rounds.length) {
        return;
      }
      let reordered = rounds.slice();
      [reordered[index], reordered[target]] = [
        reordered[target],
        reordered[index],
      ];
      model.rounds = reordered;

      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        return;
      }
      this.reorderError = undefined;
      try {
        await new SaveCardCommand(commandContext).execute({ card: model });
      } catch (error: any) {
        this.reorderError = error?.message ?? String(error);
      }
    };

    <template>
      <article class='interview-plan-isolated'>
        <header class='hero'>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{#if @model.createdDate}}
                created
                <@fields.createdDate />
              {{else}}
                Not yet created
              {{/if}}
              <span class='sep-dot'>&middot;</span>
              {{if @model.roundTally @model.roundTally '0'}}
              round{{unless (eq @model.roundTally '1') 's'}}
            </p>
          </div>
        </header>

        <div class='body'>
          <h2 class='panel-title'>Interview loop</h2>
          {{#if @model.rounds.length}}
            <ol class='rounds'>
              {{#each @fields.rounds as |RoundComponent index|}}
                <li class='round'>
                  <span class='round-index'>{{this.indexLabel index}}</span>
                  <div class='round-body'>
                    <RoundComponent />
                  </div>
                  <div class='round-actions'>
                    <button
                      type='button'
                      class='reorder'
                      aria-label='Move round up'
                      disabled={{this.isFirst index}}
                      {{on 'click' (fn this.moveRound index -1)}}
                    >&uarr;</button>
                    <button
                      type='button'
                      class='reorder'
                      aria-label='Move round down'
                      disabled={{this.isLast index}}
                      {{on 'click' (fn this.moveRound index 1)}}
                    >&darr;</button>
                  </div>
                </li>
              {{/each}}
            </ol>
          {{else}}
            <p class='empty'>No rounds added yet. Running Generate questions
              from a candidate linked to this position will create the first
              round.</p>
          {{/if}}
          {{#if this.reorderError}}
            <p class='reorder-error' role='alert'>{{this.reorderError}}</p>
          {{/if}}

          <h2 class='panel-title spaced'>Position</h2>
          <dl class='facts stacked'>
            <dt>Requisition</dt>
            <dd>{{#if @model.position}}<@fields.position
                  @format='atom'
                  @displayContainer={{false}}
                />{{else}}&mdash; not linked{{/if}}</dd>
          </dl>
        </div>
      </article>
      <style scoped>
        .interview-plan-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --ip-id: var(--primary, var(--boxel-highlight));
          --ip-strong: color-mix(
            in oklch,
            var(--ip-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .hero {
          flex: none;
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .body {
          padding: var(--boxel-sp-lg);
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        .rounds {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .round {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .round:last-child {
          border-bottom: 0;
        }
        .round-index {
          flex: none;
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          background: var(--ip-strong);
          color: var(--background, var(--boxel-light));
        }
        .round-body {
          flex: 1;
          min-width: 0;
        }
        .round-actions {
          flex: none;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .reorder {
          min-width: 1.75rem;
          min-height: 1.75rem;
          padding: 0.2rem 0.4rem;
          border-radius: var(--boxel-border-radius-sm);
          border: 1px solid var(--border, var(--boxel-200));
          background: var(--card, var(--boxel-light));
          color: var(--ip-strong);
          font: inherit;
          font-size: var(--boxel-font-size-sm);
          cursor: pointer;
        }
        .reorder:focus-visible {
          outline: 2px solid var(--ring, var(--ip-strong));
          outline-offset: 2px;
        }
        .reorder:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .reorder-error {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-xs);
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 38%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding-top: 0.4rem;
        }
        .facts dd {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='interview-plan-embedded'>
        <span class='ipe-icon'><ListChecksIcon class='ipe-icon-svg' /></span>
        <div class='ipe-main'>
          <span class='ipe-title'>{{@model.title}}</span>
          <span class='ipe-sub'>{{if
              @model.roundTally
              @model.roundTally
              '0'
            }}
            round{{unless (eq @model.roundTally '1') 's'}}</span>
        </div>
      </div>
      <style scoped>
        .interview-plan-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .ipe-icon {
          display: inline-flex;
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ipe-icon-svg {
          width: 14px;
          height: 14px;
        }
        .ipe-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .ipe-title {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ipe-sub {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='interview-plan-atom'>
        <ListChecksIcon class='interview-plan-atom-icon' />
        <span class='interview-plan-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .interview-plan-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .interview-plan-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .interview-plan-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <div class='fit-top'>
          <span class='fit-icon'><ListChecksIcon /></span>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.roundTally}}
              <span class='fit-eb'>{{@model.roundTally}}
                round{{unless (eq @model.roundTally '1') 's'}}</span>
            {{/if}}
          </div>
        </div>
      </article>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .fit-icon {
          flex: none;
          display: inline-flex;
          width: 1.4rem;
          height: 1.4rem;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-icon svg {
          width: 12px;
          height: 12px;
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }
      </style>
    </template>
  };
}
