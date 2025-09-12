// ═══ [EDIT TRACKING: ON] Mark all changes with ⁽ⁿ⁾ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api'; // ⁽¹⁾ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { Button, Pill } from '@cardstack/boxel-ui/components'; // ⁽²⁾ UI components
import {
  formatDateTime,
  eq,
  gt,
  add,
  subtract,
} from '@cardstack/boxel-ui/helpers'; // ⁽³⁾ Formatters
import { concat, get, fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import BookOpenIcon from '@cardstack/boxel-icons/book-open'; // ⁽¹³⁾ Modern study icon

export class QuizQuestionField extends FieldDef {
  // ⁽³⁸⁾ Question field with choices
  static displayName = 'Quiz Question';

  @field question = contains(StringField);
  @field choices = containsMany(StringField);
  @field correctAnswer = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='quiz-question-field'>
        <div class='question-text'>{{@model.question}}</div>
        <div class='choices-preview'>
          {{#each @model.choices as |choice index|}}
            <div class='choice-preview'>
              {{get (array 'A' 'B' 'C' 'D') index}})
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
          background: #f9fafb;
          border-radius: 6px;
          font-size: 0.8125rem;
        }

        .question-text {
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #1f2937;
        }

        .choice-preview {
          font-size: 0.75rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
        }
      </style>
    </template>
  };
}

export class PracticeQuizCard extends CardDef {
  // ⁽⁵⁾ Practice quiz card definition - streamlined for study hub
  static displayName = 'Practice Quiz';
  static icon = BookOpenIcon; // ⁽¹⁴⁾ Updated to study-focused icon

  @field quizTitle = contains(StringField); // ⁽⁶⁾ Quiz title
  @field subject = contains(StringField); // ⁽¹⁵⁾ Academic subject
  @field quizQuestions = containsMany(QuizQuestionField); // ⁽¹⁶⁾ Quiz questions with choices
  @field totalQuestions = contains(NumberField); // ⁽¹⁷⁾ Total question count
  @field timeLimit = contains(NumberField); // ⁽¹⁸⁾ Time limit in minutes
  @field difficulty = contains(StringField); // ⁽¹⁹⁾ Beginner, Intermediate, Advanced
  @field studyTopic = contains(StringField); // ⁽²⁰⁾ Specific learning topic
  @field isCompleted = contains(BooleanField); // ⁽²¹⁾ Completion status
  @field completedAt = contains(DatetimeField); // ⁽²²⁾ Completion timestamp
  @field correctAnswers = contains(NumberField); // ⁽²³⁾ Number of correct answers

  // ⁽²⁴⁾ Computed percentage score with grade level
  @field percentage = contains(NumberField, {
    computeVia: function (this: PracticeQuizCard) {
      try {
        if (!this.totalQuestions || this.totalQuestions === 0) return 0;
        const correct = this.correctAnswers || 0;
        return Math.round((correct / this.totalQuestions) * 100);
      } catch (e) {
        console.error('PracticeQuiz: Error computing percentage', e);
        return 0;
      }
    },
  });

  // ⁽²⁵⁾ Simplified percentage-based scoring - show just the percentage
  @field gradeLevel = contains(StringField, {
    computeVia: function (this: PracticeQuizCard) {
      try {
        const score = this.percentage || 0;
        return `${score}%`;
      } catch (e) {
        console.error('PracticeQuiz: Error computing grade', e);
        return '0%';
      }
    },
  });

