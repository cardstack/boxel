// Core Cardstack imports
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DatetimeField from 'https://cardstack.com/base/datetime';

// Boxel UI components and helpers
import {
  eq,
  gt,
  add,
  subtract,
  formatDateTime,
} from '@cardstack/boxel-ui/helpers';
import GamepadIcon from '@cardstack/boxel-icons/gamepad';

// Ember and Glimmer utilities
import { concat, get, fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { KeyboardShortcutModifier } from './modifier/keyboard-shortcut-modifier';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';

// Local project imports
import { QuizQuestionField } from './fields/quiz-question';
import { QuizDifficultyField } from './fields/quiz-difficulty';
import {
  GameSoundEffectUtils,
  type GameSoundType,
} from '../utils/external/game-sound-effect';

type GameState = 'menu' | 'playing' | 'completed' | 'gameOver';

class GameQuizIsolated extends Component<typeof GameQuizCard> {
  @tracked currentQuestion = 0;
  @tracked isQuizActive = false;
  @tracked timeRemaining = 0;
  @tracked selectedAnswers: string[] = [];
  @tracked gameState: GameState = 'menu'; // menu, playing, completed, gameOver
  @tracked score = 0; // Live score calculation
  @tracked streak = 0; // Combo streak
  @tracked showResult = false; // Answer feedback
  @tracked resultMessage = ''; // Feedback text
  @tracked lives = 3; // Player lives

  @tracked selectedFlash = ''; // Track flashing animation

  private timerInterval?: any; // Timer interval reference

  get totalQuestions() {
    return this.args?.model?.totalQuestions ?? 0;
  }

  get correctAnswers() {
    return this.args?.model?.correctAnswers ?? 0;
  }

  get answerLetters() {
    return ['A', 'B', 'C', 'D'];
  }

  get difficultyLabel(): string {
    return this.args?.model?.difficulty?.label ?? '';
  }

  // Sound effects system
  playSound(type: GameSoundType) {
    GameSoundEffectUtils.playSound(type);
  }

  // Start music
  playStartMusic() {
    GameSoundEffectUtils.playStartMusic();
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

  get currentCorrectAnswerText() {
    return this.currentQuestionData.correctAnswer || '';
  }

  get progressPercentage() {
    const total = this.totalQuestions || 1;
    return Math.round(((this.currentQuestion + 1) / total) * 100);
  }

  get pointsPerQuestion() {
    const total = this.totalQuestions || 0;
    return total > 0 ? Math.round((100 / total) * 100) / 100 : 0;
  }

  @action
  startQuiz() {
    this.playSound('click');
    this.playStartMusic();

    // Reset all game state
    this.gameState = 'playing';
    this.isQuizActive = true;
    this.resetGameState();
    this.startTimer();
  }

  @action
  selectAnswer(answerText: string) {
    if (this.showResult) return;

    this.playSound('click');

    // Trigger flash animation
    this.selectedFlash = answerText;
    this.clearFlashAnimation.perform();

    // Store the selected answer text
    const newAnswers = [...this.selectedAnswers];
    newAnswers[this.currentQuestion] = answerText;
    this.selectedAnswers = newAnswers;

    // Process the answer immediately
    this.processAnswer(answerText);
  }

  @action
  handleKeyDown(event: KeyboardEvent) {
    if (this.gameState !== 'playing' || this.showResult) return;

    const key = event.key.toLowerCase();
    const choices = this.currentAnswerChoices;

    if (key === 'a' && choices[0]) {
      this.selectAnswer(choices[0]);
    } else if (key === 'b' && choices[1]) {
      this.selectAnswer(choices[1]);
    } else if (key === 'c' && choices[2]) {
      this.selectAnswer(choices[2]);
    } else if (key === 'd' && choices[3]) {
      this.selectAnswer(choices[3]);
    }
  }

  processAnswer(selectedAnswer: string) {
    this.showResult = true;
    const correctAnswer = this.currentCorrectAnswerText;

    // Compare the selected answer text with the correct answer text
    const isCorrect =
      selectedAnswer.trim().toLowerCase() ===
      correctAnswer.trim().toLowerCase();

    if (isCorrect) {
      this.playSound('correct');

      // Simple scoring: each question worth equal portion of 100 points
      const pointsEarned = this.pointsPerQuestion;

      this.score += pointsEarned;
      this.streak++;
      this.resultMessage = this.getCorrectMessage(pointsEarned);

      // Update correct answers count in real-time
      this.updateCorrectAnswersCount();
    } else {
      this.playSound('wrong');
      this.lives = Math.max(0, this.lives - 1);
      this.streak = 0;
      this.resultMessage = `WRONG! Lives: ${this.lives}`;

      if (this.lives <= 0) {
        this.gameState = 'gameOver';
        this.playSound('gameOver');
        // Update high score even on game over (without mutating completion fields)
        this.updateHighScoreOnly();
        this.clearTimer(); // Clear timer when game ends
        return;
      }
    }

    this.scheduleNext.perform();
  }

  private updateHighScoreOnly() {
    if (!this.args?.model) return;
    // Record current run score to gameScore
    this.args.model.gameScore = this.score;
    // Compare to previous highest and update if current is higher
    const previousHigh = Number(this.args.model.highestGameScore) || 0;
    if (this.score > previousHigh) {
      this.args.model.highestGameScore = String(this.score);
    }
  }

  updateCorrectAnswersCount() {
    // Update correct answers count in real-time during gameplay
    if (this.args?.model) {
      const questions = this.args.model.quizQuestions || [];
      let correctCount = 0;

      this.selectedAnswers.forEach((selectedAnswer, index) => {
        const question = questions[index];
        if (selectedAnswer && question?.correctAnswer) {
          const isCorrect =
            selectedAnswer.trim().toLowerCase() ===
            question.correctAnswer.trim().toLowerCase();
          if (isCorrect) {
            correctCount++;
          }
        }
      });

      this.args.model.correctAnswers = correctCount;
    }
  }

  getCorrectMessage(points: number) {
    // Dynamic messages based on streak performance
    if (this.streak >= 10) {
      return `LEGENDARY! +${points}`;
    } else if (this.streak >= 5) {
      return `INCREDIBLE! +${points}`;
    } else if (this.streak >= 3) {
      return `OUTSTANDING! +${points}`;
    } else if (this.streak >= 2) {
      return `EXCELLENT! +${points}`;
    } else {
      return `PERFECT! +${points}`;
    }
  }

  private scheduleNext = restartableTask(async () => {
    //  Auto-advance timing
    await timeout(1500);
    this.nextQuestion();
  });

  // Flash animation task
  private clearFlashAnimation = restartableTask(async () => {
    await timeout(700);
    this.selectedFlash = '';
  });

  @action
  finishQuiz() {
    this.isQuizActive = false;
    this.gameState = 'completed'; //  Set completed state
    this.playSound('complete'); //  Quiz completion sound
    this.clearTimer(); // Clear timer when quiz finishes
    //  Calculate final score
    this.calculateScore();
  }

  @action
  nextQuestion() {
    //  Enhanced navigation
    this.showResult = false;
    const total = this.totalQuestions || 0;

    if (this.currentQuestion < total - 1) {
      this.currentQuestion++;
    } else {
      this.finishQuiz();
    }
  }

  @action
  returnToMenu() {
    //  Return to main menu
    this.playSound('click'); //  Navigation feedback
    this.gameState = 'menu';
    this.isQuizActive = false;
    this.showResult = false;
    this.clearTimer(); // Clear timer when returning to menu
  }

  calculateScore() {
    try {
      const questions = this.args?.model?.quizQuestions || [];
      let correctCount = 0;

      this.selectedAnswers.forEach((selectedAnswer, index) => {
        const question = questions[index];
        if (selectedAnswer && question?.correctAnswer) {
          const isCorrect =
            selectedAnswer.trim().toLowerCase() ===
            question.correctAnswer.trim().toLowerCase();
          if (isCorrect) {
            correctCount++;
          }
        }
      });

      const totalQuestions = questions.length;
      const percentage =
        totalQuestions > 0
          ? Math.round((correctCount / totalQuestions) * 100)
          : 0;

      if (this.args?.model) {
        this.args.model.correctAnswers = correctCount;
        this.args.model.percentage = percentage;
        this.args.model.isCompleted = true;
        this.args.model.completedAt = new Date();

        // Record current run score
        this.args.model.gameScore = this.score;

        // Update highestGameScore if current run beats previous highest
        const previousHigh = Number(this.args.model.highestGameScore) || 0;
        if (this.score > previousHigh) {
          this.args.model.highestGameScore = String(this.score);
        }
      }
    } catch (e) {
      console.error('Error calculating quiz score:', e);
      if (this.args?.model) {
        this.args.model.isCompleted = true;
        this.args.model.completedAt = new Date();
        this.args.model.correctAnswers = 0;
        this.args.model.percentage = 0;
      }
    }
  }

  @action
  restartQuiz() {
    this.playSound('click');
    this.startQuiz();
  }

  private resetGameState() {
    this.currentQuestion = 0;
    this.selectedAnswers = [];
    this.score = 0;
    this.streak = 0;
    this.lives = 3; // Reset lives to default 3
    this.showResult = false; // Reset result display
    this.resultMessage = ''; // Clear result message
    this.timeRemaining = (this.args?.model?.timeLimit || 10) * 60;

    // Reset model counters relevant for a new run
    if (this.args?.model) {
      this.args.model.correctAnswers = 0;
      this.args.model.gameScore = 0;
      this.args.model.isCompleted = false;
    }
  }

  startTimer() {
    // Clear any existing timer first
    this.clearTimer();

    this.timerInterval = setInterval(() => {
      if (this.timeRemaining > 0) {
        this.timeRemaining--;
      } else {
        this.clearTimer();
        this.finishQuiz();
      }
    }, 1000);
  }

  clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  willDestroy() {
    super.willDestroy();
    this.clearTimer();
  }

  get formattedTime() {
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  <template>
    <div
      class='game-arena'
      {{KeyboardShortcutModifier onKeydown=this.handleKeyDown}}
    >
      {{!  Gaming container }}
      <div class='game-hud'>
        {{!  Heads-up display }}
        {{#if (eq this.gameState 'menu')}}
          {{!  Main Menu Screen }}
          <div class='main-menu'>
            <div class='game-logo'>
              <div class='logo-text'>
                <span class='title-main'>QUIZ</span>
                <span class='title-sub'>MASTER</span>
              </div>
              <div class='logo-glow'></div>
            </div>

            {{#if @model.highestGameScore}}
              <div class='high-score'>
                <div class='score-label'>BEST SCORE</div>
                <div class='score-value'>{{@model.highestGameScore}}</div>
              </div>
            {{/if}}

            <div class='menu-info'>
              {{#if @model.quizTitle}}
                <h2 class='quiz-name'>{{@model.quizTitle}}</h2>
              {{/if}}
              {{#if @model.subject}}
                <div class='subject-chip'>{{@model.subject}}</div>
              {{/if}}
            </div>

            <div class='game-stats'>
              <div class='stat-item'>
                <div class='stat-icon'>🎯</div>
                <div class='stat-text'>{{this.totalQuestions}} Questions</div>
              </div>
              {{#if @model.timeLimit}}
                <div class='stat-item'>
                  <div class='stat-icon'>⏱️</div>
                  <div class='stat-text'>{{@model.timeLimit}} Min Limit</div>
                </div>
              {{/if}}
              {{#if @model.difficulty}}
                <div class='stat-item'>
                  <div class='stat-icon'>⚡</div>
                  <div class='stat-text'>{{this.difficultyLabel}}</div>
                </div>
              {{/if}}
            </div>

            <button class='start-game-btn' {{on 'click' this.startQuiz}}>
              <span class='btn-text'>START GAME</span>
              <div class='btn-glow'></div>
            </button>

            <div class='game-tips'>
              <div class='tip'>🎯 Each question is worth
                {{this.pointsPerQuestion}}
                points</div>
              <div class='tip'>💯 Perfect score is always 100 points</div>
              <div class='tip'>💖 You have {{this.lives}} lives</div>
              <div class='tip'>🎮 Answer correctly to earn points</div>
            </div>
          </div>

        {{else if (eq this.gameState 'playing')}}
          {{!  Active Gameplay }}
          <div class='gameplay-screen'>

            {{!  Top HUD }}
            <div class='top-hud'>
              <div class='hud-left'>
                <div class='score-display'>
                  <div class='score-label'>SCORE</div>
                  <div class='score-value'>{{this.score}}</div>
                </div>
                <div class='streak-display'>
                  <div class='streak-label'>STREAK</div>
                  <div class='streak-value {{if (gt this.streak 0) "active"}}'>
                    <span class='streak-number'>{{this.streak}}</span><span
                      class='streak-multiplier'
                    >×</span>
                  </div>
                </div>
              </div>

              <div class='hud-center'>
                <div class='question-progress'>
                  <div class='progress-text'>
                    {{add this.currentQuestion 1}}/{{this.totalQuestions}}
                  </div>
                  <div class='progress-bar'>
                    <div
                      class='progress-fill'
                      style={{htmlSafe
                        (concat 'width: ' this.progressPercentage '%')
                      }}
                    ></div>
                  </div>
                </div>
              </div>

              <div class='hud-right'>
                <div class='timer-display'>
                  <div class='timer-ring'>
                    <div class='timer-value'>{{this.formattedTime}}</div>
                  </div>
                </div>
              </div>
            </div>

            {{!  Question Arena }}
            <div class='question-arena'>
              <div class='question-panel'>
                <div class='question-number'>Q{{add
                    this.currentQuestion
                    1
                  }}</div>
                <div class='question-text'>{{this.currentQuestionText}}</div>
              </div>

              {{!  Answer Choices }}
              <div class='answers-grid'>
                {{#if (gt this.currentAnswerChoices.length 0)}}
                  {{#each this.currentAnswerChoices as |choice index|}}
                    <button
                      class='answer-btn
                        {{if
                          (eq
                            (get this.selectedAnswers this.currentQuestion)
                            choice
                          )
                          "selected"
                        }}
                        {{if (eq this.selectedFlash choice) "flashing"}}
                        {{if
                          this.showResult
                          (if
                            (eq choice this.currentCorrectAnswerText)
                            "correct"
                            (if
                              (eq
                                (get this.selectedAnswers this.currentQuestion)
                                choice
                              )
                              "wrong"
                            )
                          )
                        }}'
                      {{on 'click' (fn this.selectAnswer choice)}}
                      disabled={{this.showResult}}
                    >
                      <div class='answer-letter'>
                        <span class='letter-main'>{{get
                            this.answerLetters
                            index
                          }}</span>
                      </div>
                      <div class='answer-text'>{{choice}}</div>
                    </button>
                  {{/each}}
                {{else}}
                  <div class='no-answers'>
                    <div class='error-icon'>⚠️</div>
                    <div>No answer choices available</div>
                    <button class='skip-btn' {{on 'click' this.nextQuestion}}>
                      SKIP
                    </button>
                  </div>
                {{/if}}
              </div>
            </div>

            {{!  Result Overlay }}
            {{#if this.showResult}}
              <div class='result-overlay'>
                <div
                  class='result-popup
                    {{if
                      (eq
                        (get this.selectedAnswers this.currentQuestion)
                        this.currentCorrectAnswerText
                      )
                      "success"
                      "failure"
                    }}'
                >
                  <div class='result-message'>{{this.resultMessage}}</div>
                </div>
              </div>
            {{/if}}
          </div>

        {{else if (eq this.gameState 'completed')}}
          {{!  Victory Screen }}
          <div class='victory-screen'>
            <div class='victory-header'>
              <div class='victory-title'>QUIZ COMPLETE!</div>
              <div class='victory-subtitle'>Well played, Quiz Master!</div>
            </div>

            <div class='final-stats'>
              <div class='main-score'>
                <div class='score-label'>FINAL SCORE</div>
                <div class='score-value'>{{this.score}}</div>
              </div>

              {{! Enhanced stats with detailed breakdown }}
              <div class='performance-breakdown'>
                <div class='breakdown-header'>
                  <div class='breakdown-title'>PERFORMANCE ANALYSIS</div>
                </div>

                <div class='results-grid'>
                  {{! Correct answers block }}
                  <div class='result-block correct'>
                    <div class='block-icon'>✓</div>
                    <div class='block-number'>{{@model.correctAnswers}}</div>
                    <div class='block-label'>CORRECT</div>
                  </div>

                  {{! Wrong answers block }}
                  <div class='result-block wrong'>
                    <div class='block-icon'>✗</div>
                    <div class='block-number'>{{subtract
                        this.totalQuestions
                        this.correctAnswers
                      }}</div>
                    <div class='block-label'>WRONG</div>
                  </div>

                  {{! Accuracy percentage }}
                  <div class='result-block accuracy'>
                    <div class='block-icon'>%</div>
                    <div class='block-number'>{{@model.percentage}}</div>
                    <div class='block-label'>ACCURACY</div>
                  </div>
                </div>

                {{! Score breakdown with points explanation }}
                <div class='score-breakdown'>
                  <div class='breakdown-item'>
                    <span class='breakdown-desc'>Points per Question</span>
                    <span class='breakdown-points'>{{this.pointsPerQuestion}}
                      pts</span>
                  </div>
                  <div class='breakdown-item'>
                    <span class='breakdown-desc'>Correct Answers</span>
                    <span
                      class='breakdown-points'
                    >{{@model.correctAnswers}}/{{this.totalQuestions}}</span>
                  </div>
                  <div class='breakdown-total'>
                    <span class='total-label'>TOTAL SCORE</span>
                    <span class='total-points'>{{this.score}}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class='victory-actions'>
              <button
                class='action-btn primary'
                {{on 'click' this.restartQuiz}}
              >
                <span class='btn-label'>PLAY AGAIN</span>
              </button>
              <button
                class='action-btn secondary'
                {{on 'click' this.returnToMenu}}
              >
                <span class='btn-label'>MAIN MENU</span>
              </button>
            </div>
          </div>

        {{else if (eq this.gameState 'gameOver')}}
          {{!  Game Over Screen }}
          <div class='game-over-screen'>
            <div class='game-over-title'>GAME OVER</div>
            <div class='game-over-subtitle'>Better luck next time!</div>

            <div class='final-score'>
              <div class='score-label'>FINAL SCORE</div>
              <div class='score-value'>{{this.score}}</div>
            </div>

            {{! Enhanced game over stats with detailed breakdown }}
            <div class='game-over-breakdown'>
              <div class='breakdown-header'>
                <div class='breakdown-title'>FINAL RESULTS</div>
              </div>

              <div class='results-grid'>
                {{! Correct answers block }}
                <div class='result-block correct'>
                  <div class='block-icon'>✓</div>
                  <div class='block-number'>{{if
                      @model.correctAnswers
                      @model.correctAnswers
                      0
                    }}</div>
                  <div class='block-label'>CORRECT</div>
                </div>

                {{! Wrong answers block }}
                <div class='result-block wrong'>
                  <div class='block-icon'>✗</div>
                  <div class='block-number'>{{subtract
                      this.totalQuestions
                      (if @model.correctAnswers @model.correctAnswers 0)
                    }}</div>
                  <div class='block-label'>WRONG</div>
                </div>

                {{! Accuracy percentage }}
                <div class='result-block accuracy'>
                  <div class='block-icon'>%</div>
                  <div class='block-number'>{{if
                      @model.percentage
                      @model.percentage
                      0
                    }}</div>
                  <div class='block-label'>ACCURACY</div>
                </div>
              </div>

              {{! Summary text }}
              <div class='game-over-summary'>
                You answered
                {{if @model.correctAnswers @model.correctAnswers 0}}
                out of
                {{this.totalQuestions}}
                questions correctly for
                {{if @model.percentage @model.percentage 0}}% accuracy.
              </div>
            </div>

            <div class='game-over-actions'>
              <button class='action-btn primary' {{on 'click' this.startQuiz}}>
                <span class='btn-label'>TRY AGAIN</span>
              </button>
              <button
                class='action-btn secondary'
                {{on 'click' this.returnToMenu}}
              >
                <span class='btn-label'>MAIN MENU</span>
              </button>
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      .game-arena {
        container-type: inline-size;
        /* Structural Typography System */
        font-family:
          'JetBrains Mono', 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
        width: 100%;
        min-height: 100vh;
        background: 
          /* Board-formed concrete texture */
          linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.02) 0px,
            transparent 1px,
            transparent 15px,
            rgba(0, 0, 0, 0.02) 16px
          ),
          /* Concrete aggregate pattern */
            radial-gradient(
              circle at 25% 25%,
              rgba(0, 0, 0, 0.008) 1px,
              transparent 1px
            ),
          radial-gradient(
            circle at 75% 75%,
            rgba(0, 0, 0, 0.008) 1px,
            transparent 1px
          ),
          /* Base concrete surface */
            linear-gradient(180deg, #d4d4d4 0%, #a3a3a3 100%);
        background-size:
          16px 100%,
          8px 8px,
          12px 12px,
          100% 100%;
        color: #171717;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        /* BRUTALIST ARCHITECTURAL SYSTEM */
        --concrete-raw: #d4d4d4; /* Fresh cast concrete */
        --concrete-aged: #a3a3a3; /* Weathered concrete */
        --concrete-shadow: #737373; /* Deep shadow areas */
        --concrete-deep: #525252; /* Recessed surfaces */
        --steel-structure: #171717; /* Exposed steel/rebar */
        /* FUNCTIONAL ACCENT COLORS - Construction Industry Standard */
        --safety-orange: #dc2626; /* Critical actions, danger */
        --warning-yellow: #f59e0b; /* Caution, attention needed */
        --success-green: #059669; /* Completed, correct, safe */
        --info-blue: #1d4ed8; /* Information, navigation */
        --neutral-gray: #6b7280; /* Secondary information */
        /* Architectural Measurements - Based on 8px module */
        --module-unit: 8px;
        --structural-thickness: 4px;
        --joint-gap: 2px;
        --cast-depth: 8px;
        --panel-height: calc(var(--module-unit) * 8);
        /* Material Properties */
        --structural-border: var(--structural-thickness) solid
          var(--steel-structure);
        --cast-shadow: var(--cast-depth) var(--cast-depth) 0
          var(--steel-structure);
        --joint-line: var(--joint-gap) solid var(--concrete-shadow);
        --relief-inset: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        /* REALISTIC ARCHITECTURAL SHADOWS - Based on concrete overhang depths */
        --shadow-minimal: 2px 2px 0 var(--steel-structure); /* Panel edges */
        --shadow-standard: 4px 4px 0 var(--steel-structure); /* Button depth */
        --shadow-deep: 8px 8px 0 var(--steel-structure); /* Major elements */
        --shadow-overhang: 12px 12px 0 var(--steel-structure); /* Structural overhangs */
        --shadow-soften: 0 4px 8px rgba(23, 23, 23, 0.15); /* Ambient architectural lighting */
        /* Typography - Architectural Drafting Standards */
        --font-structural: 'JetBrains Mono', monospace;
        --letter-precise: -0.025em;
        --line-architectural: 1.2;
        --weight-structural: 600;
        --weight-monumental: 900;
        /* Spatial System */
        --breathing-room: calc(var(--module-unit) * 3);
        --separation-joint: calc(var(--module-unit) * 2);
        --structural-gap: var(--module-unit);
      }
      /* ARCHITECTURAL FRAMEWORK OVERLAY */
      .game-arena::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        /* Construction grid - visible framework */
        background-image:
          /* Vertical structural grid */
          linear-gradient(
            90deg,
            transparent calc(16.666% - 1px),
            rgba(23, 23, 23, 0.05) calc(16.666% - 1px),
            rgba(23, 23, 23, 0.05) calc(16.666% + 1px),
            transparent calc(16.666% + 1px)
          ),
          /* Horizontal structural grid */
            linear-gradient(
              0deg,
              transparent calc(12.5% - 1px),
              rgba(23, 23, 23, 0.05) calc(12.5% - 1px),
              rgba(23, 23, 23, 0.05) calc(12.5% + 1px),
              transparent calc(12.5% + 1px)
            ),
          /* Fine construction marks */
            radial-gradient(
              circle at 2px 2px,
              rgba(23, 23, 23, 0.1) 1px,
              transparent 1px
            );
        background-size:
          16.666% 100%,
          100% 12.5%,
          32px 32px;
        pointer-events: none;
        opacity: 0.4;
        z-index: 1;
      }
      /* Blueprint corner marks */
      .game-arena::after {
        content: '';
        position: absolute;
        top: var(--breathing-room);
        left: var(--breathing-room);
        right: var(--breathing-room);
        bottom: var(--breathing-room);
        border: 1px solid rgba(23, 23, 23, 0.1);
        pointer-events: none;
        z-index: 1;
      }
      .game-hud {
        width: 100%;
        max-width: 1200px;
        min-height: 100vh;
        padding: var(--breathing-room);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        z-index: 10;
      }
      /* ARCHITECTURAL COMMAND INTERFACE */
      .main-menu {
        text-align: left;
        max-width: 720px;
        width: 100%;
        background: var(--concrete-raw);
        border: var(--structural-border);
        padding: calc(var(--breathing-room) * 2);
        box-shadow: var(--cast-shadow);
        position: relative;
        isolation: isolate;
      }
      /* Blueprint header block */
      .main-menu::before {
        content: 'COGNITIVE ASSESSMENT PROTOCOL v2.1';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: var(--panel-height);
        background: var(--steel-structure);
        color: var(--concrete-raw);
        display: flex;
        align-items: center;
        padding: 0 var(--breathing-room);
        font-size: 0.75rem;
        font-weight: var(--weight-structural);
        letter-spacing: var(--letter-precise);
        text-transform: uppercase;
        font-family: var(--font-structural);
        border-bottom: var(--joint-line);
      }
      .game-logo {
        position: relative;
        margin-bottom: calc(var(--breathing-room) * 2);
        margin-top: calc(var(--panel-height) + var(--breathing-room));
        border-bottom: var(--structural-border);
        padding-bottom: calc(var(--breathing-room) * 1.5);
      }
      .logo-text {
        position: relative;
        z-index: 2;
      }
      .title-main {
        display: block;
        font-size: clamp(2.5rem, 8vw, 5rem);
        font-weight: var(--weight-monumental);
        color: var(--steel-structure);
        letter-spacing: var(--letter-precise);
        margin-bottom: var(--structural-gap);
        text-transform: uppercase;
        line-height: var(--line-architectural);
        font-family: var(--font-structural);
        text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.1);
      }
      .title-sub {
        display: inline-block;
        font-size: 0.875rem;
        font-weight: var(--weight-structural);
        color: var(--concrete-raw);
        letter-spacing: 0.15em;
        text-transform: uppercase;
        background: var(--steel-structure);
        padding: var(--structural-gap) calc(var(--structural-gap) * 2);
        border: var(--joint-line);
        font-family: var(--font-structural);
        box-shadow: var(--relief-inset);
      }
      .high-score {
        background: var(--concrete-aged);
        border: var(--structural-border);
        padding: calc(var(--breathing-room) * 1.5) var(--breathing-room);
        margin-bottom: var(--breathing-room);
        box-shadow: var(--cast-shadow);
        position: relative;
      }
      /* Achievement plaque styling */
      .high-score::before {
        content: 'PERFORMANCE RECORD';
        position: absolute;
        top: calc(var(--structural-gap) * -1);
        left: var(--breathing-room);
        background: var(--safety-orange);
        color: var(--concrete-raw);
        padding: calc(var(--structural-gap) / 2) var(--structural-gap);
        font-size: 0.625rem;
        font-weight: var(--weight-structural);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-family: var(--font-structural);
        border: var(--joint-line);
      }
      .score-label {
        font-size: 0.75rem;
        color: var(--steel-structure);
        margin-bottom: var(--structural-gap);
        letter-spacing: 0.08em;
        font-weight: var(--weight-structural);
        text-transform: uppercase;
        font-family: var(--font-structural);
      }
      .score-value {
        font-size: 2.5rem;
        font-weight: var(--weight-monumental);
        color: var(--steel-structure);
        font-family: var(--font-structural);
        line-height: var(--line-architectural);
      }
      .quiz-name {
        font-size: 1.25rem;
        font-weight: var(--weight-structural);
        color: var(--steel-structure);
        margin: var(--breathing-room) 0;
        text-transform: uppercase;
        letter-spacing: var(--letter-precise);
        font-family: var(--font-structural);
        line-height: var(--line-architectural);
      }
      .subject-chip {
        display: inline-block;
        background: var(--info-blue);
        color: var(--concrete-raw);
        padding: calc(var(--structural-gap) * 2) calc(var(--structural-gap) * 3);
        font-size: 0.8125rem;
        font-weight: var(--weight-structural);
        margin-bottom: var(--breathing-room);
        border: var(--structural-border);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-family: var(--font-structural);
        box-shadow: var(--shadow-standard);
        position: relative;
        margin-top: calc(var(--structural-gap) * 2); /* Space for label */
      }
      /* Classification marking - properly positioned above */
      .subject-chip::before {
        content: 'SUBJECT:';
        position: absolute;
        top: calc(var(--structural-gap) * -3);
        left: 0;
        background: var(--neutral-gray);
        color: var(--concrete-raw);
        padding: calc(var(--structural-gap) / 2) var(--structural-gap);
        font-size: 0.5rem;
        font-weight: var(--weight-structural);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border: var(--structural-border);
        box-shadow: var(--shadow-minimal);
      }
      .game-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 0;
        margin: var(--breathing-room) 0;
        border: var(--structural-border);
        background: var(--concrete-aged);
      }
      .stat-item {
        display: flex;
        align-items: center;
        gap: var(--structural-gap);
        background: var(--concrete-raw);
        padding: calc(var(--breathing-room) / 2) var(--breathing-room);
        border-right: var(--joint-line);
        border-bottom: var(--joint-line);
        position: relative;
        min-height: calc(var(--panel-height) - var(--structural-thickness));
      }
      .stat-item:last-child {
      }
      .stat-item::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 4px;
        background: var(--steel-structure);
      }
      .stat-icon {
        font-size: 1rem;
        color: var(--steel-structure);
        filter: none;
        width: 24px;
        text-align: center;
      }
      .stat-text {
        font-size: 0.75rem;
        font-weight: var(--weight-structural);
        color: var(--steel-structure);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-family: var(--font-structural);
        line-height: var(--line-architectural);
      }
      .start-game-btn {
        position: relative;
        background: var(--success-green);
        border: var(--structural-border);
        padding: calc(var(--breathing-room) * 1.5)
          calc(var(--breathing-room) * 3);
        font-family: var(--font-structural);
        font-size: 1rem;
        font-weight: var(--weight-structural);
        color: var(--concrete-raw);
        cursor: pointer;
        margin: calc(var(--breathing-room) + var(--structural-gap) * 2) 0
          var(--breathing-room);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        transition: all 0.15s ease;
        overflow: visible;
        box-shadow: var(--shadow-deep), var(--shadow-soften);
        min-width: 280px;
        text-align: center;
      }
      /* Command button construction details - properly positioned */
      .start-game-btn::before {
        content: 'INITIATE';
        position: absolute;
        top: calc(var(--structural-gap) * -3);
        left: 0;
        background: var(--warning-yellow);
        color: var(--steel-structure);
        padding: calc(var(--structural-gap) / 2) var(--structural-gap);
        font-size: 0.5rem;
        font-weight: var(--weight-structural);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border: var(--structural-border);
        box-shadow: var(--shadow-minimal);
      }
      .start-game-btn:hover {
        transform: translate(
          var(--structural-thickness),
          var(--structural-thickness)
        );
        box-shadow:
          calc(var(--cast-depth) - var(--structural-thickness))
            calc(var(--cast-depth) - var(--structural-thickness)) 0
            var(--steel-structure),
          var(--shadow-soften);
        background: var(--safety-orange);
        color: var(--steel-structure);
      }
      .start-game-btn:hover::before {
        background: var(--steel-structure);
        color: var(--concrete-raw);
      }
      .start-game-btn:active {
        transform: translate(var(--cast-depth), var(--cast-depth));
        box-shadow: var(--shadow-soften);
      }
      .btn-glow {
        display: none;
      }
      .game-tips {
        margin-top: calc(var(--breathing-room) * 2);
        background: var(--concrete-aged);
        border: var(--structural-border);
        padding: calc(var(--breathing-room) * 1.5);
        box-shadow:
          var(--shadow-standard),
          inset 0 2px 4px rgba(0, 0, 0, 0.05);
        position: relative;
      }
      /* Tips section header */
      .game-tips::before {
        content: 'OPERATIONAL NOTES';
        position: absolute;
        top: calc(var(--structural-gap) * -2);
        left: calc(var(--breathing-room) / 2);
        background: var(--info-blue);
        color: var(--concrete-raw);
        padding: calc(var(--structural-gap) / 2) var(--structural-gap);
        font-size: 0.5rem;
        font-weight: var(--weight-structural);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border: var(--structural-border);
        box-shadow: var(--shadow-minimal);
        font-family: var(--font-structural);
      }
      .tip {
        margin: calc(var(--structural-gap) * 2) 0;
        font-size: 0.75rem;
        color: var(--steel-structure);
        font-weight: var(--weight-structural);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        font-family: var(--font-structural);
        padding-left: calc(var(--breathing-room) / 2);
        border-left: calc(var(--structural-gap) / 2) solid var(--neutral-gray);
      }
      /*  Gameplay Screen - Brutalist */
      .gameplay-screen {
        width: 100%;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: var(--surface-raw);
        border: var(--border-thick);
        box-shadow: var(--box-shadow);
        padding: 2rem;
      }
      .top-hud {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 2rem;
        background: var(--surface-dark);
        border: var(--border-medium);
        margin-bottom: 2rem;
      }
      .hud-left,
      .hud-right {
        display: flex;
        gap: 0;
        align-items: center;
      }
      .score-display,
      .streak-display {
        text-align: center;
        background: var(--surface-raw);
        border: 2px solid #000000;

        padding: 0.75rem 1rem;
        min-width: 80px;
      }
      .hud-right .streak-display,
      .hud-right .lives-display:last-child {
        border-right: 2px solid #000000;
      }
      .score-label,
      .streak-label {
        font-size: 0.7rem;
        color: #000000;
        margin-bottom: 0.25rem;
        letter-spacing: 0.1em;
        font-weight: 700;
        text-transform: uppercase;
      }
      .score-value,
      .streak-value {
        font-size: 1.2rem;
        font-weight: 900;
        color: #000000;
        font-family: 'JetBrains Mono', monospace;
      }
      .streak-value.active {
        color: var(--accent-red);
        background: var(--surface-black);
        padding: 0.25rem 0.5rem;
      }
      .question-progress {
        text-align: center;
        min-width: 200px;
        background: var(--surface-raw);
        border: 2px solid #000000;
        padding: 1rem;
      }
      .progress-text {
        color: #000000;
        font-size: 1rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-family: 'JetBrains Mono', monospace;
      }
      .progress-bar {
        width: 100%;
        height: 12px;
        background: var(--surface-dark);
        border: 2px solid #000000;
        overflow: hidden;
        position: relative;
      }
      .progress-fill {
        height: 100%;
        background: var(--surface-black);
        transition: width 0.3s ease;
        border-right: 2px solid #000000;
      }
      .timer-display {
        position: relative;
        background: var(--surface-raw);
        border: 2px solid #000000;
        padding: 1rem;
      }
      .timer-ring {
        width: 80px;
        height: 80px;
        border: 4px solid #000000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--surface-dark);
      }
      .timer-value {
        font-size: 1rem;
        font-weight: 900;
        color: #000000;
        font-family: 'JetBrains Mono', monospace;
      }
      .lives-display {
        display: flex;
        gap: 0;
        background: var(--surface-raw);
        border: 2px solid #000000;

        padding: 1rem;
      }
      .life-heart {
        width: 24px;
        height: 24px;
        background: var(--success-green);
        border: var(--structural-border);
        transition: all 0.3s ease;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
      }
      .life-heart:last-child {
        border-right: var(--structural-border);
      }
      .life-heart.lost {
        background: var(--safety-orange);
        opacity: 0.7;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
      }
      /*  Question Arena - Brutalist */
      .question-arena {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 0;
      }
      .question-panel {
        text-align: left;
        margin-bottom: 3rem;
        background: var(--surface-raw);
        border: var(--border-thick);
        padding: 2rem;
        position: relative;
        overflow: hidden;
        box-shadow: var(--box-shadow);
      }
      .question-panel::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 8px;
        background: var(--surface-black);
        border-bottom: 2px solid #000000;
      }
      .question-number {
        font-size: 1rem;
        font-weight: var(--weight-structural);
        margin-bottom: calc(var(--breathing-room) * 1.5);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        background: var(--warning-yellow);
        color: var(--steel-structure);
        padding: calc(var(--structural-gap) * 2)
          calc(var(--breathing-room) * 1.5);
        border: var(--structural-border);
        display: inline-block;
        font-family: var(--font-structural);
        box-shadow: var(--shadow-standard);
        position: relative;
      }
      .question-number::before {
        content: 'ITEM';
        position: absolute;
        top: calc(var(--structural-gap) * -2);
        left: 0;
        background: var(--neutral-gray);
        color: var(--concrete-raw);
        padding: calc(var(--structural-gap) / 4) calc(var(--structural-gap) / 2);
        font-size: 0.5rem;
        font-weight: var(--weight-structural);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border: 1px solid var(--steel-structure);
        box-shadow: var(--shadow-minimal);
      }
      .question-text {
        font-size: 1.5rem;
        font-weight: 700;
        color: #000000;
        line-height: 1.4;
        text-transform: uppercase;
        letter-spacing: -0.02em;
        font-family: 'JetBrains Mono', monospace;
      }
      .answers-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
        max-width: 800px;
        margin: 0;
        border: var(--border-thick);
      }
      .answer-btn {
        position: relative;
        background: var(--surface-raw);
        border: 2px solid #000000;
        padding: 1.5rem;
        color: #000000;
        font-family: 'JetBrains Mono', monospace;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 1rem;
        min-height: 80px;
        overflow: hidden;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: -0.02em;
      }
      .answer-btn:nth-child(even) {
        border-right: 2px solid #000000;
      }
      .answer-btn:nth-last-child(-n + 2) {
        border-bottom: 2px solid #000000;
      }
      .answer-btn:hover:not(:disabled) {
        background: var(--surface-dark);
        transform: none;
      }
      .answer-btn.selected {
        background: var(--surface-black);
        color: #ffffff;
      }
      .answer-btn.correct {
        background: var(--success-green);
        color: white;
        box-shadow:
          var(--shadow-standard),
          0 0 0 2px var(--success-green),
          inset 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .answer-btn.correct .answer-letter {
        background: white;
        color: var(--success-green);
        border-color: var(--success-green);
      }
      .answer-btn.wrong {
        background: var(--safety-orange);
        color: white;
        box-shadow:
          var(--shadow-standard),
          0 0 0 2px var(--safety-orange),
          inset 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .answer-btn.wrong .answer-letter {
        background: white;
        color: var(--safety-orange);
        border-color: var(--safety-orange);
      }
      /* Professional motion design with proper physics-based animation */
      .answer-btn.flashing {
        animation:
          selection-anticipation 0.1s cubic-bezier(0.68, -0.55, 0.265, 1.55),
          selection-confirmation 0.4s 0.1s cubic-bezier(0.215, 0.61, 0.355, 1),
          selection-settle 0.2s 0.5s cubic-bezier(0.19, 1, 0.22, 1);
        animation-fill-mode: forwards;
        background: var(--warning-yellow);
        color: var(--steel-structure);
        border-color: var(--warning-yellow);
        transform-origin: center center;
        position: relative;
        z-index: 10;
      }
      .answer-btn.flashing::before {
        content: '';
        position: absolute;
        top: -8px;
        left: -8px;
        right: -8px;
        bottom: -8px;
        background: radial-gradient(
          circle,
          rgba(245, 158, 11, 0.4) 0%,
          rgba(245, 158, 11, 0.2) 50%,
          transparent 70%
        );
        border-radius: inherit;
        animation:
          glow-expand 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94),
          glow-pulse 1.2s 0.6s ease-in-out infinite;
        z-index: -1;
      }
      .answer-btn.flashing::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          45deg,
          transparent 40%,
          rgba(255, 255, 255, 0.6) 50%,
          transparent 60%
        );
        animation: shimmer-sweep 0.8s 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        border-radius: inherit;
        z-index: 1;
        pointer-events: none;
      }
      .answer-btn.flashing .answer-letter {
        background: var(--steel-structure);
        color: var(--warning-yellow);
        border-color: var(--steel-structure);
        animation:
          letter-anticipation 0.1s cubic-bezier(0.68, -0.55, 0.265, 1.55),
          letter-emphasis 0.3s 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94),
          letter-settle 0.3s 0.4s cubic-bezier(0.19, 1, 0.22, 1);
        animation-fill-mode: forwards;
        transform-origin: center center;
        position: relative;
        overflow: hidden;
      }
      .answer-btn.flashing .answer-letter::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(245, 158, 11, 0.8),
          transparent
        );
        animation: letter-sweep 0.5s 0.2s ease-out;
      }
      /* ANTICIPATION PHASE: Micro-compression before expansion */
      @keyframes selection-anticipation {
        0% {
          transform: scale(1) rotateZ(0deg);
          filter: brightness(1) saturate(1);
        }
        100% {
          transform: scale(0.96) rotateZ(-1deg);
          filter: brightness(1.1) saturate(1.2);
        }
      }
      /* CONFIRMATION PHASE: Dramatic expansion with spring physics */
      @keyframes selection-confirmation {
        0% {
          transform: scale(0.96) rotateZ(-1deg);
          box-shadow:
            var(--shadow-standard),
            0 0 0 0px rgba(245, 158, 11, 0);
          filter: brightness(1.1) saturate(1.2);
        }
        30% {
          transform: scale(1.12) rotateZ(1deg);
          box-shadow:
            var(--shadow-deep),
            0 0 0 12px rgba(245, 158, 11, 0.6),
            inset 0 0 30px rgba(245, 158, 11, 0.4);
          filter: brightness(1.3) saturate(1.5);
        }
        60% {
          transform: scale(1.05) rotateZ(0.5deg);
          box-shadow:
            var(--shadow-deep),
            0 0 0 8px rgba(245, 158, 11, 0.5),
            inset 0 0 25px rgba(245, 158, 11, 0.3);
          filter: brightness(1.2) saturate(1.3);
        }
        100% {
          transform: scale(1.06) rotateZ(0deg);
          box-shadow:
            var(--shadow-standard),
            0 0 0 6px rgba(245, 158, 11, 0.4),
            inset 0 0 20px rgba(245, 158, 11, 0.25);
          filter: brightness(1.15) saturate(1.2);
        }
      }
      /* SETTLE PHASE: Gentle return with slight overshoot */
      @keyframes selection-settle {
        0% {
          transform: scale(1.06) rotateZ(0deg);
          filter: brightness(1.15) saturate(1.2);
        }
        70% {
          transform: scale(1.01) rotateZ(-0.2deg);
          filter: brightness(1.05) saturate(1.1);
        }
        100% {
          transform: scale(1.02) rotateZ(0deg);
          filter: brightness(1.08) saturate(1.15);
        }
      }
      /* GLOW EFFECTS: Sophisticated layered lighting */
      @keyframes glow-expand {
        0% {
          transform: scale(0.8);
          opacity: 0;
        }
        40% {
          transform: scale(1.2);
          opacity: 0.8;
        }
        100% {
          transform: scale(1);
          opacity: 0.6;
        }
      }
      @keyframes glow-pulse {
        0%,
        100% {
          opacity: 0.6;
          transform: scale(1);
        }
        50% {
          opacity: 0.9;
          transform: scale(1.05);
        }
      }
      /* SHIMMER SWEEP: Premium highlight effect */
      @keyframes shimmer-sweep {
        0% {
          transform: translateX(-100%) skewX(-15deg);
          opacity: 0;
        }
        20% {
          opacity: 1;
        }
        80% {
          opacity: 1;
        }
        100% {
          transform: translateX(200%) skewX(-15deg);
          opacity: 0;
        }
      }
      /* LETTER ANIMATION: Micro-interactions for typography */
      @keyframes letter-anticipation {
        0% {
          transform: scale(1) rotateY(0deg);
          filter: drop-shadow(0 0 0 transparent);
        }
        100% {
          transform: scale(0.9) rotateY(-5deg);
          filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.2));
        }
      }
      @keyframes letter-emphasis {
        0% {
          transform: scale(0.9) rotateY(-5deg);
          filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.2));
        }
        40% {
          transform: scale(1.25) rotateY(5deg);
          filter: drop-shadow(4px 4px 8px rgba(245, 158, 11, 0.4));
        }
        70% {
          transform: scale(1.1) rotateY(-2deg);
          filter: drop-shadow(3px 3px 6px rgba(245, 158, 11, 0.3));
        }
        100% {
          transform: scale(1.15) rotateY(0deg);
          filter: drop-shadow(2px 2px 4px rgba(245, 158, 11, 0.2));
        }
      }
      @keyframes letter-settle {
        0% {
          transform: scale(1.15) rotateY(0deg);
          filter: drop-shadow(2px 2px 4px rgba(245, 158, 11, 0.2));
        }
        60% {
          transform: scale(0.98) rotateY(1deg);
          filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.1));
        }
        100% {
          transform: scale(1.05) rotateY(0deg);
          filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.15));
        }
      }
      @keyframes letter-sweep {
        0% {
          left: -100%;
          opacity: 0;
        }
        20% {
          opacity: 1;
        }
        80% {
          opacity: 1;
        }
        100% {
          left: 100%;
          opacity: 0;
        }
      }
      .answer-letter {
        width: 40px;
        height: 40px;
        background: var(--steel-structure);
        border: var(--structural-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        font-weight: var(--weight-monumental);
        color: var(--concrete-raw);
        flex-shrink: 0;
        font-family: var(--font-structural);
        box-shadow: var(--shadow-minimal);
        position: relative;
      }
      .letter-main {
        font-size: 1.1rem;
        font-weight: var(--weight-monumental);
        line-height: 1;
      }
      .answer-text {
        flex: 1;
        text-align: left;
        font-weight: 600;
      }
      .no-answers {
        grid-column: 1 / -1;
        text-align: center;
        padding: 3rem;
        background: rgba(255, 102, 0, 0.1);
        border: 2px dashed var(--neon-orange);
        border-radius: 15px;
        color: var(--neon-orange);
      }
      .error-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }
      .skip-btn {
        background: linear-gradient(
          45deg,
          var(--neon-orange),
          var(--neon-pink)
        );
        border: none;
        border-radius: 10px;
        padding: 0.75rem 2rem;
        color: #000000;
        font-family: inherit;
        font-weight: 600;
        cursor: pointer;
        margin-top: 1rem;
        transition: all 0.3s ease;
      }
      .skip-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 25px rgba(255, 102, 0, 0.5);
      }
      /*  Result Overlay - Brutalist */
      .result-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .result-popup {
        background: var(--surface-raw);
        padding: 3rem;
        text-align: center;
        border: var(--border-thick);
        box-shadow: 16px 16px 0 #000000;
        animation: popup-appear 0.3s ease-out;
      }
      .result-popup.success {
        background: var(--success-green);
        color: var(--concrete-raw);
        border-color: var(--success-green);
        box-shadow: var(--shadow-overhang), var(--shadow-soften);
      }
      .result-popup.failure {
        background: var(--safety-orange);
        color: var(--concrete-raw);
        border-color: var(--safety-orange);
        box-shadow: var(--shadow-overhang), var(--shadow-soften);
      }
      @keyframes popup-appear {
        0% {
          opacity: 0;
          transform: translate(-8px, -8px);
        }
        100% {
          opacity: 1;
          transform: translate(0, 0);
        }
      }
      .result-message {
        font-size: 2rem;
        font-weight: 900;
        margin-bottom: 1rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-family: 'JetBrains Mono', monospace;
      }
      /*  Victory Screen - Brutalist */
      .victory-screen {
        text-align: left;
        max-width: 700px;
        width: 100%;
        background: var(--surface-raw);
        border: var(--border-thick);
        padding: 3rem;
        box-shadow: var(--box-shadow);
      }
      .victory-header {
        margin-bottom: 3rem;
        border-bottom: var(--border-medium);
        padding-bottom: 2rem;
      }
      .victory-title {
        font-size: 3rem;
        font-weight: 900;
        color: #000000;
        margin-bottom: 1rem;
        text-transform: uppercase;
        letter-spacing: -0.05em;
        font-family: 'JetBrains Mono', monospace;
        line-height: 0.9;
      }
      .victory-subtitle {
        font-size: 1.2rem;
        font-weight: var(--weight-structural);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        background: var(--success-green);
        color: var(--concrete-raw);
        padding: calc(var(--structural-gap) * 2)
          calc(var(--breathing-room) * 1.5);
        border: var(--structural-border);
        display: inline-block;
        font-family: var(--font-structural);
        box-shadow: var(--shadow-standard);
      }
      .final-stats {
        margin-bottom: 3rem;
      }
      .main-score {
        background: var(--surface-dark);
        border: var(--border-thick);
        padding: 2rem;
        margin-bottom: 2rem;
        box-shadow: var(--box-shadow);
      }
      .main-score .score-label {
        font-size: 1rem;
        color: #000000;
        margin-bottom: 1rem;
        letter-spacing: 0.1em;
        font-weight: 700;
        text-transform: uppercase;
      }
      .main-score .score-value {
        font-size: 3rem;
        font-weight: 900;
        color: #000000;
        font-family: 'JetBrains Mono', monospace;
      }
      /* Enhanced performance breakdown */
      .performance-breakdown {
        background: var(--surface-dark);
        border: var(--border-thick);
        padding: 2rem;
        box-shadow: var(--box-shadow);
      }
      .breakdown-header {
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: var(--border-medium);
      }
      .breakdown-title {
        font-size: 1rem;
        font-weight: 700;
        color: #000000;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-family: 'JetBrains Mono', monospace;
      }
      .results-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0;
        border: var(--border-thick);
        margin-bottom: 2rem;
      }
      .result-block {
        background: var(--surface-raw);
        border: 2px solid #000000;
        padding: 1.5rem 1rem;
        text-align: center;
        position: relative;
      }
      .result-block:last-child {
        border-right: 2px solid #000000;
      }
      .result-block.correct {
        background: rgba(5, 150, 105, 0.1);
      }
      .result-block.wrong {
        background: rgba(220, 38, 38, 0.1);
      }
      .result-block.accuracy {
        background: rgba(59, 130, 246, 0.1);
      }
      .block-icon {
        font-size: 1.5rem;
        margin-bottom: 0.5rem;
        filter: grayscale(1);
      }
      .result-block.correct .block-icon {
        color: var(--success-green);
        filter: none;
      }
      .result-block.wrong .block-icon {
        color: var(--safety-orange);
        filter: none;
      }
      .result-block.accuracy .block-icon {
        color: #3b82f6;
        filter: none;
      }
      .block-number {
        font-size: 1.8rem;
        font-weight: 900;
        color: #000000;
        margin-bottom: 0.5rem;
        font-family: 'JetBrains Mono', monospace;
        line-height: 1;
      }
      .block-label {
        font-size: 0.75rem;
        color: #000000;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      /* Score breakdown */
      .score-breakdown {
        background: var(--surface-raw);
        border: var(--border-medium);
        padding: 1.5rem;
        font-family: 'JetBrains Mono', monospace;
      }
      .breakdown-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--concrete-panel);
        font-size: 0.9rem;
      }
      .breakdown-item:last-of-type {
        border-bottom: none;
        margin-bottom: 1rem;
      }
      .breakdown-desc {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .breakdown-points {
        font-weight: 900;
        color: var(--success-green);
      }
      .breakdown-total {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 0 0;
        border-top: 2px solid #000000;
        font-size: 1.1rem;
      }
      .total-label {
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #000000;
      }
      .total-points {
        font-weight: 900;
        color: #000000;
        font-size: 1.3rem;
      }
      .victory-actions {
        display: flex;
        gap: 0;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      /*  Game Over Screen - Brutalist */
      .game-over-screen {
        text-align: left;
        max-width: 600px;
        width: 100%;
        background: var(--surface-dark);
        border: var(--border-thick);
        padding: 3rem;
        box-shadow: var(--box-shadow);
      }
      .game-over-title {
        font-size: 3rem;
        font-weight: 900;
        color: #000000;
        margin-bottom: 1rem;
        text-transform: uppercase;
        letter-spacing: -0.05em;
        font-family: 'JetBrains Mono', monospace;
        line-height: 0.9;
      }
      .game-over-subtitle {
        font-size: 1.2rem;
        color: #000000;
        margin-bottom: 3rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .final-score {
        background: var(--surface-raw);
        border: var(--border-thick);
        padding: 2rem;
        margin-bottom: 3rem;
        box-shadow: var(--box-shadow);
      }
      .game-over-actions {
        display: flex;
        gap: 0;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      /* Game over breakdown styling */
      .game-over-breakdown {
        background: var(--surface-dark);
        border: var(--border-thick);
        padding: 2rem;
        margin-bottom: 3rem;
        box-shadow: var(--box-shadow);
      }
      .game-over-breakdown .breakdown-header {
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: var(--border-medium);
      }
      .game-over-breakdown .breakdown-title {
        font-size: 1rem;
        font-weight: 700;
        color: #000000;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-family: 'JetBrains Mono', monospace;
      }
      .game-over-breakdown .results-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 0;
        border: var(--border-thick);
        margin-bottom: 2rem;
      }
      .game-over-breakdown .result-block {
        background: var(--surface-raw);
        border: 2px solid #000000;
        padding: 1.5rem 1rem;
        text-align: center;
        position: relative;
      }
      .game-over-breakdown .result-block:last-child {
        border-right: 2px solid #000000;
      }
      .game-over-breakdown .result-block.correct {
        background: rgba(5, 150, 105, 0.1);
      }
      .game-over-breakdown .result-block.wrong {
        background: rgba(220, 38, 38, 0.1);
      }
      .game-over-breakdown .result-block.accuracy {
        background: rgba(59, 130, 246, 0.1);
      }
      .game-over-breakdown .block-icon {
        font-size: 1.5rem;
        margin-bottom: 0.5rem;
        filter: grayscale(1);
      }
      .game-over-breakdown .result-block.correct .block-icon {
        color: var(--success-green);
        filter: none;
      }
      .game-over-breakdown .result-block.wrong .block-icon {
        color: var(--safety-orange);
        filter: none;
      }
      .game-over-breakdown .result-block.accuracy .block-icon {
        color: #3b82f6;
        filter: none;
      }
      .game-over-breakdown .block-number {
        font-size: 1.8rem;
        font-weight: 900;
        color: #000000;
        margin-bottom: 0.5rem;
        font-family: 'JetBrains Mono', monospace;
        line-height: 1;
      }
      .game-over-breakdown .block-label {
        font-size: 0.75rem;
        color: #000000;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .game-over-summary {
        background: var(--surface-raw);
        border: var(--border-medium);
        padding: 1.5rem;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.9rem;
        font-weight: 600;
        color: #000000;
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        line-height: 1.4;
      }
      /*  Action Buttons - Brutalist */
      .action-btn {
        background: var(--concrete-raw);
        border: var(--structural-border);
        padding: calc(var(--breathing-room) * 1.5)
          calc(var(--breathing-room) * 2.5);
        color: var(--steel-structure);
        font-family: var(--font-structural);
        font-size: 1rem;
        font-weight: var(--weight-structural);
        cursor: pointer;
        transition: all 0.2s ease;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        position: relative;
        overflow: hidden;
        box-shadow: var(--shadow-standard);
        margin-right: calc(var(--breathing-room) / 2);
        margin-bottom: calc(var(--breathing-room) / 2);
        border-radius: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .action-btn .btn-label {
        position: relative;
        z-index: 2;
        display: block;
      }
      .action-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--concrete-aged);
        transform: translateY(100%);
        transition: transform 0.2s ease;
        z-index: 1;
      }
      .action-btn.primary {
        background: var(--success-green);
        color: var(--concrete-raw);
        border-color: var(--success-green);
      }
      .action-btn.primary::before {
        background: var(--steel-structure);
      }
      .action-btn.secondary {
        background: var(--concrete-aged);
        color: var(--steel-structure);
        border-color: var(--steel-structure);
      }
      .action-btn.secondary::before {
        background: var(--warning-yellow);
      }
      .action-btn:hover {
        transform: translate(
          var(--structural-thickness),
          var(--structural-thickness)
        );
        box-shadow: calc(var(--cast-depth) - var(--structural-thickness))
          calc(var(--cast-depth) - var(--structural-thickness)) 0
          var(--steel-structure);
      }
      .action-btn:hover::before {
        transform: translateY(0);
      }
      .action-btn:active {
        transform: translate(var(--cast-depth), var(--cast-depth));
        box-shadow: none;
      }
      /* Enhanced streak display styling */
      .streak-value {
        position: relative;
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 2px;
      }
      .streak-number {
        font-size: 1.2rem;
        font-weight: 900;
        line-height: 1;
      }
      .streak-multiplier {
        font-size: 0.9rem;
        font-weight: 700;
        opacity: 0.8;
      }
      .streak-value.active .streak-number {
        animation: streak-pulse 0.6s ease-in-out;
      }
      @keyframes streak-pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.1);
        }
      }
      /* Container Queries for Responsive Design */
      @container (width <= 768px) {
        .game-arena {
          min-height: 100vh;
          min-height: 100dvh; /* Dynamic viewport height for mobile */
        }
        .game-hud {
          padding: 1rem;
        }
        .title-main {
          font-size: 2.5rem;
        }
        .title-sub {
          font-size: 1rem;
          letter-spacing: 0.3em;
        }
        .game-stats {
          flex-direction: column;
        }
        .stat-item {
          justify-content: center;
        }
        .start-game-btn {
          padding: 1.2rem 2.5rem;
          font-size: 1rem;
        }
        .top-hud {
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
        }
        .hud-left,
        .hud-right {
          width: 100%;
          justify-content: space-around;
        }
        .answers-grid {
          grid-template-columns: 1fr;
          gap: 0.75rem;
          padding: 0 1rem;
        }
        .answer-btn {
          padding: 1rem;
          min-height: 60px;
        }
        .question-panel {
          padding: 1.5rem;
          margin-bottom: 2rem;
        }
        .question-text {
          font-size: 1.2rem;
        }
        .timer-ring {
          width: 60px;
          height: 60px;
        }
        .timer-value {
          font-size: 0.9rem;
        }
        .victory-title,
        .game-over-title {
          font-size: 2rem;
        }
        .main-score .score-value {
          font-size: 2rem;
        }
        .victory-actions,
        .game-over-actions {
          flex-direction: column;
          gap: 0.75rem;
        }
        .action-btn {
          width: 100%;
          max-width: 300px;
          margin: 0 auto;
        }
      }

      @container (width <= 480px) {
        .game-hud {
          padding: 0.5rem;
        }
        .question-arena {
          padding: 0 1rem;
        }
        .result-popup {
          padding: 2rem 1.5rem;
          margin: 1rem;
        }
        .result-message {
          font-size: 1.5rem;
        }
      }

      @container (width <= 400px) {
        .game-hud {
          padding: 0.25rem;
        }
        .title-main {
          font-size: 2rem;
        }
        .title-sub {
          font-size: 0.875rem;
        }
        .start-game-btn {
          padding: 1rem 2rem;
          font-size: 0.875rem;
        }
        .top-hud {
          padding: 0.75rem;
        }
        .answers-grid {
          padding: 0 0.75rem;
        }
        .answer-btn {
          padding: 0.75rem;
          min-height: 50px;
          font-size: 0.875rem;
        }
        .question-panel {
          padding: 1rem;
        }
        .question-text {
          font-size: 1rem;
        }
        .timer-ring {
          width: 50px;
          height: 50px;
        }
        .timer-value {
          font-size: 0.75rem;
        }
        .victory-title,
        .game-over-title {
          font-size: 1.75rem;
        }
        .main-score .score-value {
          font-size: 1.75rem;
        }
      }

      @container (width <= 320px) {
        .game-hud {
          padding: 0.125rem;
        }
        .title-main {
          font-size: 1.75rem;
        }
        .title-sub {
          font-size: 0.75rem;
        }
        .start-game-btn {
          padding: 0.875rem 1.5rem;
          font-size: 0.75rem;
        }
        .top-hud {
          padding: 0.5rem;
        }
        .answers-grid {
          padding: 0 0.5rem;
        }
        .answer-btn {
          padding: 0.5rem;
          min-height: 40px;
          font-size: 0.75rem;
        }
        .question-panel {
          padding: 0.75rem;
        }
        .question-text {
          font-size: 0.875rem;
        }
        .timer-ring {
          width: 40px;
          height: 40px;
        }
        .timer-value {
          font-size: 0.625rem;
        }
        .victory-title,
        .game-over-title {
          font-size: 1.5rem;
        }
        .main-score .score-value {
          font-size: 1.5rem;
        }
      }
      /*  High contrast mode support */
      @media (prefers-contrast: high) {
        .game-arena {
          background: #000000;
        }
        .answer-btn {
          border-width: 3px;
        }
        .answer-btn:hover {
          border-width: 4px;
        }
      }
      /*  Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        * {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
        .game-arena::before {
          animation: none;
        }
      }
    </style>
  </template>
}

// EMBEDDED FORMAT - Compact display following brutalist style
class GameQuizEmbedded extends Component<typeof GameQuizCard> {
  get scoreColor() {
    const score = this.args?.model?.percentage || 0;
    if (score >= 85) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 65) return 'satisfactory';
    if (score >= 50) return 'needs-work';
    return 'unsatisfactory';
  }

  <template>
    <div class='quiz-embedded'>
      <div class='quiz-header'>
        <div class='header-plate'>
          <div class='plate-classification'>GAME QUIZ PROTOCOL</div>
          <div class='plate-version'>v2.1</div>
        </div>
        <div class='header-title'>
          <h4 class='title-primary'>{{if
              @model.quizTitle
              @model.quizTitle
              'GAME QUIZ'
            }}</h4>
          <div class='title-meta'>
            {{#if @model.subject}}
              <span class='subject-tag'>{{@model.subject}}</span>
            {{/if}}
            <div class='difficulty-inline'>
              <@fields.difficulty @format='embedded' />
            </div>
          </div>
        </div>
      </div>

      <div class='quiz-content'>
        <div class='content-results'>
          <div class='results-panel completed'>
            <div class='panel-label'>PERFORMANCE ANALYSIS</div>
            <div class='score-display {{this.scoreColor}}'>
              <div class='score-circle'>
                <div class='score-number'>{{@model.percentage}}%</div>
              </div>
              <div class='score-details'>
                <div
                  class='correct-count'
                >{{@model.correctAnswers}}/{{@model.totalQuestions}}
                  correct</div>
                {{#if @model.highestGameScore}}
                  <div class='high-score'>High Score:
                    {{@model.highestGameScore}}</div>
                {{/if}}
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
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* BRUTALIST EMBEDDED FORMAT */
      .quiz-embedded {
        container-type: inline-size;
        width: 100%;
        height: 100%;
        font-family: 'JetBrains Mono', 'SF Mono', monospace;
        background: var(--concrete-base);
        border: var(--border-structural);
        position: relative;
        padding: calc(var(--unit) * 2);
        /* Brutalist variables */
        --concrete-base: #d4d4d4;
        --concrete-panel: #a3a3a3;
        --steel-frame: #171717;
        --safety-mark: #dc2626;
        --warning-amber: #f59e0b;
        --success-green: #059669;
        --unit: 4px;
        --border-structural: 2px solid var(--steel-frame);
        --shadow-cast: 4px 4px 0 var(--steel-frame);
        --inset-relief: inset 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .quiz-header {
        margin-bottom: calc(var(--unit) * 3);
      }

      .difficulty-section {
        margin-top: calc(var(--unit) * 2);
        padding: calc(var(--unit) * 2);
        background: var(--concrete-panel);
        border: var(--border-structural);
      }

      .header-plate {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--steel-frame);
        color: var(--concrete-base);
        padding: calc(var(--unit) * 2);
        margin-bottom: calc(var(--unit) * 2);
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .title-primary {
        font-size: 1.25rem;
        font-weight: 900;
        color: var(--steel-frame);
        text-transform: uppercase;
        letter-spacing: -0.02em;
        line-height: 1.1;
        margin: 0 0 calc(var(--unit) * 2);
      }

      .title-meta {
        display: flex;
        gap: calc(var(--unit) * 2);
        align-items: center;
      }

      .subject-tag {
        font-size: 0.625rem;
        font-weight: 600;
        padding: calc(var(--unit) / 2) var(--unit);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border: 1px solid var(--steel-frame);
        background: var(--concrete-panel);
        color: var(--steel-frame);
      }

      .difficulty-inline {
        margin-left: auto;
      }

      .quiz-content {
        display: flex;
        flex-direction: column;
        gap: calc(var(--unit) * 3);
      }

      .spec-panel,
      .results-panel,
      .status-panel {
        background: var(--concrete-panel);
        border: var(--border-structural);
        padding: calc(var(--unit) * 3);
      }

      .panel-label {
        font-size: 0.5rem;
        font-weight: 700;
        color: var(--steel-frame);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: calc(var(--unit) * 2);
        padding-bottom: calc(var(--unit) / 2);
        border-bottom: 1px solid var(--steel-frame);
      }

      .panel-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: calc(var(--unit) * 2);
      }

      .param-item {
        display: flex;
        flex-direction: column;
        gap: calc(var(--unit) / 2);
      }

      .param-label {
        font-size: 0.5rem;
        font-weight: 700;
        color: var(--steel-frame);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .param-value {
        font-size: 0.875rem;
        font-weight: 900;
        color: var(--steel-frame);
      }

      .score-display {
        display: flex;
        align-items: center;
        gap: calc(var(--unit) * 3);
        margin-bottom: calc(var(--unit) * 2);
      }

      .score-circle {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        border: var(--border-structural);
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--concrete-panel);
        flex-shrink: 0;
      }

      .score-display.excellent .score-circle {
        background: var(--success-green);
        color: white;
      }

      .score-display.good .score-circle {
        background: var(--warning-amber);
        color: var(--steel-frame);
      }

      .score-display.satisfactory .score-circle {
        background: var(--concrete-panel);
        color: var(--steel-frame);
      }

      .score-display.needs-work .score-circle {
        background: var(--safety-mark);
        color: white;
      }

      .score-display.unsatisfactory .score-circle {
        background: var(--steel-frame);
        color: var(--concrete-base);
      }

      .score-number {
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1;
      }

      .score-details {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: calc(var(--unit) / 2);
      }

      .correct-count {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--steel-frame);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .high-score {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .completion-time {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .completion-record {
        font-size: 0.5rem;
        font-weight: 600;
        color: var(--concrete-panel);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        text-align: center;
        padding-top: calc(var(--unit) * 2);
        border-top: 1px solid var(--steel-frame);
      }

      .standby-indicator {
        display: flex;
        align-items: center;
        gap: calc(var(--unit) * 2);
        margin-bottom: calc(var(--unit) * 2);
      }

      .indicator-light {
        width: calc(var(--unit) * 3);
        height: calc(var(--unit) * 3);
        border-radius: 50%;
        background: var(--success-green);
        border: 1px solid var(--steel-frame);
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.6;
        }
      }

      .indicator-text {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--steel-frame);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .deployment-specs {
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--concrete-panel);
        line-height: 1.3;
      }

      /* Container Queries for Responsive Design */
      @container (width <= 400px) {
        .quiz-embedded {
          --unit: 3px;
        }

        .quiz-header {
          margin-bottom: calc(var(--unit) * 2);
        }

        .header-plate {
          padding: calc(var(--unit) * 1.5);
          font-size: 0.5rem;
        }

        .title-primary {
          font-size: 1rem;
        }

        .title-meta {
          flex-direction: column;
          gap: calc(var(--unit) / 2);
        }

        .subject-tag {
          font-size: 0.5rem;
          padding: calc(var(--unit) / 4) calc(var(--unit) / 2);
        }

        .spec-panel,
        .results-panel {
          padding: calc(var(--unit) * 2);
        }

        .panel-grid {
          grid-template-columns: 1fr;
          gap: calc(var(--unit) * 1.5);
        }

        .results-primary {
          flex-direction: column;
          gap: calc(var(--unit) * 2);
        }

        .score-value {
          font-size: 1.5rem;
        }
      }

      @container (width <= 300px) {
        .quiz-embedded {
          --unit: 2px;
        }

        .title-primary {
          font-size: 0.875rem;
        }

        .param-value {
          font-size: 0.75rem;
        }

        .score-value {
          font-size: 1.25rem;
        }

        .breakdown-value {
          font-size: 0.625rem;
        }
      }

      @container (width <= 200px) {
        .quiz-embedded {
          --unit: 1px;
        }

        .quiz-content {
          gap: calc(var(--unit) * 2);
        }

        .spec-panel,
        .results-panel {
          padding: calc(var(--unit) * 1.5);
        }

        .title-primary {
          font-size: 0.75rem;
        }

        .score-value {
          font-size: 1rem;
        }
      }

      /* Reduced motion */
      @media (prefers-reduced-motion: reduce) {
        .indicator-light {
          animation: none;
        }
      }
    </style>
  </template>
}

