// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { Button, Pill } from '@cardstack/boxel-ui/components'; // ² Enhanced UI components
import {
  formatDateTime,
  formatDuration,
  eq,
  gt,
  subtract,
  multiply,
  or,
  and,
  not,
} from '@cardstack/boxel-ui/helpers'; // ³ Enhanced formatters
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency'; // ⁴ Async task handling
import ClockIcon from '@cardstack/boxel-icons/clock'; // ⁵ Icon import

class FocusTimerIsolated extends Component<typeof FocusTimerCard> {
  // ²³ Enhanced isolated format with Study Hub theming
  @tracked currentTime = 0;
  @tracked isRunning = false;
  @tracked currentPhase = 'ready'; // ready, focus, break, paused, completed
  @tracked sessionStartTime: Date | null = null; // ²⁴ Track session start
  @tracked currentCycleNumber = 1; // ²⁵ Current Pomodoro cycle

  // ²⁶ Enhanced time formatting with hours support
  get formattedTime() {
    const totalSeconds = this.currentTime;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  // ²⁷ Smart progress calculation with visual feedback
  get progressPercentage() {
    const phaseDuration =
      this.currentPhase === 'focus'
        ? (this.args?.model?.focusDuration || 25) * 60
        : (this.args?.model?.breakDuration || 5) * 60;

    const elapsed = phaseDuration - this.currentTime;
    return Math.max(0, Math.min(100, (elapsed / phaseDuration) * 100));
  }

  // ²⁸ Study Hub themed colors with additional phases
  get phaseColor() {
    return (
      {
        ready: '#6b7280', // Neutral gray
        focus: '#1e3a8a', // Deep Learning Blue (Study Hub primary)
        break: '#059669', // Progress Green (Study Hub secondary)
        paused: '#f59e0b', // Warm Amber (Study Hub accent)
        completed: '#059669', // Success green
      }[this.currentPhase] || '#6b7280'
    );
  }

  // ²⁹ Enhanced phase descriptions for better UX
  get phaseDescription() {
    const progress = this.sessionProgress;
    const currentCycle = Math.min(this.currentCycleNumber, progress.target);

    return (
      {
        ready:
          progress.completed === 0
            ? `Ready to start your first focus session`
            : `Ready to start cycle ${currentCycle} of ${progress.target}`,
        focus: `Focus time - Cycle ${currentCycle} of ${progress.target}`,
        break: `Break time - Completed cycle ${Math.min(
          currentCycle,
          progress.completed,
        )}`,
        paused: `Session paused - Cycle ${currentCycle}`,
        completed: `All ${progress.target} cycles completed! 🎉`,
      }[this.currentPhase] || 'Timer ready'
    );
  }

  // ³⁰ Control state logic - FIXED for better UX flow
  get canStart() {
    const progress = this.sessionProgress;
    return (
      (this.currentPhase === 'ready' || this.currentPhase === 'completed') &&
      progress.remaining > 0
    );
  }

  get canPause() {
    return (
      this.isRunning &&
      (this.currentPhase === 'focus' || this.currentPhase === 'break')
    );
  }

  get canResume() {
    return this.currentPhase === 'paused';
  }

  // ⁵⁶ NEW: Better completion check
  get isSessionComplete() {
    return this.sessionProgress.remaining === 0;
  }

  // ³¹ Session statistics
  get sessionProgress() {
    const completed = this.args?.model?.sessionsCompleted || 0;
    const target = this.args?.model?.targetSessions || 4;
    // ⁵⁵ FIXED: Ensure completed never exceeds target for UX consistency
    const safeCompleted = Math.min(completed, target);
    return {
      completed: safeCompleted,
      target,
      remaining: Math.max(0, target - safeCompleted),
    };
  }

  get totalSessionTime() {
    const focusTime =
      (this.args?.model?.focusDuration || 25) *
      (this.args?.model?.targetSessions || 4);
    const breakTime =
      (this.args?.model?.breakDuration || 5) *
      Math.max(0, (this.args?.model?.targetSessions || 4) - 1);
    return focusTime + breakTime;
  }

  get estimatedCompletion() {
    try {
      // ⁷⁸ FIXED: Use model's startTime if available, fall back to sessionStartTime
      const modelStartTime = this.args?.model?.startTime;
      const trackedStartTime = this.sessionStartTime;

      if (this.currentPhase === 'completed') return null;

      // Check if we have any valid start time
      if (!modelStartTime && !trackedStartTime) return null;

      // Use model start time if available, otherwise tracked time
      let startTime: Date;
      if (modelStartTime) {
        startTime =
          typeof modelStartTime === 'string'
            ? new Date(modelStartTime)
            : modelStartTime;
      } else if (trackedStartTime) {
        startTime = trackedStartTime;
      } else {
        return null;
      }

      // Validate the start time
      if (isNaN(startTime.getTime())) {
        console.warn(
          'FocusTimer: Invalid start time for completion calculation',
        );
        return null;
      }

      const remaining =
        this.sessionProgress.remaining *
        ((this.args?.model?.focusDuration || 25) * 60 * 1000);

      const completionTime = new Date(Date.now() + remaining);

      // Validate the calculated completion time
      if (isNaN(completionTime.getTime())) {
        console.warn('FocusTimer: Invalid completion time calculated');
        return null;
      }

      return completionTime;
    } catch (e) {
      console.error('FocusTimer: Error calculating estimated completion', e);
      return null;
    }
  }

  // ³² Enhanced session controls with better state management
  @action
  startSession() {
    try {
      this.sessionStartTime = new Date();
      this.currentPhase = 'focus';
      this.currentTime = (this.args?.model?.focusDuration || 25) * 60;
      this.currentCycleNumber = (this.args?.model?.sessionsCompleted || 0) + 1;
      this.isRunning = true;

      // Update model state
      if (this.args?.model) {
        this.args.model.isActive = true;
        this.args.model.currentPhase = 'focus';
        // ⁷⁵ FIXED: Don't modify DatetimeFields to prevent serialization errors
        this.args.model.timeRemaining = this.currentTime;
      }

      this.timerTask.perform();
    } catch (e) {
      console.error('FocusTimer: Error starting session', e);
    }
  }

  @action
  pauseSession() {
    try {
      this.isRunning = false;
      this.currentPhase = 'paused';
      this.timerTask.cancelAll();

      // Update model state
      if (this.args?.model) {
        this.args.model.currentPhase = 'paused';
        this.args.model.timeRemaining = this.currentTime;
      }
    } catch (e) {
      console.error('FocusTimer: Error pausing session', e);
    }
  }

  @action
  resumeSession() {
    try {
      this.isRunning = true;
      this.currentPhase =
        this.currentCycleNumber <= (this.args?.model?.sessionsCompleted || 0)
          ? 'break'
          : 'focus';

      // Update model state
      if (this.args?.model) {
        this.args.model.currentPhase = this.currentPhase;
      }

      this.timerTask.perform();
    } catch (e) {
      console.error('FocusTimer: Error resuming session', e);
    }
  }

  @action
  stopSession() {
    try {
      this.isRunning = false;
      this.currentPhase = 'ready';
      this.currentTime = 0;
      this.sessionStartTime = null;
      this.currentCycleNumber = 1;
      this.timerTask.cancelAll();

      // Update model state
      if (this.args?.model) {
        this.args.model.isActive = false;
        this.args.model.currentPhase = 'ready';
        this.args.model.timeRemaining = 0;
        // ⁷⁶ FIXED: Don't modify DatetimeFields to prevent serialization errors
        // this.args.model.startTime = null;
      }
    } catch (e) {
      console.error('FocusTimer: Error stopping session', e);
    }
  }

  @action
  skipPhase() {
    try {
      if (this.currentPhase === 'focus') {
        this.completeCurrentFocus();
      } else if (this.currentPhase === 'break') {
        this.startNextFocusSession();
      }
    } catch (e) {
      console.error('FocusTimer: Error skipping phase', e);
    }
  }

  @action
  resetTimer() {
    try {
      // Stop any running timer first
      this.isRunning = false;
      this.currentPhase = 'ready';
      this.currentTime = 0;
      this.sessionStartTime = null;
      this.currentCycleNumber = 1;
      this.timerTask.cancelAll();

      // Reset all session data - SAFE: Only set basic field values
      if (this.args?.model) {
        this.args.model.sessionsCompleted = 0;
        this.args.model.totalFocusTime = 0;
        this.args.model.isActive = false;
        this.args.model.currentPhase = 'ready';
        this.args.model.timeRemaining = 0;
        // ⁷⁹ CRITICAL: Don't modify DatetimeFields to prevent serialization errors
        // this.args.model.completedAt = null;
        // this.args.model.startTime = null;
      }
    } catch (e) {
      console.error('FocusTimer: Error resetting timer', e);
    }
  }

  // ³³ Enhanced phase transition logic
  completeCurrentFocus() {
    try {
      const focusDuration = this.args?.model?.focusDuration || 25;
      const completedSessions = (this.args?.model?.sessionsCompleted || 0) + 1;
      const totalFocus =
        (this.args?.model?.totalFocusTime || 0) + focusDuration;

      // Update completion tracking
      if (this.args?.model) {
        this.args.model.sessionsCompleted = completedSessions;
        this.args.model.totalFocusTime = totalFocus;
      }

      this.currentPhase = 'break';
      this.currentTime = (this.args?.model?.breakDuration || 5) * 60;

      // Check if all sessions are complete
      if (completedSessions >= (this.args?.model?.targetSessions || 4)) {
        this.completeAllSessions();
      }
    } catch (e) {
      console.error('FocusTimer: Error completing focus phase', e);
    }
  }

  startNextFocusSession() {
    try {
      this.currentCycleNumber++;
      this.currentPhase = 'focus';
      this.currentTime = (this.args?.model?.focusDuration || 25) * 60;

      if (this.args?.model) {
        this.args.model.currentPhase = 'focus';
        this.args.model.timeRemaining = this.currentTime;
      }
    } catch (e) {
      console.error('FocusTimer: Error starting next focus session', e);
    }
  }

  completeAllSessions() {
    try {
      this.currentPhase = 'completed';
      this.isRunning = false;
      this.timerTask.cancelAll();

      // Mark session as complete - don't modify DatetimeFields
      if (this.args?.model) {
        this.args.model.isActive = false;
        this.args.model.currentPhase = 'completed';
        this.args.model.timeRemaining = 0;
        // ⁷⁴ SAFE: Don't modify DatetimeFields to prevent serialization issues
      }
    } catch (e) {
      console.error('FocusTimer: Error completing all sessions', e);
    }
  }

  // ³⁴ Enhanced timer task with better error handling
  timerTask = restartableTask(async () => {
    try {
      while (this.isRunning && this.currentTime > 0) {
        await timeout(1000); // Use ember-concurrency timeout
        this.currentTime--;

        // Update model with current time
        if (this.args?.model) {
          this.args.model.timeRemaining = this.currentTime;
        }
      }

      // Handle phase completion
      if (this.currentTime === 0 && this.isRunning) {
        if (this.currentPhase === 'focus') {
          this.completeCurrentFocus();
        } else if (this.currentPhase === 'break') {
          this.startNextFocusSession();
        }
      }
    } catch (e) {
      console.error('FocusTimer: Timer task error', e);
      this.isRunning = false;
    }
  });

  <template>
    <div class='timer-view'>
      <div class='timer-container'>
        <header class='timer-header'>
          <div class='header-content'>
            <div class='title-section'>
              <h1 class='session-title'>{{if
                  @model.sessionName
                  @model.sessionName
                  'Focus Session'
                }}</h1>
              <p class='phase-description'>{{this.phaseDescription}}</p>
            </div>

            <div class='session-badges'>
              {{#if @model.subject}}
                <Pill class='subject-badge'>
                  <svg
                    class='badge-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                    <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
                  </svg>
                  {{@model.subject}}
                </Pill>
              {{/if}}
              <Pill class='phase-badge phase-{{this.currentPhase}}'>
                <svg
                  class='badge-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12,6 12,12 16,14' />
                </svg>
                {{this.currentPhase}}
              </Pill>
            </div>
          </div>
        </header>

        <div class='timer-display'>
          <div
            class='timer-circle'
            style={{htmlSafe (concat '--phase-color: ' this.phaseColor)}}
          >
            <svg class='progress-ring' viewBox='0 0 200 200'>
              <defs>
                <linearGradient
                  id='progress-gradient'
                  x1='0%'
                  y1='0%'
                  x2='100%'
                  y2='100%'
                >
                  <stop
                    offset='0%'
                    style={{htmlSafe
                      (concat 'stop-color:' this.phaseColor ';stop-opacity:1')
                    }}
                  />
                  <stop
                    offset='100%'
                    style={{htmlSafe
                      (concat 'stop-color:' this.phaseColor ';stop-opacity:0.6')
                    }}
                  />
                </linearGradient>
              </defs>
              <circle
                class='progress-background'
                cx='100'
                cy='100'
                r='90'
                fill='transparent'
                stroke='#f1f5f9'
                stroke-width='12'
              />
              <circle
                class='progress-glow'
                cx='100'
                cy='100'
                r='90'
                fill='transparent'
                stroke={{this.phaseColor}}
                stroke-width='16'
                stroke-dasharray='565.48'
                stroke-dashoffset={{subtract
                  565.48
                  (multiply this.progressPercentage 5.6548)
                }}
                stroke-linecap='round'
                transform='rotate(-90 100 100)'
                opacity='0.2'
              />
              <circle
                class='progress-foreground'
                cx='100'
                cy='100'
                r='90'
                fill='transparent'
                stroke='url(#progress-gradient)'
                stroke-width='12'
                stroke-dasharray='565.48'
                stroke-dashoffset={{subtract
                  565.48
                  (multiply this.progressPercentage 5.6548)
                }}
                stroke-linecap='round'
                transform='rotate(-90 100 100)'
              />
            </svg>

            <div class='timer-content'>
              <div class='time-display'>{{this.formattedTime}}</div>
              <div class='phase-label'>{{this.currentPhase}}</div>
              {{#if this.estimatedCompletion}}
                <div class='completion-time'>
                  Finish:
                  {{formatDateTime this.estimatedCompletion size='short'}}
                </div>
              {{/if}}
            </div>

            <div class='metric-float metric-sessions'>
              <span
                class='metric-number'
              >{{this.sessionProgress.completed}}</span>
              <span class='metric-label'>of
                {{this.sessionProgress.target}}</span>
            </div>

            <div class='metric-float metric-efficiency'>
              <span class='metric-number'>{{@model.sessionEfficiency}}%</span>
              <span class='metric-label'>efficiency</span>
            </div>
          </div>
        </div>

        <div class='timer-controls'>
          <div class='primary-controls'>
            {{#if this.canStart}}
              <Button
                class='control-btn primary start-btn'
                {{on 'click' this.startSession}}
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <polygon points='5,3 19,12 5,21' />
                </svg>
                {{#if (eq this.currentPhase 'ready')}}
                  Start Focus Session
                {{else}}
                  Start New Session
                {{/if}}
              </Button>
            {{/if}}

            {{#if this.canPause}}
              <Button
                class='control-btn secondary pause-btn'
                {{on 'click' this.pauseSession}}
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='6' y='4' width='4' height='16' />
                  <rect x='14' y='4' width='4' height='16' />
                </svg>
                Pause
              </Button>
            {{/if}}

            {{#if this.canResume}}
              <Button
                class='control-btn primary resume-btn'
                {{on 'click' this.resumeSession}}
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <polygon points='5,3 19,12 5,21' />
                </svg>
                Resume
              </Button>
            {{/if}}
          </div>

          <div class='secondary-controls'>
            {{#if
              (or (eq this.currentPhase 'focus') (eq this.currentPhase 'break'))
            }}
              <Button
                class='control-btn tertiary skip-btn'
                {{on 'click' this.skipPhase}}
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <polygon points='5,4 15,12 5,20' />
                  <line x1='19' y1='5' x2='19' y2='19' />
                </svg>
                Skip
                {{this.currentPhase}}
              </Button>
            {{/if}}

            {{#if (or this.isRunning (eq this.currentPhase 'paused'))}}
              <Button
                class='control-btn tertiary stop-btn'
                {{on 'click' this.stopSession}}
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                </svg>
                Stop
              </Button>
            {{/if}}

            {{#if
              (and (not this.isRunning) (gt this.sessionProgress.completed 0))
            }}
              <Button
                class='control-btn quaternary reset-btn'
                {{on 'click' this.resetTimer}}
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <polyline points='23,4 23,10 17,10' />
                  <path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10' />
                </svg>
                Reset
              </Button>
            {{/if}}
          </div>
        </div>

        <div class='session-progress'>
          <div class='progress-header'>
            <div class='header-left'>
              <h3 class='progress-title'>Session Progress</h3>
              <div class='completion-summary'>
                {{@model.sessionsCompleted}}
                of
                {{@model.targetSessions}}
                cycles completed
              </div>
            </div>
            <div class='header-right'>
              <div
                class='completion-badge'
              >{{@model.completionPercentage}}%</div>
            </div>
          </div>

          <div class='progress-bar'>
            <div
              class='progress-fill'
              style={{htmlSafe
                (concat 'width: ' @model.completionPercentage '%')
              }}
            ></div>
            <div
              class='progress-marker'
              style={{htmlSafe
                (concat 'left: calc(' @model.completionPercentage '% - 6px)')
              }}
            ></div>
          </div>

          <div class='session-stats'>
            <div class='stats-row'>
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
                  <span class='stat-value'>{{formatDuration
                      (multiply (Number @model.focusDuration) 60)
                      unit='seconds'
                      format='humanize'
                    }}</span>
                  <span class='stat-label'>Focus Duration</span>
                </div>
              </div>

              <div class='stat-card'>
                <div class='stat-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z'
                    />
                    <line x1='3' y1='6' x2='21' y2='6' />
                  </svg>
                </div>
                <div class='stat-content'>
                  <span class='stat-value'>{{formatDuration
                      (multiply (Number @model.breakDuration) 60)
                      unit='seconds'
                      format='humanize'
                    }}</span>
                  <span class='stat-label'>Break Duration</span>
                </div>
              </div>

              {{#if (gt @model.totalFocusTime 0)}}
                <div class='stat-card'>
                  <div class='stat-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M12 1v6l4-4' />
                      <path
                        d='M13 7h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h7'
                      />
                    </svg>
                  </div>
                  <div class='stat-content'>
                    <span class='stat-value'>{{formatDuration
                        (multiply (Number @model.totalFocusTime) 60)
                        unit='seconds'
                        format='humanize'
                      }}</span>
                    <span class='stat-label'>Total Focus Time</span>
                  </div>
                </div>
              {{/if}}

              <div class='stat-card'>
                <div class='stat-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M9 12l2 2 4-4' />
                    <path
                      d='M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c4.97 0 8.15 3.33 8.15 8.02'
                    />
                  </svg>
                </div>
                <div class='stat-content'>
                  <span class='stat-value'>{{@model.sessionEfficiency}}%</span>
                  <span class='stat-label'>Session Efficiency</span>
                </div>
              </div>
            </div>

            {{#if this.estimatedCompletion}}
              <div class='estimated-completion'>
                <svg
                  class='completion-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12,6 12,12 16,14' />
                </svg>
                <span>Estimated completion:
                  {{formatDateTime
                    this.estimatedCompletion
                    size='short'
                  }}</span>
              </div>
            {{/if}}
          </div>
        </div>

        {{#if (eq this.currentPhase 'completed')}}
          <div class='completion-celebration'>
            <div class='celebration-content'>
              <svg
                class='celebration-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M9 12l2 2 4-4' />
                <path
                  d='M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c4.97 0 8.15 3.33 8.15 8.02'
                />
              </svg>
              <h3>Session Complete!</h3>
              <p>Great work! You've completed all
                {{@model.targetSessions}}
                focus sessions.</p>

              <div class='celebration-actions'>
                <Button
                  class='action-btn primary'
                  {{on 'click' this.resetTimer}}
                >
                  Start New Session
                </Button>
              </div>
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* ³⁹ Enhanced Focus Timer styling with Study Hub theme */
      .timer-view {
        /* Core design system following Study Hub */
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
        width: 100%;
        height: 100vh; /* ⁸⁰ Full viewport height */
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 1rem;
        background: #f8fafc; /* Study Hub surface */
        overflow-y: auto; /* ⁸¹ CRITICAL: Enable scrolling */
        box-sizing: border-box;

        /* CSS Custom Properties - Study Hub Design Tokens */
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
          0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        --shadow-lg:
          0 10px 15px -3px rgba(0, 0, 0, 0.1),
          0 4px 6px -2px rgba(0, 0, 0, 0.05);
        --radius: 12px;
        --radius-sm: 8px;
        --radius-xs: 6px;
      }

      .timer-container {
        max-width: 36rem;
        width: 100%;
        background: var(--surface-elevated);
        border-radius: var(--radius);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-lg);
        padding: 2rem;
        position: relative;
        margin: 0 auto 2rem auto; /* ⁶³ Bottom margin for scroll space */
        flex-shrink: 0; /* ⁶⁴ Prevent container from shrinking */
        min-height: fit-content; /* ⁶⁵ Allow natural content height */
      }

      .timer-container::before {
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
        border-radius: var(--radius) var(--radius) 0 0;
      }

      /* ⁴⁰ Enhanced header with Study Hub styling */
      .timer-header {
        margin-bottom: 2.5rem;
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1.5rem;
      }

      .title-section {
        flex: 1;
      }

      .session-title {
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
        letter-spacing: -0.025em;
      }

      .phase-description {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.4;
        font-weight: 500;
      }

      .session-badges {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: flex-end;
      }

      .badge-icon {
        width: 0.875rem;
        height: 0.875rem;
        margin-right: 0.375rem;
      }

      .subject-badge {
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        border: 1px solid rgba(30, 58, 138, 0.2);
        font-weight: 600;
        display: flex;
        align-items: center;
      }

      .phase-badge {
        display: flex;
        align-items: center;
        font-weight: 600;
        text-transform: capitalize;
      }

      .phase-badge.phase-ready {
        background: rgba(107, 114, 128, 0.1);
        color: var(--text-tertiary);
        border: 1px solid rgba(107, 114, 128, 0.2);
      }
      .phase-badge.phase-focus {
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        border: 1px solid rgba(30, 58, 138, 0.2);
      }
      .phase-badge.phase-break {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
      }
      .phase-badge.phase-paused {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }
      .phase-badge.phase-completed {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
      }

      /* ⁴¹ Enhanced timer display with Study Hub design language */
      .timer-display {
        display: flex;
        justify-content: center;
        margin-bottom: 2.5rem;
        position: relative;
      }

      .timer-circle {
        position: relative;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--surface-elevated);
      }

      .progress-ring {
        position: absolute;
        top: -8px;
        left: -8px;
        width: 296px;
        height: 296px;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.1));
      }

      .progress-background {
        transition: all 0.3s ease;
      }

      .progress-glow {
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .progress-foreground {
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .timer-content {
        text-align: center;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .time-display {
        font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
        font-size: 3.5rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
        margin-bottom: 0.5rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .phase-label {
        font-size: 0.875rem;
        color: var(--text-secondary);
        font-weight: 600;
        text-transform: capitalize;
        letter-spacing: 0.05em;
        margin-bottom: 0.25rem;
      }

      .completion-time {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        font-weight: 500;
      }

      /* ⁴² Floating metrics around timer */
      .metric-float {
        position: absolute;
        background: var(--surface-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 0.75rem 1rem;
        box-shadow: var(--shadow);
        text-align: center;
        min-width: 4rem;
        transition: all 0.3s ease;
      }

      .metric-float:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .metric-sessions {
        top: 20%;
        left: -20%;
      }

      .metric-efficiency {
        bottom: 20%;
        right: -20%;
      }

      .metric-number {
        display: block;
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
      }

      .metric-label {
        display: block;
        font-size: 0.6875rem;
        color: var(--text-tertiary);
        margin-top: 0.25rem;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      /* ⁴³ Enhanced control system with Study Hub button design */
      .timer-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 2.5rem;
      }

      .primary-controls {
        display: flex;
        justify-content: center;
        gap: 1rem;
      }

      .secondary-controls {
        display: flex;
        justify-content: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .control-btn {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        font-family: inherit;
      }

      .control-btn::before {
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

      .control-btn:hover::before {
        left: 100%;
      }

      .control-btn.primary {
        padding: 1rem 2rem;
        background: linear-gradient(135deg, var(--primary), #2563eb);
        color: white;
        box-shadow: var(--shadow);
      }

      .control-btn.primary:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .control-btn.secondary {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(135deg, var(--accent), #d97706);
        color: white;
        box-shadow: var(--shadow);
      }

      .control-btn.secondary:hover {
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
      }

      .control-btn.tertiary {
        padding: 0.5rem 1rem;
        background: var(--surface);
        color: var(--text-secondary);
        border: 1px solid var(--border);
      }

      .control-btn.tertiary:hover {
        background: rgba(107, 114, 128, 0.05);
        border-color: var(--text-tertiary);
        transform: translateY(-1px);
      }

      .control-btn.quaternary {
        padding: 0.5rem 1rem;
        background: transparent;
        color: var(--text-tertiary);
        border: 1px dashed var(--border);
      }

      .control-btn.quaternary:hover {
        background: rgba(239, 68, 68, 0.05);
        color: #ef4444;
        border-color: #ef4444;
      }

      .btn-icon {
        width: 1.125rem;
        height: 1.125rem;
        transition: transform 0.3s ease;
      }

      .control-btn:hover .btn-icon {
        transform: scale(1.1);
      }

      .start-btn .btn-icon,
      .resume-btn .btn-icon {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.8;
        }
      }

      /* ⁴⁴ Enhanced progress section with Study Hub design system */
      .session-progress {
        background: rgba(248, 250, 252, 0.6);
        padding: 2rem;
        border-radius: var(--radius);
        border: 1px solid rgba(226, 232, 240, 0.6);
        backdrop-filter: blur(10px);
        position: relative;
      }

      .session-progress::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--primary), var(--secondary));
        border-radius: var(--radius) var(--radius) 0 0;
      }

      .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1.5rem;
      }

      .header-left {
        flex: 1;
      }

      .progress-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
        letter-spacing: -0.025em;
      }

      .completion-summary {
        font-size: 0.875rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .header-right {
        flex-shrink: 0;
      }

      .completion-badge {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--primary);
        background: rgba(30, 58, 138, 0.1);
        padding: 0.5rem 1rem;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(30, 58, 138, 0.2);
      }

      .progress-bar {
        width: 100%;
        height: 12px;
        background: rgba(226, 232, 240, 0.6);
        border-radius: 6px;
        overflow: hidden;
        margin-bottom: 1.5rem;
        position: relative;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 6px;
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .progress-fill::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.3),
          transparent
        );
        animation: shimmer 2s infinite;
      }

      @keyframes shimmer {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      .progress-marker {
        position: absolute;
        top: 50%;
        width: 12px;
        height: 12px;
        background: var(--surface-elevated);
        border: 3px solid var(--primary);
        border-radius: 50%;
        transform: translateY(-50%);
        box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.2);
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .session-stats {
        margin-bottom: 1rem;
      }

      .stats-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .stat-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        background: var(--surface-elevated);
        border: 1px solid rgba(226, 232, 240, 0.6);
        border-radius: var(--radius-sm);
        transition: all 0.3s ease;
      }

      .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow);
        border-color: rgba(30, 58, 138, 0.2);
      }

      .stat-icon {
        flex-shrink: 0;
        width: 2.5rem;
        height: 2.5rem;
        background: rgba(30, 58, 138, 0.1);
        border-radius: var(--radius-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .stat-icon svg {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--primary);
      }

      .stat-content {
        flex: 1;
        min-width: 0;
      }

      .stat-value {
        display: block;
        font-family: 'JetBrains Mono', monospace;
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.2;
        margin-bottom: 0.25rem;
      }

      .stat-label {
        display: block;
        font-size: 0.75rem;
        color: var(--text-tertiary);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .estimated-completion {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 1rem;
        background: rgba(5, 150, 105, 0.05);
        border: 1px solid rgba(5, 150, 105, 0.2);
        border-radius: var(--radius-sm);
        color: var(--secondary);
        font-size: 0.875rem;
        font-weight: 500;
        margin-top: 1rem;
      }

      .completion-icon {
        width: 1rem;
        height: 1rem;
      }

      .completion-celebration {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 50;
      }

      .celebration-content {
        background: white;
        padding: 2rem;
        border-radius: 16px;
        text-align: center;
        max-width: 24rem;
        margin: 1rem;
      }

      .celebration-icon {
        width: 4rem;
        height: 4rem;
        color: #059669;
        margin: 0 auto 1rem;
      }

      .celebration-content h3 {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
      }

      .celebration-content p {
        font-size: 1rem;
        color: #6b7280;
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
      }

      .celebration-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
      }

      .action-btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .action-btn.primary {
        background: #3b82f6;
        color: white;
      }

      .action-btn.secondary {
        background: #f3f4f6;
        color: #6b7280;
      }
    </style>
  </template>
}

export class FocusTimerCard extends CardDef {
  // ⁶ Enhanced focus timer card definition following Study Hub theme
  static displayName = 'Focus Timer';
  static icon = ClockIcon;
  static prefersWideFormat = false; // ⁷ Optimized for vertical layouts

  // ⁸ Core session configuration
  @field sessionName = contains(StringField);
  @field subject = contains(StringField); // ⁹ Study subject for categorization
  @field focusDuration = contains(NumberField); // ¹⁰ Focus period in minutes (default: 25)
  @field breakDuration = contains(NumberField); // ¹¹ Break period in minutes (default: 5)
  @field targetSessions = contains(NumberField); // ¹² Sessions to complete (default: 4)

  // ¹³ Session progress tracking
  @field sessionsCompleted = contains(NumberField);
  @field totalFocusTime = contains(NumberField); // ¹⁴ Accumulated focus minutes
  @field currentPhase = contains(StringField); // ¹⁵ ready, focus, break, paused, completed
  @field timeRemaining = contains(NumberField); // ¹⁶ Seconds left in current phase

  // ¹⁷ Session state management
  @field isActive = contains(BooleanField);
  @field startTime = contains(DatetimeField); // ¹⁸ When the session began
  @field completedAt = contains(DatetimeField); // ¹⁹ When all sessions finished

  // ²⁰ Computed completion percentage with enhanced error handling
  @field completionPercentage = contains(NumberField, {
    computeVia: function (this: FocusTimerCard) {
      try {
        const target = this.targetSessions || 4; // Default Pomodoro cycle
        const completed = this.sessionsCompleted || 0;
        // ⁵⁴ FIXED: Prevent impossible scenarios (completed > target)
        const safeCompleted = Math.min(completed, target);
        return Math.min(Math.round((safeCompleted / target) * 100), 100);
      } catch (e) {
        console.error('FocusTimer: Error computing completion percentage', e);
        return 0;
      }
    },
  });

  // ²¹ Enhanced computed title with subject context
  @field title = contains(StringField, {
    computeVia: function (this: FocusTimerCard) {
      try {
        const session = this.sessionName || 'Focus Session';
        const subject = this.subject ? ` - ${this.subject}` : '';
        return `${session}${subject}`;
      } catch (e) {
        console.error('FocusTimer: Error computing title', e);
        return 'Focus Session';
      }
    },
  });

  // ²² Session efficiency computed field
  @field sessionEfficiency = contains(NumberField, {
    computeVia: function (this: FocusTimerCard) {
      try {
        const completed = this.sessionsCompleted || 0;
        const focusTime = this.totalFocusTime || 0;
        const expectedTime = completed * (this.focusDuration || 25);

        if (expectedTime === 0) return 100;
        return Math.min(Math.round((focusTime / expectedTime) * 100), 100);
      } catch (e) {
        console.error('FocusTimer: Error computing session efficiency', e);
        return 100;
      }
    },
  });

  static isolated = FocusTimerIsolated;

  static embedded = class Embedded extends Component<typeof FocusTimerCard> {
    // ⁴⁵ Enhanced embedded format with Study Hub design
    <template>
      <div class='timer-embedded'>
        <div class='timer-header'>
          <div class='header-content'>
            <h4 class='session-title'>{{if
                @model.sessionName
                @model.sessionName
                'Focus Session'
              }}</h4>
            {{#if @model.subject}}
              <p class='session-subject'>{{@model.subject}}</p>
            {{/if}}
          </div>
          <div class='timer-meta'>
            <Pill
              class='phase-pill phase-{{if
                  @model.currentPhase
                  @model.currentPhase
                  "ready"
                }}'
            >
              <svg
                class='phase-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <polyline points='12,6 12,12 16,14' />
              </svg>
              {{if @model.currentPhase @model.currentPhase 'ready'}}
            </Pill>
          </div>
        </div>

        <div class='timer-display'>
          <div class='timer-stats'>
            <div class='progress-circle'>
              <svg class='circle-progress' viewBox='0 0 100 100'>
                <circle
                  cx='50'
                  cy='50'
                  r='45'
                  fill='none'
                  stroke='#e5e7eb'
                  stroke-width='8'
                />
                <circle
                  cx='50'
                  cy='50'
                  r='45'
                  fill='none'
                  stroke='#1e3a8a'
                  stroke-width='8'
                  stroke-dasharray='283'
                  stroke-dashoffset={{subtract
                    283
                    (multiply (Number @model.completionPercentage) 2.83)
                  }}
                  stroke-linecap='round'
                  transform='rotate(-90 50 50)'
                />
              </svg>
              <div class='circle-content'>
                <span
                  class='completion-percent'
                >{{@model.completionPercentage}}%</span>
              </div>
            </div>

            <div class='session-metrics'>
              <div class='metric-row'>
                <div class='metric'>
                  <span class='metric-label'>Sessions</span>
                  <span
                    class='metric-value'
                  >{{@model.sessionsCompleted}}/{{@model.targetSessions}}</span>
                </div>
                <div class='metric'>
                  <span class='metric-label'>Focus</span>
                  <span class='metric-value'>{{@model.focusDuration}}m</span>
                </div>
              </div>
              <div class='metric-row'>
                <div class='metric'>
                  <span class='metric-label'>Break</span>
                  <span class='metric-value'>{{@model.breakDuration}}m</span>
                </div>
                {{#if @model.totalFocusTime}}
                  <div class='metric'>
                    <span class='metric-label'>Total</span>
                    <span class='metric-value'>{{formatDuration
                        (multiply @model.totalFocusTime 60)
                        unit='seconds'
                        format='short'
                      }}</span>
                  </div>
                {{/if}}
              </div>
            </div>
          </div>

          {{#if @model.isActive}}
            <div class='active-indicator'>
              <div class='pulse-animation'>
                <div class='pulse-dot'></div>
                <div class='pulse-ring'></div>
              </div>
              <span class='active-text'>Session in progress</span>
            </div>
          {{else}}
            <div class='timer-actions'>
              <Button class='start-btn'>
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <polygon points='5,3 19,12 5,21' />
                </svg>
                {{#if (eq @model.currentPhase 'completed')}}
                  Start New Session
                {{else}}
                  Start Focus Timer
                {{/if}}
              </Button>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        /* ⁴⁶ Enhanced embedded styling with Study Hub theme */
        .timer-embedded {
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          padding: 1.25rem;
          background: white;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          font-size: 0.8125rem;
          position: relative;

          /* Study Hub color variables */
          --primary: #1e3a8a;
          --secondary: #059669;
          --accent: #f59e0b;
          --surface: #f8fafc;
          --text-primary: #1f2937;
          --text-secondary: #4b5563;
          --text-tertiary: #6b7280;
        }

        .timer-embedded::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary), var(--secondary));
          border-radius: 8px 8px 0 0;
        }

        .timer-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.25rem;
          gap: 1rem;
        }

        .header-content {
          flex: 1;
          min-width: 0;
        }

        .session-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 0.25rem 0;
          line-height: 1.2;
        }

        .session-subject {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin: 0;
          font-weight: 500;
        }

        .timer-meta {
          flex-shrink: 0;
        }

        .phase-icon {
          width: 0.75rem;
          height: 0.75rem;
          margin-right: 0.25rem;
        }

        .phase-pill {
          display: flex;
          align-items: center;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: capitalize;
          padding: 0.25rem 0.5rem;
        }

        .phase-pill.phase-ready {
          background: rgba(107, 114, 128, 0.1);
          color: var(--text-tertiary);
          border: 1px solid rgba(107, 114, 128, 0.2);
        }
        .phase-pill.phase-focus {
          background: rgba(30, 58, 138, 0.1);
          color: var(--primary);
          border: 1px solid rgba(30, 58, 138, 0.2);
        }
        .phase-pill.phase-break {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
          border: 1px solid rgba(5, 150, 105, 0.2);
        }
        .phase-pill.phase-paused {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent);
          border: 1px solid rgba(245, 158, 11, 0.2);
        }
        .phase-pill.phase-completed {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
          border: 1px solid rgba(5, 150, 105, 0.2);
        }

        .timer-display {
          margin-bottom: 1rem;
        }

        .timer-stats {
          display: flex;
          gap: 1.25rem;
          align-items: center;
          margin-bottom: 1rem;
        }

        .progress-circle {
          position: relative;
          width: 4rem;
          height: 4rem;
          flex-shrink: 0;
        }

        .circle-progress {
          width: 100%;
          height: 100%;
          transition: stroke-dashoffset 0.5s ease;
        }

        .circle-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
        }

        .completion-percent {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.8125rem;
          font-weight: 700;
          color: var(--primary);
          line-height: 1;
        }

        .session-metrics {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .metric-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
        }

        .metric {
          flex: 1;
          text-align: center;
        }

        .metric-label {
          display: block;
          font-size: 0.6875rem;
          color: var(--text-tertiary);
          font-weight: 500;
          margin-bottom: 0.125rem;
        }

        .metric-value {
          display: block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1;
        }

        .active-indicator {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          justify-content: center;
          padding: 0.875rem;
          background: rgba(5, 150, 105, 0.05);
          border-radius: 6px;
          border: 1px solid rgba(5, 150, 105, 0.15);
        }

        .pulse-animation {
          position: relative;
          width: 1rem;
          height: 1rem;
        }

        .pulse-dot {
          width: 0.5rem;
          height: 0.5rem;
          background: var(--secondary);
          border-radius: 50%;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }

        .pulse-ring {
          width: 1rem;
          height: 1rem;
          border: 2px solid var(--secondary);
          border-radius: 50%;
          position: absolute;
          top: 0;
          left: 0;
          animation: pulse-ring 2s infinite;
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          100% {
            transform: scale(1.4);
            opacity: 0;
          }
        }

        .active-text {
          font-size: 0.75rem;
          color: var(--secondary);
          font-weight: 600;
        }

        .timer-actions {
          display: flex;
          justify-content: center;
        }

        .start-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 1.25rem;
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
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
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(30, 58, 138, 0.3);
        }

        .start-btn:hover::before {
          left: 100%;
        }

        .btn-icon {
          width: 0.875rem;
          height: 0.875rem;
        }
      </style>
    </template>
  };

  // ⁴⁷ Enhanced fitted format for gallery and grid views
  static fitted = class Fitted extends Component<typeof FocusTimerCard> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='timer-badge'>
            <svg
              class='timer-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polyline points='12,6 12,12 16,14' />
            </svg>
            <div class='badge-content'>
              <div class='session-name'>{{if
                  @model.sessionName
                  @model.sessionName
                  'Focus'
                }}</div>
              <div
                class='session-progress'
              >{{@model.sessionsCompleted}}/{{@model.targetSessions}}</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='timer-strip'>
            <div class='strip-left'>
              <svg
                class='timer-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <polyline points='12,6 12,12 16,14' />
              </svg>
              <div class='strip-content'>
                <div class='strip-title'>{{if
                    @model.sessionName
                    @model.sessionName
                    'Focus Session'
                  }}</div>
                {{#if @model.subject}}
                  <div class='strip-subject'>{{@model.subject}}</div>
                {{/if}}
              </div>
            </div>
            <div class='strip-right'>
              <div class='strip-stats'>
                <span class='stat-badge'>{{@model.completionPercentage}}%</span>
                <span
                  class='phase-indicator phase-{{if
                      @model.currentPhase
                      @model.currentPhase
                      "ready"
                    }}'
                >{{if @model.currentPhase @model.currentPhase 'Ready'}}</span>
              </div>
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='timer-tile'>
            <div class='tile-header'>
              <h3 class='tile-title'>{{if
                  @model.sessionName
                  @model.sessionName
                  'Focus Session'
                }}</h3>
              <svg
                class='timer-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <polyline points='12,6 12,12 16,14' />
              </svg>
            </div>

            {{#if @model.subject}}
              <div class='tile-subject'>{{@model.subject}}</div>
            {{/if}}

            <div class='tile-progress'>
              <div class='progress-ring'>
                <svg viewBox='0 0 60 60'>
                  <circle
                    cx='30'
                    cy='30'
                    r='25'
                    fill='none'
                    stroke='#e5e7eb'
                    stroke-width='4'
                  />
                  <circle
                    cx='30'
                    cy='30'
                    r='25'
                    fill='none'
                    stroke='#1e3a8a'
                    stroke-width='4'
                    stroke-dasharray='157'
                    stroke-dashoffset={{subtract
                      157
                      (multiply (Number @model.completionPercentage) 1.57)
                    }}
                    stroke-linecap='round'
                    transform='rotate(-90 30 30)'
                  />
                </svg>
                <div class='ring-content'>
                  <span
                    class='completion-text'
                  >{{@model.completionPercentage}}%</span>
                </div>
              </div>
            </div>

            <div class='tile-metrics'>
              <div class='metric-item'>
                <span class='metric-label'>Sessions</span>
                <span
                  class='metric-value'
                >{{@model.sessionsCompleted}}/{{@model.targetSessions}}</span>
              </div>
              <div class='metric-item'>
                <span class='metric-label'>Focus</span>
                <span class='metric-value'>{{@model.focusDuration}}m</span>
              </div>
            </div>

            <div class='tile-footer'>
              <span
                class='phase-badge phase-{{if
                    @model.currentPhase
                    @model.currentPhase
                    "ready"
                  }}'
              >
                {{if @model.currentPhase @model.currentPhase 'Ready'}}
              </span>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='timer-card'>
            <div class='card-header'>
              <div class='header-content'>
                <h3 class='card-title'>{{if
                    @model.sessionName
                    @model.sessionName
                    'Focus Session'
                  }}</h3>
                {{#if @model.subject}}
                  <p class='card-subject'>{{@model.subject}}</p>
                {{/if}}
              </div>
              <div class='header-icon'>
                <svg
                  class='timer-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12,6 12,12 16,14' />
                </svg>
              </div>
            </div>

            <div class='card-body'>
              <div class='main-metrics'>
                <div class='progress-section'>
                  <div class='large-progress-ring'>
                    <svg viewBox='0 0 80 80'>
                      <circle
                        cx='40'
                        cy='40'
                        r='35'
                        fill='none'
                        stroke='#e5e7eb'
                        stroke-width='6'
                      />
                      <circle
                        cx='40'
                        cy='40'
                        r='35'
                        fill='none'
                        stroke='#1e3a8a'
                        stroke-width='6'
                        stroke-dasharray='220'
                        stroke-dashoffset={{subtract
                          220
                          (multiply (Number @model.completionPercentage) 2.2)
                        }}
                        stroke-linecap='round'
                        transform='rotate(-90 40 40)'
                      />
                    </svg>
                    <div class='ring-content'>
                      <span
                        class='completion-percent'
                      >{{@model.completionPercentage}}%</span>
                      <span class='completion-label'>Complete</span>
                    </div>
                  </div>
                </div>

                <div class='stats-section'>
                  <div class='stat-row'>
                    <div class='stat'>
                      <span
                        class='stat-value'
                      >{{@model.sessionsCompleted}}</span>
                      <span class='stat-label'>of
                        {{@model.targetSessions}}
                        sessions</span>
                    </div>
                    <div class='stat'>
                      <span class='stat-value'>{{@model.focusDuration}}m</span>
                      <span class='stat-label'>focus time</span>
                    </div>
                  </div>
                  <div class='stat-row'>
                    <div class='stat'>
                      <span class='stat-value'>{{@model.breakDuration}}m</span>
                      <span class='stat-label'>break time</span>
                    </div>
                    {{#if @model.totalFocusTime}}
                      <div class='stat'>
                        <span class='stat-value'>{{formatDuration
                            (multiply @model.totalFocusTime 60)
                            unit='seconds'
                            format='short'
                          }}</span>
                        <span class='stat-label'>total focus</span>
                      </div>
                    {{/if}}
                  </div>
                </div>
              </div>

              <div class='card-footer'>
                <span
                  class='status-badge status-{{if
                      @model.currentPhase
                      @model.currentPhase
                      "ready"
                    }}'
                >
                  {{if
                    @model.currentPhase
                    @model.currentPhase
                    'Ready to start'
                  }}
                </span>
                {{#if @model.isActive}}
                  <div class='active-pulse'></div>
                {{/if}}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        /* ⁴⁸ Fitted format styling with Study Hub theme */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;

          /* Study Hub design tokens */
          --primary: #1e3a8a;
          --secondary: #059669;
          --accent: #f59e0b;
          --surface: #f8fafc;
          --text-primary: #1f2937;
          --text-secondary: #4b5563;
          --text-tertiary: #6b7280;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        /* Badge Format (≤150px width, ≤169px height) */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
          }
        }

        .timer-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, var(--primary), #2563eb);
          color: white;
          border-radius: 6px;
          padding: 0.5rem;
          box-sizing: border-box;
        }

        .timer-badge .timer-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }

        .badge-content {
          flex: 1;
          min-width: 0;
        }

        .session-name {
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
          margin-bottom: 0.125rem;
        }

        .session-progress {
          font-size: 0.625rem;
          opacity: 0.9;
          line-height: 1;
        }

        /* Strip Format (>150px width, ≤169px height) */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
          }
        }

        .timer-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          box-sizing: border-box;
        }

        .strip-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
          min-width: 0;
        }

        .strip-left .timer-icon {
          width: 1rem;
          height: 1rem;
          color: var(--primary);
          flex-shrink: 0;
        }

        .strip-content {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1;
        }

        .strip-subject {
          font-size: 0.6875rem;
          color: var(--text-secondary);
          margin-top: 0.125rem;
          line-height: 1;
        }

        .strip-right {
          flex-shrink: 0;
        }

        .strip-stats {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .stat-badge {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--primary);
          background: rgba(30, 58, 138, 0.1);
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
        }

        .phase-indicator {
          font-size: 0.6875rem;
          font-weight: 500;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          text-transform: capitalize;
        }

        .phase-indicator.phase-ready {
          background: rgba(107, 114, 128, 0.1);
          color: var(--text-tertiary);
        }
        .phase-indicator.phase-focus {
          background: rgba(30, 58, 138, 0.1);
          color: var(--primary);
        }
        .phase-indicator.phase-break {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
        }
        .phase-indicator.phase-paused {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent);
        }
        .phase-indicator.phase-completed {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
        }

        /* Tile Format (≤399px width, ≥170px height) */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        .timer-tile {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
          box-sizing: border-box;
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .tile-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.2;
          flex: 1;
        }

        .tile-header .timer-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: var(--primary);
          flex-shrink: 0;
        }

        .tile-subject {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin-bottom: 0.75rem;
          font-weight: 500;
        }

        .tile-progress {
          display: flex;
          justify-content: center;
          margin-bottom: 0.75rem;
        }

        .progress-ring {
          position: relative;
          width: 3.75rem;
          height: 3.75rem;
        }

        .progress-ring svg {
          width: 100%;
          height: 100%;
          transition: stroke-dashoffset 0.5s ease;
        }

        .ring-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
        }

        .completion-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--primary);
          line-height: 1;
        }

        .tile-metrics {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }

        .metric-item {
          text-align: center;
          flex: 1;
        }

        .metric-label {
          display: block;
          font-size: 0.625rem;
          color: var(--text-tertiary);
          margin-bottom: 0.125rem;
        }

        .metric-value {
          display: block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .tile-footer {
          margin-top: auto;
          display: flex;
          justify-content: center;
        }

        .phase-badge {
          font-size: 0.6875rem;
          font-weight: 500;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          text-transform: capitalize;
        }

        .phase-badge.phase-ready {
          background: rgba(107, 114, 128, 0.1);
          color: var(--text-tertiary);
        }
        .phase-badge.phase-focus {
          background: rgba(30, 58, 138, 0.1);
          color: var(--primary);
        }
        .phase-badge.phase-break {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
        }
        .phase-badge.phase-paused {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent);
        }
        .phase-badge.phase-completed {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
        }

        /* Card Format (≥400px width, ≥170px height) */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .timer-card {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1.25rem;
          box-sizing: border-box;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .header-content {
          flex: 1;
        }

        .card-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 0.25rem 0;
          line-height: 1.2;
        }

        .card-subject {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin: 0;
          font-weight: 500;
        }

        .header-icon {
          flex-shrink: 0;
        }

        .header-icon .timer-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: var(--primary);
        }

        .card-body {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .main-metrics {
          display: flex;
          gap: 1.25rem;
          margin-bottom: 1rem;
          flex: 1;
        }

        .progress-section {
          flex-shrink: 0;
        }

        .large-progress-ring {
          position: relative;
          width: 5rem;
          height: 5rem;
        }

        .large-progress-ring svg {
          width: 100%;
          height: 100%;
          transition: stroke-dashoffset 0.5s ease;
        }

        .large-progress-ring .ring-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
        }

        .completion-percent {
          display: block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 1rem;
          font-weight: 700;
          color: var(--primary);
          line-height: 1;
        }

        .completion-label {
          display: block;
          font-size: 0.6875rem;
          color: var(--text-tertiary);
          margin-top: 0.125rem;
        }

        .stats-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.75rem;
        }

        .stat-row {
          display: flex;
          gap: 1rem;
        }

        .stat {
          flex: 1;
          text-align: center;
        }

        .stat-value {
          display: block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.875rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
        }

        .stat-label {
          display: block;
          font-size: 0.6875rem;
          color: var(--text-tertiary);
          margin-top: 0.25rem;
        }

        .card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: auto;
        }

        .status-badge {
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.375rem 0.75rem;
          border-radius: 6px;
          text-transform: capitalize;
        }

        .status-badge.status-ready {
          background: rgba(107, 114, 128, 0.1);
          color: var(--text-tertiary);
        }
        .status-badge.status-focus {
          background: rgba(30, 58, 138, 0.1);
          color: var(--primary);
        }
        .status-badge.status-break {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
        }
        .status-badge.status-paused {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent);
        }
        .status-badge.status-completed {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
        }

        .active-pulse {
          width: 0.75rem;
          height: 0.75rem;
          background: var(--secondary);
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }
      </style>
    </template>
  };
}
