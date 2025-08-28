import { add } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import {
  contains,
  containsMany,
  linksTo,
  field,
  CardDef,
  FieldDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import TextAreaField from 'https://cardstack.com/base/text-area';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import { Skill } from 'https://cardstack.com/base/skill';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import SetActiveLLMCommand from '@cardstack/boxel-host/commands/set-active-llm';

class GradeField extends FieldDef {
  @field overallGrade = contains(StringField);
  @field overallFeedback = contains(MarkdownField);
  @field questionPoints = containsMany(NumberField);

  @field overallPoints = contains(NumberField, {
    computeVia: function (this: GradeField) {
      return this.questionPoints.reduce((acc, num) => acc + (num || 0), 0);
    },
  });

  static embedded = class Embedded extends Component<typeof GradeField> {
    get gradeColor() {
      const grade = this.args.model?.overallGrade?.toUpperCase();
      if (!grade) return '#6b7280';

      switch (grade) {
        case 'A':
          return '#059669'; // Green for A grades
        case 'B':
          return '#0891b2'; // Blue for B grades
        case 'C':
          return '#d97706'; // Orange for C grades
        case 'D':
          return '#dc2626'; // Red for D grades
        case 'E':
          return '#dc2626'; // Red for E grades (same as D)
        case 'F':
          return '#991b1b'; // Dark red for F
        default:
          return '#6b7280'; // Gray for unknown grades
      }
    }

    <template>
      <div class='grade-display'>
        <div class='grade-layout'>
          {{#if @model.overallGrade}}
            <div class='grade-column'>
              <span
                class='grade-value grade-{{@model.overallGrade}}'
              >{{@model.overallGrade}}</span>
            </div>
          {{/if}}

          <div class='details-column'>
            {{#if @model.overallPoints}}
              <div class='points-section'>
                <span class='points-label'>Total Points:</span>
                <span class='points-value'>{{@model.overallPoints}}</span>
              </div>
            {{/if}}

            {{#if @model.overallFeedback}}
              <div class='feedback-section'>
                <span class='feedback-label'>Feedback:</span>
                <div class='feedback-content'>
                  <@fields.overallFeedback />
                </div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .grade-display {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1.25rem;
          background: #f9fafb;
          border-radius: 0.75rem;
          border: 1px solid #d1d5db;
        }

        .grade-layout {
          display: flex;
          align-items: flex-start;
          gap: 1.5rem;
        }

        .grade-column {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        .details-column {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          flex: 1;
        }

        .points-section {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0;
        }

        .feedback-section {
          display: flex;
          gap: 0.75rem;
          padding: 0.5rem 0;
        }

        .feedback-content {
          flex: 1;
          line-height: 1.5;
        }

        .feedback-content :deep(.markdown-content h3),
        .feedback-content :deep(.markdown-content h4),
        .feedback-content :deep(.markdown-content p) {
          margin-top: 0;
        }

        .grade-label,
        .points-label,
        .feedback-label {
          font-weight: 700;
          color: #374151;
          font-size: 1.2rem;
          white-space: nowrap;
          min-width: fit-content;
          width: 120px;
        }

        .grade-value {
          font-size: 1.75rem;
          font-weight: bold;
          width: 3rem;
          height: 3rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.125rem 0.5rem;
          border-radius: 50%;
          color: white;
        }

        .grade-A {
          background: #059669;
        }

        .grade-B {
          background: #0891b2;
        }

        .grade-C {
          background: #d97706;
        }

        .grade-D {
          background: #dc2626;
        }

        .grade-E {
          background: #dc2626;
        }

        .grade-F {
          background: #991b1b;
        }

        .points-value {
          font-weight: 700;
          color: #4338ca;
          font-size: 1.125rem;
          padding: 0.125rem 0.5rem;
          background: #e0e7ff;
          border-radius: 0.375rem;
        }
      </style>
    </template>
  };
}

class QuestionField extends FieldDef {
  static displayName = 'Question';

  @field title = contains(StringField);
  @field questionText = contains(MarkdownField);
  @field answer = contains(MarkdownField);
  @field maxPoints = contains(NumberField);

  @field isAnswered = contains(StringField, {
    computeVia: function (this: QuestionField) {
      return this.answer?.length > 0;
    },
  });

  static isolated = class Isolated extends Component<typeof QuestionField> {
    <template>
      <div class='question-field'>
        <div class='question-content'>
          <@fields.questionText />
        </div>

        <div class='answer-section'>
          <label>Your Answer:</label>
          <div class='answer-input {{if @model.isAnswered "has-answer"}}'>
            <@fields.answer @format='edit' />
          </div>
        </div>
      </div>
    </template>
  };

  static embedded = class Embedded extends Component<typeof QuestionField> {
    <template>
      <div class='embedded-question'>
        <div class='question-preview'>
          <@fields.questionText />
        </div>
        {{#if @model.answer}}
          <div class='answer-preview'>
            <span class='answer-label'>Answer:</span>
            <span class='answer-text'>{{@model.answer}}</span>
          </div>
        {{/if}}
      </div>
    </template>
  };

  static fitted = class Fitted extends Component<typeof QuestionField> {
    <template>
      <div class='fitted-question'>
        <div class='question-content'>
          <div class='question-header'>
            <span class='title'>{{@model.title}}</span>
          </div>
          <div class='question-text'>
            <@fields.questionText />
          </div>
        </div>
        <div class='answer-section'>
          <@fields.answer @format='edit' />
        </div>
      </div>

      <style scoped>
        .title {
          font-weight: bold;
        }
      </style>
    </template>
  };
}

class HomeworkIsolated extends Component<typeof Homework> {
  @tracked isSubmitting = false;
  @tracked isGrading = false;
  roomId: string | null = null;

  get isComplete() {
    return this.args.model.questions?.every((q) => q.isAnswered) ?? false;
  }

  get maxPoints() {
    if (!this.args.model.questions) return 0;
    return this.args.model.questions.reduce(
      (sum, q) => sum + (q.maxPoints || 0),
      0,
    );
  }

  getPointsDisplay = (questionIndex: number) => {
    const question = this.args.model?.questions?.[questionIndex];
    const maxPoints = question?.maxPoints ?? 5;
    const earnedPoints =
      this.args.model?.grade?.questionPoints?.[questionIndex];

    return {
      earned: earnedPoints ?? 0,
      max: maxPoints,
      hasEarned: earnedPoints !== undefined && earnedPoints !== null,
      showEarned: earnedPoints !== undefined && earnedPoints !== null,
    };
  };

  get hasGrade() {
    return (
      this.args.model.grade?.overallGrade &&
      this.args.model.grade?.questionPoints.length > 0
    );
  }

  setupRoom = async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('In wrong mode');
    }

    if (!this.args.model.gradingSkill) {
      throw new Error('No grading skill is linked');
    }

    if (!this.roomId) {
      let useAiAssistantCommand = new UseAiAssistantCommand(commandContext);
      let result = await useAiAssistantCommand.execute({
        roomName: `Grading: ${this.args.model.title}`,
        openRoom: true,
        skillCards: [this.args.model.gradingSkill],
        attachedCards: [this.args.model as CardDef],
        prompt: 'Please grade this homework assignment.',
      });

      this.roomId = result.roomId;

      let setActiveLLMCommand = new SetActiveLLMCommand(commandContext);
      await setActiveLLMCommand.execute({
        roomId: this.roomId,
        mode: 'act',
      });
    }

    return this.roomId;
  };

  grade = async () => {
    if (this.isGrading) return;

    this.isGrading = true;
    try {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        throw new Error(
          'Command context does not exist. Please switch to Interact Mode',
        );
      }
      if (!this.args.model || !this.args.model.gradingSkill) {
        throw new Error('You need a grading skill to be linked to grade');
      }
      await this.setupRoom();
      if (!this.roomId) {
        throw new Error('Room setup failed');
      }
    } catch (error) {
      console.error('Error grading homework:', error);
      alert('There was an error grading your homework. Please try again.');
    } finally {
      this.isGrading = false;
    }
  };

  <template>
    <header class='course-header'>
      <div class='course-info'>
        <h2>{{@model.title}}</h2>
        <p class='description'>{{@model.description}}</p>
      </div>
      <div class='header-actions'>
        {{#if @model.gradingSkill}}
          <BoxelButton
            @kind='primary-dark'
            @size='base'
            @loading={{this.isGrading}}
            @disabled={{this.isGrading}}
            {{on 'click' this.grade}}
          >
            {{if
              this.isGrading
              '⏳ Grading...'
              (if this.hasGrade '🔄 Re-grade' '🎯 Grade Homework')
            }}
          </BoxelButton>
        {{/if}}
      </div>
    </header>

    {{#if this.hasGrade}}
      <section class='assessment-data'>
        <@fields.grade />
      </section>
    {{else}}
      <section class='assessment-data'>
        <div class='not-graded-state'>
          <span>📝 Assignment not yet graded</span>
        </div>
      </section>
    {{/if}}

    {{#if @model.instructions}}
      <section class='instructions'>
        <div class='instructions-wrapper'>
          <div class='instructions-header'>
            <h3>📋 Instructions</h3>
            <div class='metadata-item'>
              <label>Max Points</label>
              <span class='value points-value'>{{this.maxPoints}} points</span>
            </div>
          </div>
          <div class='instructions-content'>
            {{@model.instructions}}
          </div>
        </div>
      </section>
    {{/if}}

    <section class='questions-section'>
      <div class='questions-container'>
        {{#each @fields.questions as |Question index|}}
          <div class='question-wrapper'>
            <div class='question-number'>{{add index 1}}</div>
            <div class='question-content'>
              <Question @format='fitted' />
            </div>
            <div class='question-points'>
              {{#let (this.getPointsDisplay index) as |points|}}
                <div class='points-display'>
                  <span class='points-fraction'>
                    {{#if points.showEarned}}{{points.earned}}
                      /
                    {{/if}}{{points.max}}
                  </span>
                  <span class='points-label'>pts</span>
                </div>
              {{/let}}
            </div>
          </div>
        {{/each}}
      </div>
    </section>

    <style scoped>
      .course-header {
        background: #f9fafb;
        padding: 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 2rem;
      }

      .course-info h2 {
        font-size: 1.875rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 0.5rem 0;
      }

      .description {
        font-size: 1rem;
        color: #4b5563;
        margin: 0;
        line-height: 1.5;
      }

      .assessment-data {
        background: white;
        border-radius: 0.5rem;
        padding: 1rem;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
      }

      .not-graded-state {
        text-align: center;
        padding: 1rem;
        color: #6b7280;
        font-style: italic;
        background: #f9fafb;
        border-radius: 0.375rem;
        border: 2px dashed #d1d5db;
      }

      .header-actions {
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }

      .instructions {
        padding: 1rem;
      }

      .instructions-wrapper {
        background: #fef3c7;
        border: 1px solid #f59e0b;
        border-radius: 0.5rem;
        border-left: 4px solid #f59e0b;
        overflow: hidden;
      }

      .instructions-header {
        background: #fbbf24;
        border-bottom: 1px solid #f59e0b;
        padding: 0.75rem 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .instructions-header h3 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: #92400e;
      }

      .metadata-item label {
        font-size: 0.875rem;
        font-weight: 600;
        color: #92400e;
      }

      .instructions-content {
        font-size: 0.875rem;
        line-height: 1.5;
        color: #78350f;
        padding: 1rem;
      }

      .questions-section {
        background: white;
        border-radius: 0.5rem;
        padding: 1rem;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
      }

      .questions-container {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .question-wrapper {
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 0.75rem;
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: stretch;
        overflow: hidden;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
      }

      .question-number {
        background: #f9fafb;
        border-right: 1px solid #d1d5db;
        width: 3rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        font-weight: 500;
        color: #6b7280;
      }

      .question-content {
        padding: 1.25rem;
        flex: 1;
        width: 100%;
        height: 100%;
      }

      .question-points {
        background: #f9fafb;
        border-left: 1px solid #e5e7eb;
        padding: 1.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 90px;
      }

      .points-display {
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.375rem 0.5rem;
        background: #f9fafb;
        border: 1px solid #d1d5db;
      }

      .points-fraction {
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        line-height: 1;
      }

      .points-label {
        font-size: 0.75rem;
        color: #9ca3af;
        font-weight: normal;
      }

      @media (max-width: 768px) {
        .metadata-grid {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .question-wrapper {
          grid-template-columns: 1fr;
        }

        .question-number {
          width: 100%;
          height: 2.5rem;
          border-right: none;
          border-bottom: 1px solid #d1d5db;
        }

        .question-points {
          border-left: none;
          border-top: 1px solid #e5e7eb;
        }
      }
    </style>
  </template>
}

class HomeworkFitted extends Component<typeof Homework> {
  get hasGrade() {
    return this.args.model?.grade?.overallGrade;
  }

  get questionsCount() {
    return this.args.model?.questions?.length ?? 0;
  }

  get totalPoints() {
    if (!this.args.model?.grade?.questionPoints) return 0;
    return this.args.model.grade.questionPoints.reduce(
      (sum, points) => sum + (points || 0),
      0,
    );
  }

  get maxPoints() {
    if (!this.args.model?.questions) return 0;
    return this.args.model.questions.reduce(
      (sum, q) => sum + (q.maxPoints || 0),
      0,
    );
  }

  <template>
    <div class='fitted-homework'>
      <header class='homework-header'>
        <h3 class='homework-title'>{{if
            @model.title
            @model.title
            'Untitled Homework'
          }}</h3>
        {{#if this.hasGrade}}
          <div
            class='grade-badge {{@model.grade.overallGrade}}'
          >{{@model.grade.overallGrade}}</div>
        {{else}}
          <div class='grade-badge ungraded'>Not Graded</div>
        {{/if}}
      </header>

      <div class='homework-stats'>
        <div class='stat-item'>
          <span class='stat-label'>Questions:</span>
          <span class='stat-value'>{{this.questionsCount}}</span>
        </div>

        {{#if this.hasGrade}}
          <div class='stat-item'>
            <span class='stat-label'>Score:</span>
            <span
              class='stat-value'
            >{{this.totalPoints}}/{{this.maxPoints}}</span>
          </div>
        {{else}}
          <div class='stat-item'>
            <span class='stat-label'>Max Points:</span>
            <span class='stat-value'>{{this.maxPoints}}</span>
          </div>
        {{/if}}
      </div>

      <div class='status-section'>
        {{#if this.hasGrade}}
          <div class='status-item graded'>
            <span class='status-label'>Graded</span>
          </div>
        {{else}}
          <div class='status-item ungraded'>
            <span class='status-label'>Not Graded</span>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .fitted-homework {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 1rem;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
      }

      .fitted-homework:hover {
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        border-color: #d1d5db;
      }

      .homework-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .homework-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
        margin: 0;
        line-height: 1.3;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .grade-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-align: center;
        min-width: 2.5rem;
        flex-shrink: 0;
      }

      .grade-badge.A {
        background: #dcfce7;
        color: #166534;
        border: 1px solid #bbf7d0;
      }

      .grade-badge.B {
        background: #dbeafe;
        color: #1e40af;
        border: 1px solid #bfdbfe;
      }

      .grade-badge.C {
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fde68a;
      }

      .grade-badge.D {
        background: #fee2e2;
        color: #dc2626;
        border: 1px solid #fecaca;
      }

      .grade-badge.E {
        background: #fee2e2;
        color: #dc2626;
        border: 1px solid #fecaca;
      }

      .grade-badge.F {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #fca5a5;
      }

      .grade-badge.ungraded {
        background: #f3f4f6;
        color: #4b5563;
        border: 1px solid #d1d5db;
      }

      .homework-stats {
        display: flex;
        gap: 1rem;
        margin-bottom: 0.75rem;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .stat-label {
        font-size: 0.6875rem;
        color: #6b7280;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .stat-value {
        font-size: 0.875rem;
        color: #374151;
        font-weight: 600;
      }

      .status-section {
        margin-top: auto;
        padding-top: 0.5rem;
      }

      .status-item {
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        text-align: center;
        border: 1px solid;
      }

      .status-item.graded {
        background: #f0fdf4;
        color: #166534;
        border-color: #bbf7d0;
      }

      .status-item.ungraded {
        background: #f3f4f6;
        color: #4b5563;
        border-color: #d1d5db;
      }

      .status-label {
        font-weight: 600;
      }
    </style>
  </template>
}
export class Homework extends CardDef {
  static displayName = 'Homework';

  @field instructions = contains(TextAreaField);
  @field questions = containsMany(QuestionField); // Each question contains its own answer
  @field grade = contains(GradeField);
  @field gradingSkill = linksTo(() => Skill);

  static isolated = HomeworkIsolated;
  static fitted = HomeworkFitted;
}