class GameQuizFitted extends Component<typeof GameQuizCard> {
  get percentage() {
    return this.args?.model?.percentage ?? 0;
  }

  get totalQuestions() {
    return this.args?.model?.totalQuestions ?? 0;
  }

  get correctAnswers() {
    return this.args?.model?.correctAnswers ?? 0;
  }

  get title() {
    return this.args?.model?.quizTitle || 'Game Quiz';
  }

  get subject() {
    return this.args?.model?.subject;
  }

  <template>
    <div class='quiz-fitted'>
      <div class='fitted-header'>
        <div class='fitted-title'>{{this.title}}</div>
        <div class='fitted-meta'>
          {{#if this.subject}}
            <span class='meta-chip'>{{this.subject}}</span>
          {{/if}}
        </div>
      </div>

      <div class='fitted-stats'>
        <div class='fitted-score'>
          <div class='score-circle'>
            <div class='score-number'>{{this.percentage}}%</div>
          </div>
        </div>
        <div class='fitted-details'>
          <div class='detail-line'>Correct:
            {{this.correctAnswers}}
            /
            {{this.totalQuestions}}</div>
          {{#if @model.highestGameScore}}
            <div class='detail-line'>High Score:
              {{@model.highestGameScore}}</div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .quiz-fitted {
        container-type: inline-size;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        background: var(--concrete-base, #d4d4d4);
        border: 2px solid var(--steel-frame, #171717);
        font-family: 'JetBrains Mono', 'SF Mono', monospace;
      }

      .fitted-header {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .fitted-title {
        font-size: 0.9rem;
        font-weight: 900;
        color: var(--steel-frame, #171717);
        text-transform: uppercase;
        letter-spacing: -0.01em;
      }

      .fitted-meta {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .meta-chip {
        font-size: 0.6rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 6px;
        background: var(--concrete-panel, #a3a3a3);
        border: 1px solid var(--steel-frame, #171717);
        color: var(--steel-frame, #171717);
      }

      .fitted-stats {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 10px;
      }

      .score-circle {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid var(--steel-frame, #171717);
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--concrete-panel, #a3a3a3);
      }

      .score-number {
        font-size: 0.9rem;
        font-weight: 900;
      }

      .fitted-details {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.7rem;
        color: var(--steel-frame, #171717);
      }

      @container (width <= 280px) {
        .quiz-fitted {
          padding: 6px;
          gap: 6px;
        }
        .fitted-title {
          font-size: 0.8rem;
        }
        .score-circle {
          width: 40px;
          height: 40px;
        }
        .score-number {
          font-size: 0.8rem;
        }
      }
    </style>
  </template>
}

export class GameQuizCard extends CardDef {
  static displayName = 'Game Quiz';
  static icon = GamepadIcon;

  // Essential quiz fields
  @field quizTitle = contains(StringField);
  @field subject = contains(StringField);
  @field quizQuestions = containsMany(QuizQuestionField);
  @field timeLimit = contains(NumberField);
  @field difficulty = contains(QuizDifficultyField);
  @field isCompleted = contains(BooleanField);
  @field completedAt = contains(DatetimeField);
  @field correctAnswers = contains(NumberField);

  // High score tracking fields
  @field gameScore = contains(NumberField); // Current run score
  @field highestGameScore = contains(StringField); // Highest score ever recorded (string)

  @field totalQuestions = contains(NumberField, {
    computeVia: function (this: GameQuizCard) {
      try {
        return this.quizQuestions?.length || 0;
      } catch (e) {
        console.error('GameQuiz: Error computing totalQuestions', e);
        return 0;
      }
    },
  });

  @field percentage = contains(NumberField, {
    computeVia: function (this: GameQuizCard) {
      try {
        if (!this.totalQuestions || this.totalQuestions === 0) return 0;
        const correct = this.correctAnswers || 0;
        return Math.round((correct / this.totalQuestions) * 100);
      } catch (e) {
        console.error('GameQuiz: Error computing percentage', e);
        return 0;
      }
    },
  });

  @field gradeLevel = contains(StringField, {
    computeVia: function (this: GameQuizCard) {
      try {
        const score = this.percentage || 0;
        return `${score}%`;
      } catch (e) {
        console.error('GameQuiz: Error computing grade', e);
        return '0%';
      }
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: GameQuizCard) {
      try {
        const quiz = this.quizTitle || 'Game Quiz';
        const subject = this.subject ? ` - ${this.subject}` : '';
        return `${quiz}${subject}`;
      } catch (e) {
        console.error('GameQuiz: Error computing title', e);
        return 'Game Quiz';
      }
    },
  });

  static isolated = GameQuizIsolated;
  static embedded = GameQuizEmbedded;
  static fitted = GameQuizFitted;
}