  // ⁽²⁶⁾ Computed title from quizTitle and subject
  @field title = contains(StringField, {
    computeVia: function (this: PracticeQuizCard) {
      try {
        const quiz = this.quizTitle || 'Practice Quiz';
        const subject = this.subject ? ` - ${this.subject}` : '';
        return `${quiz}${subject}`;
      } catch (e) {
        console.error('PracticeQuiz: Error computing title', e);
        return 'Practice Quiz';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof PracticeQuizCard> {
    // ⁽⁹⁾ Isolated format
    @tracked currentQuestion = 0;
    @tracked isQuizActive = false;
    @tracked timeRemaining = 0;
    @tracked selectedAnswers: string[] = [];

    get scoreColor() {
      const score = this.args?.model?.percentage || 0;
      if (score >= 85) return 'excellent';
      if (score >= 75) return 'good';
      if (score >= 65) return 'satisfactory';
      if (score >= 50) return 'needs-work';
      return 'unsatisfactory';
    }

    get difficultyColor() {
      // ⁽²⁷⁾ Difficulty level styling
      const difficulty = this.args?.model?.difficulty || '';
      switch (difficulty.toLowerCase()) {
        case 'beginner':
          return 'beginner';
        case 'intermediate':
          return 'intermediate';
        case 'advanced':
          return 'advanced';
        default:
          return 'intermediate';
      }
    }

    get currentQuestionData() {
      const questions = this.args?.model?.quizQuestions || [];
      return questions[this.currentQuestion] || {};
    }

    get currentQuestionText() {
      return this.currentQuestionData.question || '';
    }

    get currentAnswerChoices() {
      return this.currentQuestionData.choices || [];
    }

    get currentCorrectAnswer() {
      return this.currentQuestionData.correctAnswer || 'A';
    }

    get progressPercentage() {
      const total = this.args?.model?.totalQuestions || 1;
      return Math.round(((this.currentQuestion + 1) / total) * 100);
    }

    @action
    startQuiz() {
      this.isQuizActive = true;
      this.currentQuestion = 0;
      this.selectedAnswers = [];
      this.timeRemaining = (this.args?.model?.timeLimit || 10) * 60; // Convert to seconds
      this.startTimer();
    }

    @action
    nextQuestion() {
      const total = this.args?.model?.totalQuestions || 0;
      if (this.currentQuestion < total - 1) {
        this.currentQuestion++;
      } else {
        this.finishQuiz();
      }
    }

    @action
    previousQuestion() {
      if (this.currentQuestion > 0) {
        this.currentQuestion--;
      }
    }

    @action
    selectAnswer(answer: string) {
      // ⁽³⁹⁾ Fix answer selection - need to trigger reactivity
      const newAnswers = [...this.selectedAnswers];
      newAnswers[this.currentQuestion] = answer;
      this.selectedAnswers = newAnswers;
    }

    @action
    finishQuiz() {
      this.isQuizActive = false;
      // ⁽³⁵⁾ Calculate score based on correct answers
      this.calculateScore();
    }

    calculateScore() {
      // ⁽³⁶⁾ Calculate score by comparing selected answers to correct answers
      try {
        const questions = this.args?.model?.quizQuestions || [];
        let correctCount = 0;

        this.selectedAnswers.forEach((answer, index) => {
          const question = questions[index];
          if (
            answer &&
            question?.correctAnswer &&
            answer === question.correctAnswer
          ) {
            correctCount++;
          }
        });

        // ⁽³⁷⁾ Update model with results - fix ISO string error completely
        if (this.args?.model) {
          this.args.model.correctAnswers = correctCount;
          this.args.model.isCompleted = true;

          // Fix: DatetimeField expects a Date object, not a string
          try {
            this.args.model.completedAt = new Date();
            console.log(
              'Quiz completion time set as Date object:',
              this.args.model.completedAt,
            );
          } catch (dateError) {
            console.error('Error setting completion date:', dateError);
            // Fallback: still use Date object
            this.args.model.completedAt = new Date();
          }
        }

        console.log(
          `Quiz completed: ${correctCount}/${this.selectedAnswers.length} correct`,
        );
      } catch (e) {
        console.error('Error calculating quiz score:', e);
        // Ensure completion is still marked even if there's an error
        if (this.args?.model) {
          this.args.model.isCompleted = true;
          this.args.model.completedAt = new Date();
        }
      }
    }

    @action
    restartQuiz() {
      this.currentQuestion = 0;
      this.selectedAnswers = [];
      this.startQuiz();
    }

    startTimer() {
      const interval = setInterval(() => {
        if (this.timeRemaining > 0) {
          this.timeRemaining--;
        } else {
          clearInterval(interval);
          this.finishQuiz();
        }
      }, 1000);
    }

    get formattedTime() {
      const minutes = Math.floor(this.timeRemaining / 60);
      const seconds = this.timeRemaining % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    <template>
      <div class='quiz-view'>
        <div class='quiz-container'>
          {{#unless this.isQuizActive}}
            <!-- Study Hub Quiz Overview -->
            <div class='quiz-overview'>
              <header class='quiz-header'>
                <div class='header-content'>
                  <div class='quiz-info'>
                    <h1 class='quiz-title'>{{if
                        @model.quizTitle
                        @model.quizTitle
                        'Practice Quiz'
                      }}</h1>

                    {{#if @model.subject}}
                      <div class='subject-badge'>
                        <svg
                          class='subject-icon'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                          <path
                            d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'
                          />
                        </svg>
                        {{@model.subject}}
                      </div>
                    {{/if}}

                    {{#if @model.studyTopic}}
                      <div class='topic-info'>
                        <svg
                          class='topic-icon'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <circle cx='12' cy='12' r='3' />
                          <path d='M12 1v6m0 6v6m11-7h-6m-6 0H1' />
                        </svg>
                        {{@model.studyTopic}}
                      </div>
                    {{/if}}
                  </div>

                  <div class='quiz-badges'>
                    {{#if @model.difficulty}}
                      <Pill
                        class='difficulty-{{this.difficultyColor}}'
                      >{{@model.difficulty}}</Pill>
                    {{/if}}
                    {{#if @model.isCompleted}}
                      <Pill class='completed-badge'>
                        <svg
                          class='check-icon'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <polyline points='20,6 9,17 4,12' />
                        </svg>
                        Completed
                      </Pill>
                    {{/if}}
                  </div>
                </div>
              </header>

              <div class='quiz-stats'>
                <div class='stat-card'>
                  <div class='stat-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M9 11H7a2 2 0 1 1 0-4h2m0 4v4a2 2 0 1 1-4 0v-2'
                      />
                      <path
                        d='M15 11h2a2 2 0 1 1 0 4h-2m0-4v-4a2 2 0 1 1 4 0v2'
                      />
                    </svg>
                  </div>
                  <div class='stat-content'>
                    <div class='stat-value'>{{if
                        @model.quizQuestions
                        @model.quizQuestions.length
                        @model.totalQuestions
                      }}</div>
                    <div class='stat-label'>Questions</div>
                  </div>
                </div>

                {{#if @model.timeLimit}}
                  <div class='stat-card'>
                    <div class='stat-icon'>
                      <svg
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <polyline points='12,6 12,12 16,14' />
                      </svg>
                    </div>
                    <div class='stat-content'>
                      <div class='stat-value'>{{@model.timeLimit}}</div>
                      <div class='stat-label'>Minutes</div>
                    </div>
                  </div>
                {{/if}}

                {{#if @model.isCompleted}}
                  <div class='stat-card score-card {{this.scoreColor}}'>
                    <div class='grade-display'>
                      <div class='grade-letter'>{{@model.gradeLevel}}</div>
                      <div class='grade-percent'>{{@model.percentage}}%</div>
                    </div>
                    <div class='stat-content'>
                      <div
                        class='stat-value'
                      >{{@model.correctAnswers}}/{{@model.totalQuestions}}</div>
                      <div class='stat-label'>Correct</div>
                    </div>
                  </div>
                {{/if}}
              </div>

              {{#if @model.isCompleted}}
                <div class='quiz-results {{this.scoreColor}}'>
                  <div class='results-content'>
                    <div class='grade-summary'>
                      <div class='final-grade'>{{@model.gradeLevel}}</div>
                      <div class='grade-details'>
                        <div class='percentage-score'>{{@model.percentage}}%
                          Score</div>
                        <div class='questions-summary'>{{@model.correctAnswers}}
                          of
                          {{@model.totalQuestions}}
                          correct</div>
                        {{#if @model.completedAt}}
                          <div class='completion-time'>Completed
                            {{formatDateTime
                              @model.completedAt
                              size='medium'
                              relative=true
                            }}</div>
                        {{/if}}
                      </div>
                    </div>

                    <div class='performance-insight'>
                      {{#if (gt @model.percentage 84)}}
                        <div class='insight excellent'>
                          <svg
                            class='insight-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path
                              d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                            />
                          </svg>
                          Excellent work! You've mastered this topic.
                        </div>
                      {{else if (gt @model.percentage 74)}}
                        <div class='insight good'>
                          <svg
                            class='insight-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path d='M14 9l-5 5L4 9' />
                          </svg>
                          Great job! You're on the right track.
                        </div>
                      {{else if (gt @model.percentage 64)}}
                        <div class='insight satisfactory'>
                          <svg
                            class='insight-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path d='M8 12h8M12 8v8' />
                          </svg>
                          Good effort! Review the material and try again.
                        </div>
                      {{else}}
                        <div class='insight needs-work'>
                          <svg
                            class='insight-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <path
                              d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                            />
                          </svg>
                          Keep studying! Consider reviewing the fundamentals.
                        </div>
                      {{/if}}
                    </div>
                  </div>

                  <div class='result-actions'>
                    <Button
                      class='action-btn secondary'
                      {{on 'click' this.restartQuiz}}
                    >
                      <svg
                        class='btn-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <polyline points='23,4 23,10 17,10' />
                        <path d='M20.49 15a9 9 0 11-2.12-9.36L23 10' />
                      </svg>
                      Retake Quiz
                    </Button>
                  </div>
                </div>
              {{else}}
                <div class='quiz-start'>
                  <Button class='start-btn' {{on 'click' this.startQuiz}}>
                    <svg
                      class='btn-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polygon points='5,3 19,12 5,21' />
                    </svg>
                    Begin Assessment
                  </Button>
                  <div class='start-help'>
                    {{#if @model.timeLimit}}
                      <span class='time-info'>⏱️
                        {{@model.timeLimit}}
                        minute time limit</span>
                    {{/if}}
                    <span class='question-info'>📝
                      {{@model.totalQuestions}}
                      questions</span>
                  </div>
                </div>
              {{/if}}
            </div>
          {{else}}
            <!-- Active Quiz Interface -->
            <div class='quiz-active'>
              <div class='quiz-progress'>
                <div class='progress-info'>
                  <span class='question-counter'>Question
                    {{add this.currentQuestion 1}}
                    of
                    {{@model.totalQuestions}}</span>
                  {{#if @model.timeLimit}}
                    <span class='time-remaining'>{{this.formattedTime}}</span>
                  {{/if}}
                </div>
                <div class='progress-bar'>
                  <div
                    class='progress-fill'
                    style={{concat 'width: ' this.progressPercentage '%'}}
                  ></div>
                </div>
              </div>

              <div class='question-container'>
                <div class='question-text'>
                  {{this.currentQuestionText}}
                </div>

                <!-- ⁽³³⁾ Dynamic answer choices -->
                <div class='answer-choices'>
                  {{#if (gt this.currentAnswerChoices.length 0)}}
                    {{#each this.currentAnswerChoices as |choice index|}}
                      <button
                        class='answer-choice
                          {{if
                            (eq
                              (get this.selectedAnswers this.currentQuestion)
                              (get (array "A" "B" "C" "D") index)
                            )
                            "selected"
                            ""
                          }}'
                        {{on
                          'click'
                          (fn
                            this.selectAnswer
                            (get (array 'A' 'B' 'C' 'D') index)
                          )
                        }}
                      >
                        {{get (array 'A' 'B' 'C' 'D') index}})
                        {{choice}}
                      </button>
                    {{/each}}
                  {{else}}
                    <!-- ⁽³⁴⁾ Fallback if no answer choices provided -->
                    <div class='no-choices'>
                      <p>Answer choices not configured for this question.</p>
                      <Button
                        class='skip-button'
                        {{on 'click' this.nextQuestion}}
                      >
                        Skip Question
                      </Button>
                    </div>
                  {{/if}}
                </div>
              </div>

              <div class='quiz-navigation'>
                <Button
                  class='nav-btn'
                  {{on 'click' this.previousQuestion}}
                  disabled={{eq this.currentQuestion 0}}
                >
                  Previous
                </Button>

                <div class='nav-info'>
                  {{#if (get this.selectedAnswers this.currentQuestion)}}
                    <span class='answered-indicator'>✓ Answered</span>
                  {{else}}
                    <span class='unanswered-indicator'>Select an answer</span>
                  {{/if}}
                </div>

                {{#if
                  (eq this.currentQuestion (subtract @model.totalQuestions 1))
                }}
                  <Button class='nav-btn finish' {{on 'click' this.finishQuiz}}>
                    Finish Quiz
                  </Button>
                {{else}}
                  <Button class='nav-btn' {{on 'click' this.nextQuestion}}>
                    Next
                  </Button>
                {{/if}}
              </div>
            </div>
          {{/unless}}
        </div>
      </div>

      <style scoped>
        /* ⁽²⁸⁾ Study Hub Theme Alignment - Focus Flow Design */
        .quiz-view {
          /* Study Hub Typography Foundation */
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          padding: 1.5rem;
          background: #f8fafc; /* Study Hub surface color */
          overflow-y: auto;
          box-sizing: border-box;

          /* Study Hub CSS Custom Properties - Design Tokens */
          --primary: #1e3a8a; /* Deep Learning Blue */
          --secondary: #059669; /* Progress Green */
          --accent: #f59e0b; /* Warm Amber */
          --surface: #f8fafc; /* Cool Gray */
          --surface-elevated: #ffffff;
          --text-primary: #1f2937; /* Rich Charcoal */
          --text-secondary: #4b5563;
          --text-tertiary: #6b7280;
          --border: #e5e7eb;
          --border-focus: #3b82f6;
          --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          --shadow:
            0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          --shadow-md:
            0 4px 6px -1px rgba(0, 0, 0, 0.1),
            0 2px 4px -1px rgba(0, 0, 0, 0.06);
          --radius: 12px;
          --radius-sm: 8px;
          --radius-xs: 6px;
        }

        .quiz-container {
          max-width: 52rem;
          width: 100%;
          background: var(--surface-elevated);
          border-radius: var(--radius);
          box-shadow: var(--shadow-md);
          overflow: hidden;
          border: 1px solid var(--border);
          max-height: 100%;
          display: flex;
          flex-direction: column;
        }

        .quiz-overview {
          padding: 2rem;
          overflow-y: auto;
          flex: 1;
        }

        .quiz-header {
          margin-bottom: 2rem;
          position: relative;
        }

        .quiz-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(
            90deg,
            var(--primary),
            var(--secondary),
            var(--accent)
          );
          border-radius: 2px;
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 2rem;
          padding-top: 1rem;
        }

        .quiz-info {
          flex: 1;
        }

        .quiz-title {
          font-family: 'Inter', sans-serif;
          font-size: 2rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 1rem 0;
          line-height: 1.2;
          letter-spacing: -0.025em;
        }

        .subject-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: var(--radius-sm);
          font-size: 0.875rem;
          font-weight: 600;
          margin-bottom: 0.75rem;
          box-shadow: var(--shadow-sm);
        }

        .subject-icon {
          width: 1rem;
          height: 1rem;
        }

        .topic-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-secondary);
          font-size: 0.875rem;
          font-weight: 500;
          margin-top: 0.5rem;
        }

        .topic-icon {
          width: 1rem;
          height: 1rem;
        }

        .quiz-badges {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          align-items: flex-end;
        }

        .difficulty-beginner {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
          border: 1px solid rgba(5, 150, 105, 0.2);
        }
        .difficulty-intermediate {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent);
          border: 1px solid rgba(245, 158, 11, 0.2);
        }
        .difficulty-advanced {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .completed-badge {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
          border: 1px solid rgba(5, 150, 105, 0.2);
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .check-icon {
          width: 1rem;
          height: 1rem;
        }

        .quiz-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .stat-card {
          display: flex;
          gap: 1rem;
          padding: 1.5rem;
          background: var(--surface-elevated);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .stat-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary), var(--secondary));
          transform: scaleX(0);
          transition: transform 0.3s ease;
          transform-origin: left;
        }

        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
          border-color: rgba(59, 130, 246, 0.2);
        }

        .stat-card:hover::before {
          transform: scaleX(1);
        }

        .stat-card.score-card.excellent {
          background: rgba(5, 150, 105, 0.05);
          border: 2px solid var(--secondary);
        }
        .stat-card.score-card.good {
          background: rgba(59, 130, 246, 0.05);
          border: 2px solid var(--border-focus);
        }
        .stat-card.score-card.satisfactory {
          background: rgba(245, 158, 11, 0.05);
          border: 2px solid var(--accent);
        }
        .stat-card.score-card.needs-work {
          background: rgba(239, 68, 68, 0.05);
          border: 2px solid #ef4444;
        }
        .stat-card.score-card.unsatisfactory {
          background: rgba(220, 38, 38, 0.05);
          border: 2px solid #dc2626;
        }

        .grade-display {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 4rem;
          height: 4rem;
          background: white;
          border-radius: 50%;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          flex-shrink: 0;
        }

        .grade-letter {
          font-size: 1.5rem;
          font-weight: 800;
          color: #1a1a2e;
          line-height: 1;
        }

        .grade-percent {
          font-size: 0.625rem;
          font-weight: 600;
          color: #6b7280;
          line-height: 1;
        }

        .stat-icon {
          width: 2.5rem;
          height: 2.5rem;
          background: var(--surface-elevated);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: var(--shadow);
          border: 1px solid var(--border);
        }

        .stat-icon svg {
          width: 1.25rem;
          height: 1.25rem;
          color: var(--primary);
        }

        .stat-content {
          flex: 1;
        }

        .stat-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .stat-label {
          font-size: 0.75rem;
          color: var(--text-tertiary);
          margin-top: 0.25rem;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          font-weight: 500;
        }

        .quiz-results {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.9),
            rgba(248, 250, 252, 0.9)
          );
          border-radius: 16px;
          padding: 2rem;
          margin-bottom: 2rem;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .quiz-results.excellent {
          background: linear-gradient(135deg, #d1fae5, #a7f3d0);
          border-color: #10b981;
        }
        .quiz-results.good {
          background: linear-gradient(135deg, #dbeafe, #93c5fd);
          border-color: #3b82f6;
        }
        .quiz-results.satisfactory {
          background: linear-gradient(135deg, #fef3c7, #fde68a);
          border-color: #f59e0b;
        }
        .quiz-results.needs-work {
          background: linear-gradient(135deg, #fed7d7, #feb2b2);
          border-color: #f56565;
        }
        .quiz-results.unsatisfactory {
          background: linear-gradient(135deg, #fee2e2, #fecaca);
          border-color: #dc2626;
        }

        .results-content {
          margin-bottom: 1.5rem;
        }

        .grade-summary {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .final-grade {
          font-size: 4rem;
          font-weight: 800;
          color: #1a1a2e;
          line-height: 1;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .grade-details {
          flex: 1;
        }

        .percentage-score {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1f2937;
          margin-bottom: 0.25rem;
        }

        .questions-summary {
          font-size: 1rem;
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.5rem;
        }

        .completion-time {
          font-size: 0.875rem;
          color: #6b7280;
        }

        .performance-insight {
          padding: 1rem;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.5);
          backdrop-filter: blur(5px);
        }

        .insight {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .insight-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }

        .insight.excellent {
          color: #047857;
        }
        .insight.good {
          color: #1d4ed8;
        }
        .insight.satisfactory {
          color: #d97706;
        }
        .insight.needs-work {
          color: #dc2626;
        }

        .result-actions {
          display: flex;
          gap: 0.75rem;
          justify-content: flex-end;
        }

        .quiz-start {
          text-align: center;
        }

        .start-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1.25rem 2.5rem;
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          border: none;
          border-radius: var(--radius);
          font-size: 1.125rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: var(--shadow-md);
          transform: translateY(0);
          position: relative;
          overflow: hidden;
        }

        .start-btn::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2),
            transparent
          );
          transition: left 0.5s ease;
        }

        .start-btn:hover {
          background: linear-gradient(135deg, #1e40af, #1d4ed8);
          transform: translateY(-2px);
          box-shadow:
            0 8px 25px rgba(30, 58, 138, 0.3),
            0 4px 12px rgba(30, 58, 138, 0.2);
        }

        .start-btn:hover::before {
          left: 100%;
        }

        .start-btn:active {
          transform: translateY(0);
        }

        .start-help {
          margin-top: 1rem;
          display: flex;
          justify-content: center;
          gap: 1.5rem;
          font-size: 0.875rem;
          color: #6b7280;
        }

        .time-info,
        .question-info {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .btn-icon {
          width: 1.25rem;
          height: 1.25rem;
        }

        /* Active Quiz Styles */
        .quiz-active {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .quiz-progress {
          padding: 1.5rem 2rem;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
        }

        .progress-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .question-counter {
          font-size: 0.875rem;
          font-weight: 500;
          color: #374151;
        }

        .time-remaining {
          font-size: 1rem;
          font-weight: 600;
          color: #dc2626;
          font-family: monospace;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #e5e7eb;
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .question-container {
          flex: 1;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow-y: auto;
          min-height: 0;
        }

        .question-text {
          font-size: 1.25rem;
          font-weight: 500;
          color: #1f2937;
          line-height: 1.6;
          margin-bottom: 2rem;
          text-align: center;
        }

        .answer-choices {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .answer-choice {
          padding: 1rem 1.5rem;
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          text-align: left;
          font-size: 0.875rem;
          color: #374151;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .answer-choice:hover {
          border-color: #3b82f6;
          background: #f0f9ff;
        }

        .answer-choice.selected {
          border-color: #3b82f6;
          background: #3b82f6;
          color: white;
        }

        .quiz-navigation {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem 2rem;
          background: #f9fafb;
          border-top: 1px solid #e5e7eb;
        }

        .nav-btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #f3f4f6;
          color: #374151;
        }

        .nav-btn:hover:not(:disabled) {
          background: #e5e7eb;
        }

        .nav-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .nav-btn.finish {
          background: #059669;
          color: white;
        }

        .nav-btn.finish:hover {
          background: #047857;
        }

        .nav-info {
          font-size: 0.875rem;
        }

        .answered-indicator {
          color: #059669;
          font-weight: 500;
        }

        .unanswered-indicator {
          color: #6b7280;
        }

        .no-choices {
          text-align: center;
          padding: 2rem;
          background: #fef3c7;
          border: 2px dashed #f59e0b;
          border-radius: 8px;
          color: #92400e;
        }

        .no-choices p {
          margin-bottom: 1rem;
          font-weight: 500;
        }

        .skip-button {
          padding: 0.5rem 1rem;
          background: #f59e0b;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .skip-button:hover {
          background: #d97706;
        }

        .action-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.25rem;
          border: none;
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .action-btn.primary {
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          box-shadow: var(--shadow);
          position: relative;
          overflow: hidden;
        }

        .action-btn.primary::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2),
            transparent
          );
          transition: left 0.5s ease;
        }

        .action-btn.primary:hover {
          background: linear-gradient(135deg, #1e40af, #1d4ed8);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .action-btn.primary:hover::before {
          left: 100%;
        }

        .action-btn.secondary {
          background: var(--surface-elevated);
          color: var(--text-secondary);
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
        }

        .action-btn.secondary:hover {
          background: var(--surface);
          transform: translateY(-1px);
          box-shadow: var(--shadow);
          border-color: var(--border-focus);
        }

        /* Mobile Scrolling Improvements */
        @media (max-height: 800px) {
          .quiz-view {
            padding: 1rem;
          }

          .quiz-overview {
            padding: 1.5rem;
          }

          .quiz-title {
            font-size: 1.5rem;
            margin-bottom: 0.75rem;
          }

          .quiz-stats {
            margin-bottom: 1.5rem;
          }

          .stat-card {
            padding: 1rem;
          }
        }

        @media (max-height: 600px) {
          .quiz-view {
            padding: 0.5rem;
          }

          .quiz-overview {
            padding: 1rem;
          }

          .quiz-title {
            font-size: 1.25rem;
          }

          .stat-card {
            padding: 0.75rem;
          }

          .quiz-results {
            padding: 1.5rem;
            margin-bottom: 1rem;
          }

          .final-grade {
            font-size: 3rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PracticeQuizCard> {
    // ⁽¹¹⁾ Embedded format
    get scoreColor() {
      const score = this.args?.model?.percentage || 0;
      if (score >= 85) return 'excellent';
      if (score >= 75) return 'good';
      if (score >= 65) return 'satisfactory';
      if (score >= 50) return 'needs-work';
      return 'unsatisfactory';
    }

    get difficultyColor() {
      // ⁽²⁹⁾ Difficulty styling for embedded
      const difficulty = this.args?.model?.difficulty || '';
      switch (difficulty.toLowerCase()) {
        case 'beginner':
          return 'beginner';
        case 'intermediate':
          return 'intermediate';
        case 'advanced':
          return 'advanced';
        default:
          return 'intermediate';
      }
    }

    <template>
      <div class='quiz-embedded'>
        <div class='quiz-header'>
          <h4 class='quiz-title'>{{if
              @model.quizTitle
              @model.quizTitle
              'Practice Quiz'
            }}</h4>
          <div class='quiz-meta'>
            {{#if @model.difficulty}}
              <Pill
                class='difficulty-{{@model.difficulty}}'
              >{{@model.difficulty}}</Pill>
            {{/if}}
            {{#if @model.isCompleted}}
              <Pill class='completed'>✓ Complete</Pill>
            {{/if}}
          </div>
        </div>

        {{#if @model.subject}}
          <div class='subject-badge'>{{@model.subject}}</div>
        {{/if}}

        <div class='quiz-stats'>
          {{#if @model.isCompleted}}
            <div class='score-display {{this.scoreColor}}'>
              <div class='score-circle'>
                <div class='score-number'>{{@model.percentage}}%</div>
              </div>
              <div class='score-details'>
                <div
                  class='correct-count'
                >{{@model.correctAnswers}}/{{@model.totalQuestions}}
                  correct</div>
                {{#if @model.completedAt}}
                  <div class='completion-time'>Completed
                    {{formatDateTime
                      @model.completedAt
                      size='short'
                      relative=true
                    }}</div>
                {{/if}}
              </div>
            </div>
          {{else}}
            <div class='quiz-preview'>
              <div class='question-count'>
                <span class='count'>{{@model.totalQuestions}}</span>
                <span class='label'>questions</span>
              </div>
              {{#if @model.timeLimit}}
                <div class='time-limit'>
                  <svg
                    class='icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <polyline points='12,6 12,12 16,14' />
                  </svg>
                  {{@model.timeLimit}}
                  min limit
                </div>
              {{/if}}
            </div>
          {{/if}}
        </div>

        {{#if @model.isCompleted}}
          <div class='quiz-actions'>
            <Button class='action-button secondary'>Review Answers</Button>
            <Button class='action-button primary'>Retake Quiz</Button>
          </div>
        {{else}}
          <div class='quiz-actions'>
            <Button class='action-button primary'>Start Quiz</Button>
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ⁽¹²⁾ Study Hub Embedded Quiz Styling */
        .quiz-embedded {
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          padding: 1.25rem;
          background: var(--surface-elevated, #ffffff);
          border-radius: var(--radius-sm, 8px);
          border: 1px solid var(--border, #e5e7eb);
          font-size: 0.8125rem;
          box-shadow: var(--shadow, 0 1px 3px 0 rgba(0, 0, 0, 0.1));

          /* Study Hub Design Tokens */
          --primary: #1e3a8a;
          --secondary: #059669;
          --accent: #f59e0b;
          --surface: #f8fafc;
          --surface-elevated: #ffffff;
          --text-primary: #1f2937;
          --text-secondary: #4b5563;
          --text-tertiary: #6b7280;
          --border: #e5e7eb;
          --shadow:
            0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          --radius-sm: 8px;
        }

        .quiz-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .quiz-title {
          font-family: 'Inter', sans-serif;
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.2;
          letter-spacing: -0.025em;
        }

        .quiz-meta {
          display: flex;
          gap: 0.375rem;
          flex-shrink: 0;
        }

        .difficulty-beginner {
          background: #d1fae5;
          color: #047857;
          border: 1px solid #a7f3d0;
        }
        .difficulty-intermediate {
          background: #fef3c7;
          color: #d97706;
          border: 1px solid #fde68a;
        }
        .difficulty-advanced {
          background: #fee2e2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }

        .completed {
          background: #dcfce7;
          color: #166534;
          border: 1px solid #bbf7d0;
        }

        .subject-badge {
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          font-size: 0.75rem;
          padding: 0.375rem 0.75rem;
          border-radius: var(--radius-sm);
          display: inline-block;
          margin-bottom: 0.75rem;
          font-weight: 600;
          box-shadow: var(--shadow);
        }

        .quiz-stats {
          margin-bottom: 1rem;
        }

        .score-display {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem;
          border-radius: 8px;
        }

        .score-display.excellent {
          background: rgba(5, 150, 105, 0.05);
          border: 1px solid var(--secondary);
        }
        .score-display.good {
          background: rgba(59, 130, 246, 0.05);
          border: 1px solid #3b82f6;
        }
        .score-display.satisfactory {
          background: rgba(245, 158, 11, 0.05);
          border: 1px solid var(--accent);
        }
        .score-display.needs-work {
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid #ef4444;
        }
        .score-display.unsatisfactory {
          background: rgba(220, 38, 38, 0.05);
          border: 1px solid #dc2626;
        }

        .score-circle {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: white;
          border: 3px solid currentColor;
          flex-shrink: 0;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        }

        .score-number {
          font-size: 1rem;
          font-weight: 800;
          color: #1a1a2e;
          line-height: 1;
        }

        .score-details {
          flex: 1;
        }

        .correct-count {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 0.25rem;
        }

        .completion-time {
          font-size: 0.6875rem;
          color: #6b7280;
        }

        .quiz-preview {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem;
          background: #f9fafb;
          border-radius: 6px;
        }

        .question-count {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
        }

        .question-count .count {
          font-size: 1.25rem;
          font-weight: 700;
          color: #3b82f6;
        }

        .question-count .label {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .time-limit {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          color: #6b7280;
          font-size: 0.75rem;
        }

        .time-limit .icon {
          width: 0.75rem;
          height: 0.75rem;
        }

        .quiz-actions {
          display: flex;
          gap: 0.5rem;
          justify-content: flex-end;
        }

        .action-button {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 10px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .action-button.primary {
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          box-shadow: var(--shadow);
          position: relative;
          overflow: hidden;
        }

        .action-button.primary::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2),
            transparent
          );
          transition: left 0.5s ease;
        }

        .action-button.primary:hover {
          background: linear-gradient(135deg, #1e40af, #1d4ed8);
          transform: translateY(-1px);
          box-shadow:
            0 4px 12px rgba(30, 58, 138, 0.3),
            0 2px 6px rgba(30, 58, 138, 0.2);
        }

        .action-button.primary:hover::before {
          left: 100%;
        }

        .action-button.secondary {
          background: rgba(255, 255, 255, 0.8);
          color: #374151;
          border: 1px solid rgba(107, 114, 128, 0.2);
          backdrop-filter: blur(5px);
        }

        .action-button.secondary:hover {
          background: rgba(255, 255, 255, 0.9);
          transform: translateY(-1px);
        }
      </style>
    </template>
  };
}
