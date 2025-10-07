// ═══ [EDIT TRACKING: ON] Mark all changes with ⁽ⁿ⁾ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number'; // ⁽¹⁾ Added for progress tracking
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Button, Pill } from '@cardstack/boxel-ui/components'; // ² UI components
import {
  formatDateTime,
  eq,
  lt,
  and,
  multiply,
  divide,
  subtract,
} from '@cardstack/boxel-ui/helpers'; // ⁽³⁾ Enhanced helpers
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import TargetIcon from '@cardstack/boxel-icons/target'; // ⁴ Icon import

class StudyGoalIsolated extends Component<typeof StudyGoal> {
  // ⁽⁹⁾ Enhanced isolated template with study hub theme
  @tracked showProgressEdit = false;

  get statusColor() {
    const status = this.args?.model?.status || 'not-started';
    switch (status) {
      case 'completed':
        return 'completed';
      case 'overdue':
        return 'overdue';
      case 'urgent':
        return 'urgent';
      case 'on-track':
        return 'on-track';
      case 'in-progress':
        return 'in-progress';
      default:
        return 'not-started';
    }
  }

  get priorityColor() {
    const priority = this.args?.model?.priority || '';
    switch (priority.toLowerCase()) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  get daysUntilText() {
    const days = this.args?.model?.daysUntilDue;
    if (days === null || days === undefined) return null;

    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `${days} days remaining`;
  }

  get progressPercentage() {
    return this.args?.model?.progress || 0;
  }

  @action
  toggleProgressEdit() {
    this.showProgressEdit = !this.showProgressEdit;
  }

  @action
  updateProgress(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    if (this.args?.model && !isNaN(value)) {
      this.args.model.progress = Math.max(0, Math.min(100, value));

      // Auto-complete if progress reaches 100%
      if (value >= 100 && !this.args.model.isCompleted) {
        this.args.model.isCompleted = true;
        this.args.model.completedAt = new Date();
        this.args.model.progress = 100;
      }
    }
  }

  @action
  setProgress(value: number) {
    if (this.args?.model) {
      this.args.model.progress = value;

      // Auto-complete if progress reaches 100%
      if (value >= 100 && !this.args.model.isCompleted) {
        this.args.model.isCompleted = true;
        this.args.model.completedAt = new Date();
        this.args.model.progress = 100;
      } else if (value < 100 && this.args.model.isCompleted) {
        // Un-complete if progress drops below 100%
        this.args.model.isCompleted = false;
        this.args.model.completedAt = undefined;
      }
    }
  }

  @action
  toggleCompletion() {
    if (this.args?.model) {
      const wasCompleted = this.args.model.isCompleted;
      this.args.model.isCompleted = !wasCompleted;

      if (this.args.model.isCompleted) {
        this.args.model.completedAt = new Date();
        this.args.model.progress = 100;
      } else {
        this.args.model.completedAt = undefined;
      }
    }
  }

  @action
  editGoal() {
    // ⁽⁶⁰⁾ Switch to edit mode using viewCard API
    if (this.args?.viewCard) {
      this.args.viewCard(this.args.model as CardDef, 'edit');
    }
  }

  <template>
    <div class='study-goal-view'>
      <div class='goal-container'>
        <header class='goal-header'>
          <div class='header-content'>
            <div class='goal-info'>
              <h1 class='goal-title'>{{if
                  @model.goalTitle
                  @model.goalTitle
                  'Untitled Goal'
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
                    <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
                  </svg>
                  {{@model.subject}}
                </div>
              {{/if}}

              {{#if @model.description}}
                <div class='goal-description'>{{@model.description}}</div>
              {{/if}}
            </div>

            <div class='goal-status'>
              <div class='status-badges'>
                {{#if @model.priority}}
                  <Pill
                    class='priority-{{this.priorityColor}}'
                  >{{@model.priority}} Priority</Pill>
                {{/if}}

                <Pill class='status-{{this.statusColor}}'>
                  {{#if (eq @model.status 'completed')}}
                    <svg
                      class='status-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polyline points='20,6 9,17 4,12' />
                    </svg>
                    Completed
                  {{else if (eq @model.status 'overdue')}}
                    <svg
                      class='status-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <line x1='12' y1='8' x2='12' y2='12' />
                      <line x1='12' y1='16' x2='12.01' y2='16' />
                    </svg>
                    Overdue
                  {{else if (eq @model.status 'urgent')}}
                    <svg
                      class='status-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <polyline points='12,6 12,12 16,14' />
                    </svg>
                    Urgent
                  {{else if (eq @model.status 'on-track')}}
                    <svg
                      class='status-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M22 11.08V12a10 10 0 11-5.93-9.14' />
                      <polyline points='22,4 12,14.01 9,11.01' />
                    </svg>
                    On Track
                  {{else if (eq @model.status 'in-progress')}}
                    <svg
                      class='status-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <polyline points='12,6 12,12 16,14' />
                    </svg>
                    In Progress
                  {{else}}
                    <svg
                      class='status-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <line x1='12' y1='6' x2='12' y2='12' />
                      <line x1='12' y1='16' x2='12.01' y2='16' />
                    </svg>
                    Not Started
                  {{/if}}
                </Pill>
              </div>
            </div>
          </div>
        </header>

        <section class='progress-section'>
          <div class='section-header'>
            <h2 class='section-title'>Progress Tracking</h2>
            <Button class='edit-btn' {{on 'click' this.toggleProgressEdit}}>
              <svg
                class='btn-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                />
              </svg>
              Edit
            </Button>
          </div>

          <div class='progress-content'>
            <div class='progress-display'>
              <div class='progress-circle'>
                <svg
                  class='progress-ring'
                  width='120'
                  height='120'
                  viewBox='0 0 120 120'
                >
                  <circle
                    class='progress-ring-bg'
                    cx='60'
                    cy='60'
                    r='52'
                    fill='none'
                    stroke='#e5e7eb'
                    stroke-width='8'
                  />
                  <circle
                    class='progress-ring-fill'
                    cx='60'
                    cy='60'
                    r='52'
                    fill='none'
                    stroke='url(#progressGradient)'
                    stroke-width='8'
                    stroke-linecap='round'
                    style={{htmlSafe
                      (concat
                        'stroke-dasharray: '
                        (multiply (multiply 2 3.14159) 52)
                        '; stroke-dashoffset: '
                        (multiply
                          (multiply (multiply 2 3.14159) 52)
                          (divide (subtract 100 this.progressPercentage) 100)
                        )
                        ';'
                      )
                    }}
                  />
                  <defs>
                    <linearGradient
                      id='progressGradient'
                      x1='0%'
                      y1='0%'
                      x2='100%'
                      y2='100%'
                    >
                      <stop
                        offset='0%'
                        style={{htmlSafe 'stop-color:#1e3a8a'}}
                      />
                      <stop
                        offset='100%'
                        style={{htmlSafe 'stop-color:#059669'}}
                      />
                    </linearGradient>
                  </defs>
                </svg>
                <div class='progress-text'>
                  <div
                    class='progress-percentage'
                  >{{this.progressPercentage}}%</div>
                  <div class='progress-label'>Complete</div>
                </div>
              </div>

              <div class='progress-details'>
                {{#if this.showProgressEdit}}
                  <div class='progress-editor-inline'>
                    <div class='editor-header'>
                      <h3 class='editor-title'>Update Progress</h3>
                      <Button
                        class='done-btn'
                        {{on 'click' this.toggleProgressEdit}}
                      >
                        <svg
                          class='btn-icon'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <polyline points='20,6 9,17 4,12' />
                        </svg>
                        Done
                      </Button>
                    </div>

                    <div class='milestone-section'>
                      <label class='milestone-label'>Quick Updates</label>
                      <div class='milestone-buttons'>
                        <button
                          class='milestone-btn
                            {{if (eq this.progressPercentage 0) "active" ""}}'
                          {{on 'click' (fn this.setProgress 0)}}
                        >
                          <span class='milestone-value'>0%</span>
                          <span class='milestone-text'>Start</span>
                        </button>
                        <button
                          class='milestone-btn
                            {{if (eq this.progressPercentage 25) "active" ""}}'
                          {{on 'click' (fn this.setProgress 25)}}
                        >
                          <span class='milestone-value'>25%</span>
                          <span class='milestone-text'>Planning</span>
                        </button>
                        <button
                          class='milestone-btn
                            {{if (eq this.progressPercentage 50) "active" ""}}'
                          {{on 'click' (fn this.setProgress 50)}}
                        >
                          <span class='milestone-value'>50%</span>
                          <span class='milestone-text'>Halfway</span>
                        </button>
                        <button
                          class='milestone-btn
                            {{if (eq this.progressPercentage 75) "active" ""}}'
                          {{on 'click' (fn this.setProgress 75)}}
                        >
                          <span class='milestone-value'>75%</span>
                          <span class='milestone-text'>Almost</span>
                        </button>
                        <button
                          class='milestone-btn
                            {{if (eq this.progressPercentage 100) "active" ""}}'
                          {{on 'click' (fn this.setProgress 100)}}
                        >
                          <span class='milestone-value'>100%</span>
                          <span class='milestone-text'>Complete</span>
                        </button>
                      </div>
                    </div>

                    <div class='slider-section'>
                      <label
                        class='slider-label'
                        for='progress-slider'
                      >Fine-tune Progress</label>
                      <div class='custom-slider'>
                        <input
                          id='progress-slider'
                          type='range'
                          min='0'
                          max='100'
                          step='5'
                          value={{this.progressPercentage}}
                          class='progress-slider'
                          {{on 'input' this.updateProgress}}
                        />
                        <div class='slider-track'>
                          <div
                            class='slider-fill'
                            style={{htmlSafe
                              (concat 'width: ' this.progressPercentage '%')
                            }}
                          ></div>
                        </div>
                        <div class='slider-labels'>
                          <span>0%</span>
                          <span>25%</span>
                          <span>50%</span>
                          <span>75%</span>
                          <span>100%</span>
                        </div>
                      </div>
                    </div>

                    <div class='current-progress'>
                      <div class='progress-display-large'>
                        <span
                          class='progress-number'
                        >{{this.progressPercentage}}</span>
                        <span class='progress-unit'>%</span>
                      </div>
                      <div class='progress-feedback {{@model.status}}'>
                        {{#if (eq this.progressPercentage 0)}}
                          Ready to begin! Set your study plan.
                        {{else if (lt this.progressPercentage 25)}}
                          Getting started - keep building momentum!
                        {{else if (lt this.progressPercentage 50)}}
                          Great progress - you're in the flow!
                        {{else if (lt this.progressPercentage 75)}}
                          Excellent work - more than halfway there!
                        {{else if (lt this.progressPercentage 100)}}
                          Almost finished - push through to the end!
                        {{else}}
                          🎉 Congratulations! Goal achieved!
                        {{/if}}
                      </div>
                    </div>
                  </div>
                {{else}}
                  <div class='progress-overview'>
                    <div class='overview-stats'>
                      {{#if @model.studyTimeEstimate}}
                        <div class='overview-stat'>
                          <svg
                            class='stat-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <circle cx='12' cy='12' r='10' />
                            <polyline points='12,6 12,12 16,14' />
                          </svg>
                          <div class='stat-content'>
                            <div
                              class='stat-value'
                            >{{@model.studyTimeEstimate}}h</div>
                            <div class='stat-label'>Time Estimate</div>
                          </div>
                        </div>
                      {{/if}}

                      {{#if @model.actualTimeSpent}}
                        <div class='overview-stat'>
                          <svg
                            class='stat-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <circle cx='12' cy='12' r='10' />
                            <polyline points='12,6 12,12 16,14' />
                          </svg>
                          <div class='stat-content'>
                            <div
                              class='stat-value'
                            >{{@model.actualTimeSpent}}h</div>
                            <div class='stat-label'>Time Spent</div>
                          </div>
                        </div>
                      {{/if}}

                      {{#if this.daysUntilText}}
                        <div class='overview-stat timeline {{@model.status}}'>
                          <svg
                            class='stat-icon'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            stroke-width='2'
                          >
                            <rect
                              x='3'
                              y='4'
                              width='18'
                              height='18'
                              rx='2'
                              ry='2'
                            />
                            <line x1='16' y1='2' x2='16' y2='6' />
                            <line x1='8' y1='2' x2='8' y2='6' />
                            <line x1='3' y1='10' x2='21' y2='10' />
                          </svg>
                          <div class='stat-content'>
                            <div class='stat-value'>{{this.daysUntilText}}</div>
                            <div class='stat-label'>Timeline</div>
                          </div>
                        </div>
                      {{/if}}
                    </div>

                    <div class='status-insight {{@model.status}}'>
                      {{#if (eq @model.status 'completed')}}
                        🎉 Excellent! You've successfully completed this goal.
                      {{else if (eq @model.status 'overdue')}}
                        ⚠️ This goal is overdue. Consider updating the deadline
                        or prioritizing completion.
                      {{else if (eq @model.status 'urgent')}}
                        🔥 Urgent! This goal needs immediate attention to meet
                        the deadline.
                      {{else if (eq @model.status 'on-track')}}
                        ✅ You're making great progress and staying on track!
                      {{else if (eq @model.status 'in-progress')}}
                        📈 Good momentum! Keep working steadily toward
                        completion.
                      {{else}}
                        📋 Ready to start? Click "Edit" to update your progress.
                      {{/if}}
                    </div>
                  </div>
                {{/if}}
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>

    <style scoped>
      /* ⁽¹⁴⁾ Study Hub Theme - Focus Flow Design */
      .study-goal-view {
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
          0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        --radius: 12px;
        --radius-sm: 8px;
        --radius-xs: 6px;
      }

      .goal-container {
        max-width: 52rem;
        width: 100%;
        background: var(--surface-elevated);
        border-radius: var(--radius);
        box-shadow: var(--shadow-md);
        border: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        overflow-y: auto; /* ⁽⁵⁸⁾ Enable vertical scrolling */
        max-height: 100%;
      }

      /* ⁽¹⁵⁾ Header Design - Premium Learning Platform Aesthetic */
      .goal-header {
        background: linear-gradient(
          to bottom,
          var(--surface-elevated),
          rgba(248, 250, 252, 0.8)
        );
        border-bottom: 1px solid var(--border);
        padding: 2rem;
        flex-shrink: 0;
        backdrop-filter: blur(20px);
        position: relative;
      }

      .goal-header::before {
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
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 2rem;
      }

      .goal-info {
        flex: 1;
      }

      .goal-title {
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
        margin-bottom: 1rem;
        box-shadow: var(--shadow-sm);
      }

      .subject-icon {
        width: 1rem;
        height: 1rem;
      }

      .goal-description {
        color: var(--text-secondary);
        font-size: 1rem;
        line-height: 1.6;
        margin-top: 1rem;
      }

      .goal-status {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: flex-end;
      }

      .status-badges {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: flex-end;
      }

      /* ⁽¹⁶⁾ Priority Styling */
      .priority-high {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
        border: 1px solid rgba(239, 68, 68, 0.2);
      }
      .priority-medium {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }
      .priority-low {
        background: rgba(34, 197, 94, 0.1);
        color: #22c55e;
        border: 1px solid rgba(34, 197, 94, 0.2);
      }

      /* ⁽¹⁷⁾ Status Styling */
      .status-completed {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
      }
      .status-overdue {
        background: rgba(220, 38, 38, 0.1);
        color: #dc2626;
        border: 1px solid rgba(220, 38, 38, 0.2);
      }
      .status-urgent {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.2);
      }
      .status-on-track {
        background: rgba(59, 130, 246, 0.1);
        color: var(--border-focus);
        border: 1px solid rgba(59, 130, 246, 0.2);
      }
      .status-in-progress {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }
      .status-not-started {
        background: rgba(107, 114, 128, 0.1);
        color: var(--text-tertiary);
        border: 1px solid rgba(107, 114, 128, 0.2);
      }

      .status-icon {
        width: 1rem;
        height: 1rem;
        margin-right: 0.375rem;
      }

      /* ⁽¹⁸⁾ Content Sections with Proper Scrolling */
      .progress-section,
      .details-section {
        padding: 2rem;
        border-bottom: 1px solid rgba(226, 232, 240, 0.6);
        flex-shrink: 0; /* Prevent sections from shrinking */
      }

      .details-section {
        flex: 1; /* Allow details section to grow and scroll */
        overflow-y: auto;
        min-height: 0; /* Allow flex item to shrink if needed */
      }

      .actions-section {
        padding: 2rem;
        border-bottom: none;
        background: rgba(248, 250, 252, 0.5);
        flex-shrink: 0; /* Keep actions at bottom */
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
      }

      .section-title {
        font-family: 'Inter', sans-serif;
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.025em;
        position: relative;
        padding-left: 1rem;
      }

      .section-title::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: linear-gradient(180deg, var(--primary), var(--secondary));
        border-radius: 2px;
      }

      /* ⁽¹⁹⁾ Enhanced Progress Display with Smooth Transitions */
      .progress-display {
        display: flex;
        gap: 2rem;
        align-items: flex-start;
        transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .progress-display.editing {
        align-items: flex-start;
      }

      .progress-circle {
        position: relative;
        flex-shrink: 0;
        transition: all 0.5s ease;
      }

      .progress-ring {
        transform: rotate(-90deg);
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .progress-ring-fill {
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* ⁽⁴⁸⁾ Dynamic progress ring colors */
      .progress-ring-fill.completed {
        stroke: #059669;
      }
      .progress-ring-fill.on-track {
        stroke: #3b82f6;
      }
      .progress-ring-fill.in-progress {
        stroke: #f59e0b;
      }
      .progress-ring-fill.urgent {
        stroke: #ef4444;
      }
      .progress-ring-fill.overdue {
        stroke: #dc2626;
      }
      .progress-ring-fill.not-started {
        stroke: #9ca3af;
      }

      .progress-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
      }

      .progress-percentage {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
      }

      .progress-label {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        margin-top: 0.25rem;
        text-transform: uppercase;
        letter-spacing: 0.025em;
        font-weight: 500;
      }

      .progress-details {
        flex: 1;
        min-width: 0;
      }

      /* ⁽⁴⁹⁾ Inline Progress Editor */
      .progress-editor-inline {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.95),
          rgba(248, 250, 252, 0.9)
        );
        padding: 1.5rem;
        border-radius: var(--radius);
        border: 1px solid rgba(59, 130, 246, 0.15);
        backdrop-filter: blur(20px);
        box-shadow: var(--shadow);
        animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(226, 232, 240, 0.5);
      }

      .editor-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.025em;
      }

      .done-btn {
        padding: 0.5rem 1rem;
        background: linear-gradient(135deg, var(--secondary), #047857);
        color: white;
        border: none;
        border-radius: var(--radius-xs);
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        box-shadow: var(--shadow-sm);
      }

      .done-btn:hover {
        background: linear-gradient(135deg, #047857, #065f46);
        transform: translateY(-1px);
        box-shadow: var(--shadow);
      }

      .done-btn .btn-icon {
        width: 0.875rem;
        height: 0.875rem;
      }

      /* ⁽⁵⁰⁾ Milestone Buttons */
      .milestone-section {
        margin-bottom: 1.5rem;
      }

      .milestone-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 0.75rem;
        display: block;
      }

      .milestone-buttons {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .milestone-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.125rem;
        padding: 0.75rem 0.5rem;
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        flex: 1;
        min-width: 4rem;
        backdrop-filter: blur(10px);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-secondary);
      }

      .milestone-btn:hover {
        background: rgba(59, 130, 246, 0.1);
        border-color: var(--border-focus);
        transform: translateY(-2px);
        box-shadow: var(--shadow);
        color: var(--primary);
      }

      .milestone-btn.active {
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-color: var(--primary);
        color: white;
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
      }

      .milestone-text {
        font-size: 0.625rem;
        opacity: 0.8;
        text-transform: capitalize;
      }

      /* ⁽⁵¹⁾ Fine-tune Slider */
      .slider-section {
        margin-bottom: 1.5rem;
      }

      .slider-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 0.75rem;
        display: block;
      }

      .custom-slider {
        position: relative;
      }

      .progress-slider {
        width: 100%;
        height: 12px;
        background: transparent;
        border-radius: 6px;
        outline: none;
        appearance: none;
        position: relative;
        z-index: 2;
        cursor: pointer;
      }

      .progress-slider::-webkit-slider-thumb {
        appearance: none;
        width: 24px;
        height: 24px;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 50%;
        cursor: grab;
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(30, 58, 138, 0.3);
        transition: all 0.2s ease;
      }

      .progress-slider::-webkit-slider-thumb:hover {
        transform: scale(1.15);
        box-shadow: 0 6px 20px rgba(30, 58, 138, 0.4);
      }

      .slider-track {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 12px;
        background: rgba(226, 232, 240, 0.6);
        border-radius: 6px;
        transform: translateY(-50%);
        overflow: hidden;
        z-index: 1;
      }

      .slider-fill {
        height: 100%;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 6px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .slider-fill::before {
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

      /* ⁽⁵²⁾ Progress Overview (non-editing state) */
      .progress-overview {
        animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .overview-stats {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }

      .overview-stat {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: rgba(255, 255, 255, 0.8);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
        backdrop-filter: blur(10px);
        transition: all 0.3s ease;
      }

      .overview-stat:hover {
        transform: translateY(-1px);
        box-shadow: var(--shadow);
        border-color: rgba(59, 130, 246, 0.2);
      }

      .overview-stat.timeline.overdue,
      .overview-stat.timeline.urgent {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.05);
      }

      .overview-stat .stat-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--primary);
        padding: 0.375rem;
        background: rgba(59, 130, 246, 0.1);
        border-radius: var(--radius-xs);
        flex-shrink: 0;
      }

      .overview-stat .stat-content {
        flex: 1;
      }

      .overview-stat .stat-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
      }

      .overview-stat .stat-label {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        margin-top: 0.25rem;
        font-weight: 500;
      }

      /* ⁽⁵³⁾ Status Insight */
      .status-insight {
        padding: 1rem;
        border-radius: var(--radius-sm);
        font-size: 0.875rem;
        font-weight: 500;
        line-height: 1.4;
        border-left: 4px solid;
        backdrop-filter: blur(5px);
      }

      .status-insight.completed {
        background: rgba(5, 150, 105, 0.05);
        border-color: var(--secondary);
        color: #047857;
      }
      .status-insight.overdue {
        background: rgba(220, 38, 38, 0.05);
        border-color: #dc2626;
        color: #dc2626;
      }
      .status-insight.urgent {
        background: rgba(239, 68, 68, 0.05);
        border-color: #ef4444;
        color: #ef4444;
      }
      .status-insight.on-track {
        background: rgba(59, 130, 246, 0.05);
        border-color: #3b82f6;
        color: #1d4ed8;
      }
      .status-insight.in-progress {
        background: rgba(245, 158, 11, 0.05);
        border-color: var(--accent);
        color: #d97706;
      }
      .status-insight.not-started {
        background: rgba(107, 114, 128, 0.05);
        border-color: var(--text-tertiary);
        color: #4b5563;
      }

      /* ⁽⁵⁴⁾ Progress Feedback with Status Colors */
      .progress-feedback.completed {
        background: rgba(5, 150, 105, 0.05);
        border-color: rgba(5, 150, 105, 0.2);
        color: #047857;
      }
      .progress-feedback.on-track {
        background: rgba(59, 130, 246, 0.05);
        border-color: rgba(59, 130, 246, 0.2);
        color: #1d4ed8;
      }
      .progress-feedback.in-progress {
        background: rgba(245, 158, 11, 0.05);
        border-color: rgba(245, 158, 11, 0.2);
        color: #d97706;
      }
      .progress-feedback.urgent {
        background: rgba(239, 68, 68, 0.05);
        border-color: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }
      .progress-feedback.overdue {
        background: rgba(220, 38, 38, 0.05);
        border-color: rgba(220, 38, 38, 0.2);
        color: #dc2626;
      }
      .progress-feedback.not-started {
        background: rgba(107, 114, 128, 0.05);
        border-color: rgba(107, 114, 128, 0.2);
        color: #4b5563;
      }

      /* ⁽⁵⁷⁾ Live Progress Display */
      .current-progress {
        text-align: center;
        margin-top: 1rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.7);
        border-radius: var(--radius-sm);
        border: 1px solid rgba(226, 232, 240, 0.5);
        backdrop-filter: blur(10px);
      }

      .progress-display-large {
        margin-bottom: 0.75rem;
      }

      .progress-number {
        font-family: 'JetBrains Mono', monospace;
        font-size: 2.5rem;
        font-weight: 800;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        line-height: 1;
      }

      .progress-unit {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-tertiary);
        margin-left: 0.25rem;
      }

      .progress-feedback {
        font-size: 0.875rem;
        font-weight: 500;
        line-height: 1.4;
        padding: 0.75rem 1rem;
        border-radius: var(--radius-xs);
        border: 1px solid;
        backdrop-filter: blur(5px);
        margin-top: 0.75rem;
      }

      .slider-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 0.5rem;
        font-size: 0.6875rem;
        color: var(--text-tertiary);
        font-weight: 500;
      }

      @keyframes shimmer {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      /* ⁽²⁰⁾ Details Grid */
      .details-section {
        overflow-y: auto;
        flex: 1;
      }

      .details-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
        align-items: start;
      }

      .detail-card {
        background: var(--surface-elevated);
        border-radius: var(--radius-sm);
        padding: 1.5rem;
        border: 1px solid var(--border);
        box-shadow: var(--shadow);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .detail-card::before {
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

      .detail-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: rgba(59, 130, 246, 0.2);
      }

      .detail-card:hover::before {
        transform: scaleX(1);
      }

      .detail-card.completed {
        background: rgba(5, 150, 105, 0.02);
        border-color: var(--secondary);
      }

      .detail-card.completed::before {
        background: var(--secondary);
        transform: scaleX(1);
      }

      .detail-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .detail-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--primary);
        padding: 0.5rem;
        background: rgba(59, 130, 246, 0.1);
        border-radius: var(--radius-xs);
      }

      .detail-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .detail-value {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 0.5rem;
        line-height: 1.3;
      }

      .detail-subtitle {
        font-size: 0.8125rem;
        color: var(--text-tertiary);
        font-weight: 500;
      }

      .detail-subtitle.overdue,
      .detail-subtitle.urgent {
        color: #dc2626;
        font-weight: 600;
      }

      .detail-subtitle.on-track {
        color: var(--secondary);
        font-weight: 600;
      }

      .time-comparison .time-stats {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .time-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0;
        border-bottom: 1px solid rgba(226, 232, 240, 0.5);
      }

      .time-item:last-child {
        border-bottom: none;
      }

      .time-item.efficiency {
        font-weight: 600;
        color: var(--primary);
      }

      .time-label {
        font-size: 0.875rem;
        color: var(--text-secondary);
      }

      .time-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
      }

      /* ⁽²¹⁾ Action Buttons - Study Hub Style */
      .actions-section {
        flex-shrink: 0;
      }

      .primary-actions {
        display: flex;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .secondary-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
      }

      .edit-btn {
        padding: 0.5rem 1rem;
        background: rgba(255, 255, 255, 0.8);
        color: var(--text-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-xs);
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(5px);
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }

      .edit-btn:hover {
        background: var(--surface);
        border-color: var(--border-focus);
        transform: translateY(-1px);
      }

      .edit-btn .btn-icon {
        width: 0.875rem;
        height: 0.875rem;
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.875rem 1.5rem;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .action-btn.active {
        background: linear-gradient(135deg, var(--secondary), #047857);
        color: white;
        box-shadow: var(--shadow);
      }

      .action-btn.completed {
        background: linear-gradient(135deg, var(--accent), #d97706);
        color: white;
        box-shadow: var(--shadow);
      }

      .action-btn.secondary {
        background: var(--surface-elevated);
        color: var(--text-secondary);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-sm);
      }

      .action-btn::before {
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

      .action-btn:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .action-btn:hover::before {
        left: 100%;
      }

      .action-btn.secondary:hover {
        background: var(--surface);
        border-color: var(--border-focus);
      }

      .quick-action {
        padding: 0.75rem 1.25rem;
        background: rgba(255, 255, 255, 0.9);
        color: var(--text-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        font-size: 0.8125rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .quick-action:hover {
        background: var(--surface-elevated);
        border-color: var(--border-focus);
        transform: translateY(-1px);
        box-shadow: var(--shadow);
      }

      .btn-icon {
        width: 1.125rem;
        height: 1.125rem;
        transition: transform 0.3s ease;
      }

      .action-btn:hover .btn-icon {
        transform: scale(1.1);
      }

      /* ⁽²²⁾ Mobile Responsive with Improved Scrolling */
      @media (max-width: 768px) {
        .study-goal-view {
          padding: 1rem;
          height: 100vh; /* Full viewport height on mobile */
        }

        .goal-container {
          height: 100%;
          max-height: none; /* Remove max-height constraint on mobile */
        }

        .goal-header,
        .progress-section,
        .actions-section {
          padding: 1.5rem;
        }

        .details-section {
          padding: 1.5rem;
          flex: 1;
          overflow-y: auto; /* Ensure scrolling works on mobile */
        }

        .goal-title {
          font-size: 1.5rem;
        }

        .header-content {
          flex-direction: column;
          gap: 1.5rem;
          align-items: stretch;
        }

        .progress-display {
          flex-direction: column;
          text-align: center;
          gap: 1.5rem;
        }

        .details-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .primary-actions,
        .secondary-actions {
          flex-direction: column;
          gap: 0.75rem;
        }
      }

      @media (max-height: 600px) {
        .study-goal-view {
          padding: 0.75rem;
        }

        .goal-header,
        .progress-section,
        .details-section,
        .actions-section {
          padding: 1rem;
        }

        .goal-title {
          font-size: 1.25rem;
        }

        .section-title {
          font-size: 1.25rem;
        }
      }
    </style>
  </template>
}

class StudyGoalEmbedded extends Component<typeof StudyGoal> {
  // ⁽²³⁾ Enhanced embedded template with study hub theme
  get statusColor() {
    const status = this.args?.model?.status || 'not-started';
    switch (status) {
      case 'completed':
        return 'completed';
      case 'overdue':
        return 'overdue';
      case 'urgent':
        return 'urgent';
      case 'on-track':
        return 'on-track';
      case 'in-progress':
        return 'in-progress';
      default:
        return 'not-started';
    }
  }

  get priorityColor() {
    const priority = this.args?.model?.priority || '';
    switch (priority.toLowerCase()) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  get daysUntilText() {
    const days = this.args?.model?.daysUntilDue;
    if (days === null || days === undefined) return null;

    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days <= 7) return `${days}d left`;
    return `${days} days left`;
  }

  get progressPercentage() {
    return this.args?.model?.progress || 0;
  }

  <template>
    <div class='study-goal-embedded'>
      <div class='goal-header'>
        <div class='header-main'>
          <h4 class='goal-title'>{{if
              @model.goalTitle
              @model.goalTitle
              'Untitled Goal'
            }}</h4>
          {{#if @model.subject}}
            <div class='subject-badge'>{{@model.subject}}</div>
          {{/if}}
        </div>
        <div class='goal-badges'>
          {{#if @model.priority}}
            <Pill
              class='priority-{{this.priorityColor}}'
            >{{@model.priority}}</Pill>
          {{/if}}
          <Pill class='status-{{this.statusColor}}'>
            {{#if (eq @model.status 'completed')}}
              ✓ Done
            {{else if (eq @model.status 'overdue')}}
              ⚠️ Overdue
            {{else if (eq @model.status 'urgent')}}
              🔥 Urgent
            {{else if (eq @model.status 'on-track')}}
              ✅ On Track
            {{else if (eq @model.status 'in-progress')}}
              📈 In Progress
            {{else}}
              📋 Not Started
            {{/if}}
          </Pill>
        </div>
      </div>

      {{#if @model.description}}
        <div class='goal-description'>{{@model.description}}</div>
      {{/if}}

      <div class='progress-display'>
        <div class='progress-info'>
          <span class='progress-label'>Progress</span>
          <span class='progress-percentage'>{{this.progressPercentage}}%</span>
        </div>
        <div class='progress-bar'>
          <div
            class='progress-fill {{this.statusColor}}'
            style={{htmlSafe (concat 'width: ' this.progressPercentage '%')}}
          ></div>
        </div>
      </div>

      <div class='goal-metadata'>
        {{#if @model.targetDate}}
          <div class='meta-item {{@model.status}}'>
            <svg
              class='meta-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
              <line x1='16' y1='2' x2='16' y2='6' />
              <line x1='8' y1='2' x2='8' y2='6' />
              <line x1='3' y1='10' x2='21' y2='10' />
            </svg>
            {{#if this.daysUntilText}}
              {{this.daysUntilText}}
            {{else}}
              Due:
              {{formatDateTime @model.targetDate size='short'}}
            {{/if}}
          </div>
        {{/if}}

        {{#if @model.completedAt}}
          <div class='meta-item completed'>
            <svg
              class='meta-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='20,6 9,17 4,12' />
            </svg>
            Completed
            {{formatDateTime @model.completedAt relative=true}}
          </div>
        {{/if}}

        {{#if (and @model.studyTimeEstimate @model.actualTimeSpent)}}
          <div class='meta-item time-tracking'>
            <svg
              class='meta-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polyline points='12,6 12,12 16,14' />
            </svg>
            {{@model.actualTimeSpent}}h /
            {{@model.studyTimeEstimate}}h
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* ⁽²⁶⁾ Study Hub Embedded Styling */
      .study-goal-embedded {
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
        transition: all 0.3s ease;

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
        --radius-xs: 6px;
      }

      .study-goal-embedded:hover {
        transform: translateY(-1px);
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
        border-color: rgba(59, 130, 246, 0.2);
      }

      .goal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
        gap: 1rem;
      }

      .header-main {
        flex: 1;
      }

      .goal-title {
        font-family: 'Inter', sans-serif;
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
        letter-spacing: -0.025em;
      }

      .subject-badge {
        background: linear-gradient(135deg, var(--primary), #2563eb);
        color: white;
        font-size: 0.6875rem;
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-xs);
        display: inline-block;
        font-weight: 600;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      }

      .goal-badges {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        flex-shrink: 0;
        align-items: flex-end;
      }

      .goal-description {
        color: var(--text-secondary);
        font-size: 0.8125rem;
        margin-bottom: 1rem;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* ⁽²⁷⁾ Priority Badges */
      .priority-high {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
        border: 1px solid rgba(239, 68, 68, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .priority-medium {
        background: rgba(245, 158, 11, 0.1);
        color: #d97706;
        border: 1px solid rgba(245, 158, 11, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .priority-low {
        background: rgba(34, 197, 94, 0.1);
        color: #22c55e;
        border: 1px solid rgba(34, 197, 94, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }

      /* ⁽²⁸⁾ Status Badges */
      .status-completed {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .status-overdue {
        background: rgba(220, 38, 38, 0.1);
        color: #dc2626;
        border: 1px solid rgba(220, 38, 38, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .status-urgent {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .status-on-track {
        background: rgba(59, 130, 246, 0.1);
        color: #3b82f6;
        border: 1px solid rgba(59, 130, 246, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .status-in-progress {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }
      .status-not-started {
        background: rgba(107, 114, 128, 0.1);
        color: var(--text-tertiary);
        border: 1px solid rgba(107, 114, 128, 0.2);
        font-size: 0.625rem;
        padding: 0.125rem 0.375rem;
      }

      .progress-display {
        margin-bottom: 1rem;
      }

      .progress-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .progress-label {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        font-weight: 500;
      }

      .progress-percentage {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--text-primary);
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background: rgba(226, 232, 240, 0.6);
        border-radius: 4px;
        overflow: hidden;
        position: relative;
      }

      .progress-fill {
        height: 100%;
        border-radius: 4px;
        transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .progress-fill.completed {
        background: linear-gradient(135deg, var(--secondary), #047857);
      }
      .progress-fill.on-track {
        background: linear-gradient(135deg, #3b82f6, var(--primary));
      }
      .progress-fill.in-progress {
        background: linear-gradient(135deg, var(--accent), #d97706);
      }
      .progress-fill.urgent {
        background: linear-gradient(135deg, #ef4444, #dc2626);
      }
      .progress-fill.overdue {
        background: linear-gradient(135deg, #dc2626, #b91c1c);
      }
      .progress-fill.not-started {
        background: linear-gradient(135deg, var(--text-tertiary), #9ca3af);
      }

      .goal-metadata {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .meta-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .meta-item.overdue,
      .meta-item.urgent {
        color: #dc2626;
        font-weight: 600;
      }

      .meta-item.completed {
        color: var(--secondary);
        font-weight: 600;
      }

      .meta-item.on-track {
        color: #3b82f6;
      }

      .meta-icon {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
      }

      .time-tracking {
        font-family: 'JetBrains Mono', monospace;
      }
    </style>
  </template>
}

export class StudyGoal extends CardDef {
  // ⁵ Study Goal card - enhanced for study hub theme
  static displayName = 'Study Goal';
  static icon = TargetIcon;

  @field goalTitle = contains(StringField); // ⁶ Primary fields
  @field description = contains(TextAreaField);
  @field targetDate = contains(DateField);
  @field isCompleted = contains(BooleanField);
  @field subject = contains(StringField);
  @field priority = contains(StringField); // ⁽²⁾ High, Medium, Low priority
  @field progress = contains(NumberField); // ⁽³⁾ 0-100 percentage completion
  @field studyTimeEstimate = contains(NumberField); // ⁽⁴⁾ Estimated hours to complete
  @field actualTimeSpent = contains(NumberField); // ⁽⁵⁾ Actual hours spent
  @field createdAt = contains(DatetimeField);
  @field completedAt = contains(DatetimeField); // ⁽⁶⁾ When goal was completed

  // ⁷ Computed title
  @field title = contains(StringField, {
    computeVia: function (this: StudyGoal) {
      try {
        return this.goalTitle ?? 'Untitled Goal';
      } catch (e) {
        console.error('StudyGoal: Error computing title', e);
        return 'Untitled Goal';
      }
    },
  });

  // ⁽⁷⁾ Computed days until due date
  @field daysUntilDue = contains(NumberField, {
    computeVia: function (this: StudyGoal) {
      try {
        if (!this.targetDate || this.isCompleted) return null;

        const now = new Date();
        const target = new Date(this.targetDate);
        const diffTime = target.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays;
      } catch (e) {
        console.error('StudyGoal: Error computing days until due', e);
        return null;
      }
    },
  });

  // ⁽⁸⁾ Computed status based on progress and due date
  @field status = contains(StringField, {
    computeVia: function (this: StudyGoal) {
      try {
        if (this.isCompleted) return 'completed';

        const daysLeft = this.daysUntilDue;
        const progress = this.progress || 0;

        if (daysLeft !== null && daysLeft < 0) return 'overdue';
        if (daysLeft !== null && daysLeft <= 3) return 'urgent';
        if (progress >= 75) return 'on-track';
        if (progress >= 25) return 'in-progress';
        return 'not-started';
      } catch (e) {
        console.error('StudyGoal: Error computing status', e);
        return 'unknown';
      }
    },
  });

  static isolated = StudyGoalIsolated;

  static embedded = StudyGoalEmbedded;
}
