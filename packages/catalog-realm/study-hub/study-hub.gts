// ═══ [EDIT TRACKING: ON] Mark all changes with ¹ ═══
import {
  CardDef,
  field,
  contains,
  linksToMany,
  Component,
  linksTo,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

import { StudyResource } from '../study-resource/study-resource';
import { StudyGoal } from '../study-goal/study-goal';
import { StudySession } from '../study-session/study-session';
import { FlashcardCard } from '../flashcard/flashcard';
import { StudyNoteCard } from '../study-note/study-note';
import { PracticeQuizCard } from '../practice-quiz/practice-quiz';
import { FocusTimerCard } from '../focus-timer/focus-timer';
import { CalendarCard } from '../calendar/calendar'; // ¹¹⁸ New dynamic card imports
import { AnnotationCard } from '../annotation/annotation';
import { eq, gt, lt } from '@cardstack/boxel-ui/helpers'; // ³ Logic helpers
import { formatDuration } from '@cardstack/boxel-ui/helpers'; // ⁴ Format helpers
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import BrainIcon from '@cardstack/boxel-icons/brain';

class StudyHubIsolated extends Component<typeof StudyHub> {
  // ²³ Main dashboard template
  @tracked activeTab = 'dashboard';
  @tracked showAddResource = false;
  @tracked showAddGoal = false;

  // ²⁴ Tab switching
  @action
  switchTab(tab: string) {
    this.activeTab = tab;
  }

  // ²⁵ Modal toggles
  @action
  toggleAddResource() {
    this.showAddResource = !this.showAddResource;
  }

  @action
  toggleAddGoal() {
    this.showAddGoal = !this.showAddGoal;
  }

  // ²⁶ Dynamic analytics getters
  get currentTime() {
    return Date.now();
  }

  // ²⁶ᵃ Dynamic weekly progress calculation - Fixed to handle relationship data properly
  get dynamicWeeklyProgress() {
    try {
      const weeklyGoal = this.args?.model?.weeklyGoal || 600; // Default 10 hours

      // studySessions is a linksToMany field, so it returns a collection of StudySession cards
      const sessions = this.args?.model?.studySessions;

      if (!sessions) {
        return 0;
      }

      // For linksToMany fields, we need to convert to array and filter valid sessions
      const sessionArray: StudySession[] = Array.isArray(sessions)
        ? sessions
        : Object.values(sessions || {});

      if (sessionArray.length === 0) {
        return 0;
      }

      // Calculate time from sessions in the last 7 days
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentSessions = sessionArray.filter((session) => {
        try {
          // Session should be a StudySession card instance
          if (!session || typeof session !== 'object') {
            return false;
          }

          const sessionDate = session?.startTime
            ? new Date(session.startTime)
            : null;

          if (!sessionDate || isNaN(sessionDate.getTime())) {
            return false;
          }

          return sessionDate >= weekAgo;
        } catch (e) {
          return false;
        }
      });

      const weeklyTime = recentSessions.reduce((total, session) => {
        try {
          const duration = session?.duration || session?.actualDuration || 0;
          const numericDuration =
            typeof duration === 'number' ? duration : parseInt(duration) || 0;
          return total + numericDuration;
        } catch (e) {
          return total;
        }
      }, 0);

      return Math.min(Math.round((weeklyTime / weeklyGoal) * 100), 100);
    } catch (e) {
      console.error('StudyHub: Error computing dynamic weekly progress', e);
      return 0;
    }
  }

  // ²⁶ᵇ Dynamic total study time from sessions
  get calculatedStudyTime() {
    try {
      const sessions = this.args?.model?.studySessions;
      if (!Array.isArray(sessions)) return 0;

      return sessions.reduce((total, session) => {
        try {
          const duration = session?.duration || session?.actualDuration || 0;
          return total + duration;
        } catch (e) {
          return total;
        }
      }, 0);
    } catch (e) {
      console.error('StudyHub: Error calculating total study time', e);
      return 0;
    }
  }

  get completedGoals() {
    try {
      const goals = this.args?.model?.studyGoals;
      if (!Array.isArray(goals)) return 0;
      return goals.filter((goal) => goal?.isCompleted)?.length || 0;
    } catch (e) {
      console.error('StudyHub: Error computing completed goals', e);
      return 0;
    }
  }

  get totalGoals() {
    try {
      const goals = this.args?.model?.studyGoals;
      if (!Array.isArray(goals)) return 0;
      return goals.length || 0;
    } catch (e) {
      console.error('StudyHub: Error computing total goals', e);
      return 0;
    }
  }

  get completedResources() {
    try {
      const resources = this.args?.model?.studyResources;
      if (!Array.isArray(resources)) return 0;
      return (
        resources.filter(
          (resource) => resource?.completionStatus === 'completed',
        )?.length || 0
      );
    } catch (e) {
      console.error('StudyHub: Error computing completed resources', e);
      return 0;
    }
  }

  get totalResources() {
    try {
      const resources = this.args?.model?.studyResources;
      if (!Array.isArray(resources)) return 0;
      return resources.length || 0;
    } catch (e) {
      console.error('StudyHub: Error computing total resources', e);
      return 0;
    }
  }

  // ²⁶ᶜ Dynamic study time formatting using calculated time
  get formattedStudyTime() {
    try {
      // Use calculated time from sessions, fallback to stored total
      const totalMinutes = this.calculatedStudyTime || 0;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    } catch (e) {
      return '0m';
    }
  }

  <template>
    <div class='study-hub'>
      <header class='hub-header'>
        <div class='header-content'>
          <h1 class='hub-title'>
            <svg
              class='hub-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44L2 17H1a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1l5.04-2.94A2.5 2.5 0 0 1 9.5 2Z'
              />
              <path d='M16 8h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4' />
              <circle cx='12' cy='12' r='1' />
            </svg>
            {{if @model.hubName @model.hubName 'My Study Hub'}}
          </h1>

          <div class='header-stats'>
            <div class='stat'>
              <span class='stat-value'>{{this.formattedStudyTime}}</span>
              <span class='stat-label'>total time</span>
            </div>
            <div class='stat'>
              <span class='stat-value'>{{@model.currentStreak}}</span>
              <span class='stat-label'>day streak</span>
            </div>
            <div class='stat'>
              <span
                class='stat-value'
              >{{this.completedGoals}}/{{this.totalGoals}}</span>
              <span class='stat-label'>goals</span>
            </div>
          </div>
        </div>

        <nav class='tab-navigation'>
          <button
            class='tab-button
              {{if (eq this.activeTab "dashboard") "active" ""}}'
            {{on 'click' (fn this.switchTab 'dashboard')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='7' height='7' />
              <rect x='14' y='3' width='7' height='7' />
              <rect x='14' y='14' width='7' height='7' />
              <rect x='3' y='14' width='7' height='7' />
            </svg>
            Dashboard
          </button>

          <button
            class='tab-button
              {{if (eq this.activeTab "resources") "active" ""}}'
            {{on 'click' (fn this.switchTab 'resources')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
              <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
            </svg>
            Resources
          </button>

          <button
            class='tab-button {{if (eq this.activeTab "goals") "active" ""}}'
            {{on 'click' (fn this.switchTab 'goals')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <circle cx='12' cy='12' r='6' />
              <circle cx='12' cy='12' r='2' />
            </svg>
            Goals
          </button>

          <button
            class='tab-button {{if (eq this.activeTab "sessions") "active" ""}}'
            {{on 'click' (fn this.switchTab 'sessions')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polyline points='12,6 12,12 16,14' />
            </svg>
            Sessions
          </button>

          <button
            class='tab-button {{if (eq this.activeTab "tools") "active" ""}}'
            {{on 'click' (fn this.switchTab 'tools')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44L2 17H1a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1l5.04-2.94A2.5 2.5 0 0 1 9.5 2Z'
              />
            </svg>
            Tools
          </button>

          <button
            class='tab-button {{if (eq this.activeTab "calendar") "active" ""}}'
            {{on 'click' (fn this.switchTab 'calendar')}}
          >
            <svg
              class='tab-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polyline points='12,6 12,12 16,14' />
            </svg>
            Calendar
          </button>
        </nav>
      </header>

      <main class='hub-content'>
        {{#if (eq this.activeTab 'dashboard')}}
          <div class='dashboard-view'>
            <section class='metrics-section'>
              <h2 class='section-title'>Today's Overview</h2>
              <div class='metrics-grid'>
                <div class='metric-card'>
                  <div class='metric-header'>
                    <svg
                      class='metric-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <line x1='12' y1='1' x2='12' y2='23' />
                      <path
                        d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'
                      />
                    </svg>
                    <span class='metric-title'>Weekly Progress</span>
                  </div>
                  <div
                    class='metric-value'
                  >{{this.dynamicWeeklyProgress}}%</div>
                  <div class='progress-bar'>
                    <div
                      class='progress-fill'
                      style={{htmlSafe
                        (concat 'width: ' this.dynamicWeeklyProgress '%')
                      }}
                    ></div>
                  </div>
                  <div class='metric-subtitle'>
                    Goal:
                    {{formatDuration
                      (if @model.weeklyGoal @model.weeklyGoal 600)
                      unit='minutes'
                      format='humanize'
                    }}
                    per week
                  </div>
                </div>

                <div class='metric-card'>
                  <div class='metric-header'>
                    <svg
                      class='metric-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                      <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
                    </svg>
                    <span class='metric-title'>Active Resources</span>
                  </div>
                  <div class='metric-value'>{{this.totalResources}}</div>
                  <div class='metric-subtitle'>{{this.completedResources}}
                    completed</div>
                </div>

                <div class='metric-card'>
                  <div class='metric-header'>
                    <svg
                      class='metric-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <circle cx='12' cy='12' r='10' />
                      <circle cx='12' cy='12' r='6' />
                      <circle cx='12' cy='12' r='2' />
                    </svg>
                    <span class='metric-title'>Current Goals</span>
                  </div>
                  <div class='metric-value'>{{this.totalGoals}}</div>
                  <div class='metric-subtitle'>{{this.completedGoals}}
                    achieved</div>
                </div>

                <div class='metric-card'>
                  <div class='metric-header'>
                    <svg
                      class='metric-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M8 2v4' />
                      <path d='M16 2v4' />
                      <rect width='18' height='18' x='3' y='4' rx='2' />
                      <path d='M3 10h18' />
                    </svg>
                    <span class='metric-title'>Study Streak</span>
                  </div>
                  <div class='metric-value'>{{@model.currentStreak}}</div>
                  <div class='metric-subtitle'>consecutive days</div>
                </div>
              </div>
            </section>

            <section class='recent-section'>
              <h2 class='section-title'>Recent Sessions</h2>
              {{#if (gt @model.studySessions.length 0)}}
                <div class='sessions-container'>
                  <@fields.studySessions @format='embedded' />
                </div>
              {{else}}
                <div class='empty-state'>
                  <svg
                    class='empty-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <polyline points='12,6 12,12 16,14' />
                  </svg>
                  <p>No study sessions yet. Start your first session to track
                    your progress!</p>
                </div>
              {{/if}}
            </section>
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'resources')}}
          <div class='resources-view'>
            <div class='view-header'>
              <h2 class='section-title'>Study Resources</h2>
            </div>

            {{#if (gt @model.studyResources.length 0)}}
              <div class='resources-container'>
                <@fields.studyResources @format='embedded' />
              </div>
            {{else}}
              <div class='empty-state'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                  <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
                </svg>
                <p>No resources added yet. Click "Add Resource" to get started!</p>
              </div>
            {{/if}}
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'goals')}}
          <div class='goals-view'>
            <div class='view-header'>
              <h2 class='section-title'>Study Goals</h2>
            </div>

            {{#if (gt @model.studyGoals.length 0)}}
              <div class='goals-container'>
                <@fields.studyGoals @format='embedded' />
              </div>
            {{else}}
              <div class='empty-state'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <circle cx='12' cy='12' r='6' />
                  <circle cx='12' cy='12' r='2' />
                </svg>
                <p>No goals set yet. Create your first goal to start tracking
                  progress!</p>
              </div>
            {{/if}}
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'sessions')}}
          <div class='sessions-view'>
            <div class='view-header'>
              <h2 class='section-title'>Study Sessions</h2>
              <div class='session-stats'>
                <span class='stat'>Total: {{this.formattedStudyTime}}</span>
                <span class='stat'>Sessions:
                  {{@model.studySessions.length}}</span>
              </div>
            </div>

            {{#if (gt @model.studySessions.length 0)}}
              <div class='sessions-container'>
                <@fields.studySessions @format='embedded' />
              </div>
            {{else}}
              <div class='empty-state'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12,6 12,12 16,14' />
                </svg>
                <p>No study sessions recorded yet. Complete your first session
                  to see it here!</p>
              </div>
            {{/if}}
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'tools')}}
          <div class='tools-view'>
            <div class='tools-grid'>
              <section class='tool-section'>
                <div class='section-header'>
                  <h3 class='section-title'>Flashcards</h3>
                </div>
                {{#if (gt @model.flashcards.length 0)}}
                  <div class='flashcards-container'>
                    <@fields.flashcards @format='embedded' />
                  </div>
                {{else}}
                  <div class='empty-state-small'>
                    <p>No flashcards yet. Create your first study card!</p>
                  </div>
                {{/if}}
              </section>

              <section class='tool-section'>
                <div class='section-header'>
                  <h3 class='section-title'>Study Notes</h3>
                </div>
                {{#if (gt @model.studyNotes.length 0)}}
                  <div class='notes-container'>
                    <@fields.studyNotes @format='embedded' />
                  </div>
                {{else}}
                  <div class='empty-state-small'>
                    <p>No notes yet. Start taking organized study notes!</p>
                  </div>
                {{/if}}
              </section>

              <section class='tool-section'>
                <div class='section-header'>
                  <h3 class='section-title'>Practice Quizzes</h3>

                </div>
                {{#if (gt @model.practiceQuizzes.length 0)}}
                  <div class='quizzes-container'>
                    <@fields.practiceQuizzes @format='embedded' />
                  </div>
                {{else}}
                  <div class='empty-state-small'>
                    <p>No quizzes yet. Create practice tests for
                      self-assessment!</p>
                  </div>
                {{/if}}
              </section>

              <section class='tool-section'>
                <div class='section-header'>
                  <h3 class='section-title'>Document Annotations</h3>

                </div>
                {{#if (gt @model.annotations.length 0)}}
                  <div class='annotations-container'>
                    <@fields.annotations @format='embedded' />
                  </div>
                {{else}}
                  <div class='empty-state-small'>
                    <p>Upload documents to start annotating and highlighting
                      important content!</p>
                  </div>
                {{/if}}
              </section>

              <section class='tool-section full-width'>
                <div class='section-header'>
                  <h3 class='section-title'>Focus Timers</h3>
                </div>
                {{#if (gt @model.focusTimers.length 0)}}
                  <div class='timers-container'>
                    <@fields.focusTimers @format='embedded' />
                  </div>
                {{else}}
                  <div class='empty-state-small'>
                    <p>No active timers. Set up a Pomodoro session!</p>
                  </div>
                {{/if}}
              </section>

            </div>
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'calendar')}}
          <div class='calendar-view'>
            <@fields.studyCalendar @format='isolated' />
          </div>
        {{/if}}

      </main>
    </div>

    <style scoped>
      /* ¹ Focus Flow Theme - Core Design System */
      .study-hub {
        /* Typography foundation */
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #f8fafc; /* Cool Gray surface */
        color: #1f2937; /* Rich Charcoal text */
        overflow: hidden;

        /* CSS Custom Properties - Design Tokens */
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

      /* ² Header Design - Premium Learning Platform Aesthetic */
      .hub-header {
        background: linear-gradient(
          to bottom,
          var(--surface-elevated),
          rgba(248, 250, 252, 0.8)
        );
        border-bottom: 1px solid var(--border);
        padding: 2rem 2rem 0;
        flex-shrink: 0;
        backdrop-filter: blur(20px);
        position: relative;
      }

      .hub-header::before {
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
        align-items: center;
        margin-bottom: 2rem;
      }

      .hub-title {
        display: flex;
        align-items: center;
        gap: 1rem;
        font-family: 'Inter', sans-serif;
        font-size: 2rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.025em;
      }

      .hub-icon {
        width: 2.5rem;
        height: 2.5rem;
        color: var(--primary);
        filter: drop-shadow(0 2px 4px rgba(30, 58, 138, 0.15));
      }

      /* ³ Header Stats - Motivational Metrics */
      .header-stats {
        display: flex;
        gap: 3rem;
        padding: 1rem 2rem;
        background: rgba(255, 255, 255, 0.8);
        border-radius: var(--radius);
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow-sm);
      }

      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        position: relative;
      }

      .stat::after {
        content: '';
        position: absolute;
        bottom: -0.5rem;
        left: 50%;
        transform: translateX(-50%);
        width: 2rem;
        height: 2px;
        background: linear-gradient(90deg, var(--primary), var(--secondary));
        border-radius: 1px;
        opacity: 0.3;
      }

      .stat-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.5rem;
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
        font-weight: 500;
        color: var(--text-tertiary);
        margin-top: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      /* ⁴ Navigation Tabs - Clean & Professional */
      .tab-navigation {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--border);
        background: var(--surface-elevated);
        border-radius: var(--radius) var(--radius) 0 0;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .tab-navigation::-webkit-scrollbar {
        display: none;
      }

      .tab-button {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        background: none;
        border: none;
        color: var(--text-tertiary);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        border-bottom: 3px solid transparent;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
        position: relative;
      }

      .tab-button::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(59, 130, 246, 0.05);
        border-radius: var(--radius-xs) var(--radius-xs) 0 0;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .tab-button:hover {
        color: var(--text-secondary);
        transform: translateY(-1px);
      }

      .tab-button:hover::before {
        opacity: 1;
      }

      .tab-button.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
        background: var(--surface-elevated);
        font-weight: 600;
      }

      .tab-button.active::before {
        opacity: 0;
      }

      .tab-icon {
        width: 1.125rem;
        height: 1.125rem;
        transition: transform 0.3s ease;
      }

      .tab-button:hover .tab-icon {
        transform: scale(1.1);
      }

      /* ⁵ Main Content Area - Generous Spacing */
      .hub-content {
        flex: 1;
        overflow-y: auto;
        padding: 2.5rem;
        background: var(--surface);
      }

      .section-title {
        font-family: 'Inter', sans-serif;
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 2rem 0;
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

      /* ⁶ Dashboard Metrics - Clean Cards with Subtle Depth */
      .metrics-section {
        margin-bottom: 2.5rem;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1.5rem;
      }

      .metric-card {
        background: var(--surface-elevated);
        border-radius: var(--radius);
        padding: 2rem;
        border: 1px solid rgba(226, 232, 240, 0.6);
        box-shadow: var(--shadow);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .metric-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, var(--primary), var(--secondary));
        transform: scaleX(0);
        transition: transform 0.3s ease;
        transform-origin: left;
      }

      .metric-card:hover {
        transform: translateY(-4px);
        box-shadow: var(--shadow-md);
        border-color: rgba(59, 130, 246, 0.2);
      }

      .metric-card:hover::before {
        transform: scaleX(1);
      }

      .metric-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .metric-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary);
        padding: 0.5rem;
        background: rgba(59, 130, 246, 0.1);
        border-radius: var(--radius-xs);
      }

      .metric-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .metric-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 2.5rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
        margin-bottom: 0.75rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .metric-subtitle {
        font-size: 0.8125rem;
        color: var(--text-tertiary);
        font-weight: 500;
      }

      /* ⁷ Progress Bars - Smooth Animations */
      .progress-bar {
        width: 100%;
        height: 10px;
        background: rgba(226, 232, 240, 0.6);
        border-radius: 5px;
        overflow: hidden;
        margin-bottom: 0.75rem;
        position: relative;
      }

      .progress-bar::before {
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

      .progress-fill {
        height: 100%;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 5px;
        transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      @keyframes shimmer {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      /* ⁸ View Headers - Consistent Layout */
      .view-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(226, 232, 240, 0.6);
      }

      /* ⁹ Action Buttons - Focus Flow Design Language */
      .add-button {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1.5rem;
        background: linear-gradient(135deg, var(--primary), #2563eb);
        color: white;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: var(--shadow);
        position: relative;
        overflow: hidden;
      }

      .add-button::before {
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

      .add-button:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .add-button:hover::before {
        left: 100%;
      }

      .add-button:active {
        transform: translateY(-1px);
      }

      .button-icon {
        width: 1.125rem;
        height: 1.125rem;
        transition: transform 0.3s ease;
      }

      .add-button:hover .button-icon {
        transform: rotate(90deg);
      }

      /* ¹⁰ Session Stats - Data Display */
      .session-stats {
        display: flex;
        gap: 2rem;
        font-size: 0.875rem;
        color: var(--text-secondary);
        background: rgba(255, 255, 255, 0.7);
        padding: 0.75rem 1.5rem;
        border-radius: var(--radius-sm);
        backdrop-filter: blur(10px);
      }

      .session-stats .stat {
        font-weight: 600;
        color: var(--text-primary);
      }

      /* ¹¹ Container Spacing - Professional Rhythm */
      .resources-container > .linksToMany-field,
      .goals-container > .linksToMany-field,
      .sessions-container > .linksToMany-field,
      .flashcards-container > .linksToMany-field,
      .notes-container > .linksToMany-field,
      .assignments-container > .linksToMany-field,
      .achievements-container > .linksToMany-field,
      .quizzes-container > .linksToMany-field,
      .guides-container > .linksToMany-field,
      .timers-container > .linksToMany-field,
      .uploads-container > .linksToMany-field,
      .trackers-container > .linksToMany-field,
      .deadlines-container > .linksToMany-field,
      .annotations-container > .linksToMany-field {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      /* ¹² Today's Focus View - Motivational Layout */
      .today-view {
        width: 100%;
      }

      .focus-section {
        margin-bottom: 3rem;
      }

      .focus-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
        align-items: start;
      }

      .focus-card {
        background: var(--surface-elevated);
        border-radius: var(--radius);
        padding: 2rem;
        border: 1px solid rgba(226, 232, 240, 0.6);
        box-shadow: var(--shadow);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .focus-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background: linear-gradient(180deg, var(--primary), var(--secondary));
        transform: scaleY(0);
        transition: transform 0.3s ease;
        transform-origin: bottom;
      }

      .focus-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .focus-card:hover::before {
        transform: scaleY(1);
      }

      .focus-card-title {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 1.5rem 0;
        letter-spacing: -0.025em;
      }

      .card-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary);
        padding: 0.5rem;
        background: rgba(59, 130, 246, 0.1);
        border-radius: var(--radius-xs);
      }

      /* ¹³ Focus Items - Interactive Task Management */
      .focus-items {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .focus-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        background: rgba(248, 250, 252, 0.7);
        border-radius: var(--radius-sm);
        transition: all 0.3s ease;
        border: 1px solid transparent;
      }

      .focus-item:hover {
        background: rgba(59, 130, 246, 0.05);
        border-color: rgba(59, 130, 246, 0.2);
        transform: translateX(4px);
      }

      .focus-checkbox {
        width: 1.25rem;
        height: 1.25rem;
        border-radius: var(--radius-xs);
        border: 2px solid var(--border);
        transition: all 0.3s ease;
        cursor: pointer;
      }

      .focus-checkbox:checked {
        background: var(--secondary);
        border-color: var(--secondary);
      }

      .focus-text {
        font-size: 0.9375rem;
        color: var(--text-primary);
        flex: 1;
        line-height: 1.4;
        font-weight: 500;
      }

      .empty-focus {
        text-align: center;
        padding: 3rem 2rem;
        color: var(--text-tertiary);
        background: rgba(248, 250, 252, 0.5);
        border-radius: var(--radius);
        border: 2px dashed var(--border);
      }

      .empty-focus p {
        font-size: 0.9375rem;
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
      }

      /* ¹⁴ Review Items - Due Today Highlighting */
      .review-items {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .review-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: rgba(59, 130, 246, 0.05);
        border-radius: var(--radius-sm);
        border-left: 4px solid var(--primary);
        transition: all 0.3s ease;
      }

      .review-item:hover {
        background: rgba(59, 130, 246, 0.1);
        transform: translateX(4px);
      }

      .review-icon {
        width: 1rem;
        height: 1rem;
        color: var(--primary);
        flex-shrink: 0;
      }

      .review-text {
        font-size: 0.8125rem;
        color: var(--primary);
        font-weight: 600;
        flex: 1;
      }

      /* ¹⁵ Recommendations - Smart Insights */
      .recommendation-items {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .recommendation-item {
        padding: 1.25rem;
        background: rgba(245, 158, 11, 0.05);
        border-left: 4px solid var(--accent);
        border-radius: var(--radius-sm);
        transition: all 0.3s ease;
        position: relative;
      }

      .recommendation-item::before {
        content: '💡';
        position: absolute;
        top: 1rem;
        right: 1rem;
        font-size: 1.25rem;
        opacity: 0.6;
      }

      .recommendation-item:hover {
        background: rgba(245, 158, 11, 0.1);
        transform: translateX(4px);
      }

      .rec-text {
        font-size: 0.9375rem;
        color: #92400e;
        line-height: 1.5;
        font-weight: 500;
        padding-right: 2rem;
      }

      /* ¹⁶ Activity Timeline - Progress History */
      .activity-section {
        margin-bottom: 3rem;
      }

      .activity-timeline {
        position: relative;
        padding-left: 3rem;
      }

      .activity-timeline::before {
        content: '';
        position: absolute;
        left: 1rem;
        top: 0;
        bottom: 0;
        width: 3px;
        background: linear-gradient(180deg, var(--primary), var(--secondary));
        border-radius: 1.5px;
      }

      .activity-item {
        position: relative;
        margin-bottom: 2rem;
      }

      .activity-marker {
        position: absolute;
        left: -2.25rem;
        top: 0.5rem;
        width: 1rem;
        height: 1rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 50%;
        border: 3px solid var(--surface-elevated);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        z-index: 1;
      }

      .activity-content {
        background: var(--surface-elevated);
        padding: 1.5rem;
        border-radius: var(--radius);
        border: 1px solid rgba(226, 232, 240, 0.6);
        box-shadow: var(--shadow);
        transition: all 0.3s ease;
      }

      .activity-content:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .activity-text {
        font-size: 0.9375rem;
        color: var(--text-primary);
        margin-bottom: 0.5rem;
        line-height: 1.4;
        font-weight: 500;
      }

      .activity-time {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      /* ¹⁷ Tools View Layout - Organized Workspace */
      .tools-view {
        width: 100%;
      }

      .tools-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 2rem;
        align-items: start;
      }

      .tool-section {
        background: var(--surface-elevated);
        border-radius: var(--radius);
        padding: 2rem;
        border: 1px solid rgba(226, 232, 240, 0.6);
        box-shadow: var(--shadow);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        min-height: 250px;
      }

      .tool-section:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .tool-section.full-width {
        grid-column: 1 / -1;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(226, 232, 240, 0.6);
      }

      .section-header .section-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.025em;
      }

      /* ¹⁸ Progress View Layout - Achievement Showcase */
      .progress-view {
        width: 100%;
      }

      .progress-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
        align-items: start;
      }

      .progress-section {
        background: var(--surface-elevated);
        border-radius: var(--radius);
        padding: 2rem;
        border: 1px solid rgba(226, 232, 240, 0.6);
        box-shadow: var(--shadow);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      .progress-section::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, var(--secondary), var(--accent));
        transform: scaleX(0);
        transition: transform 0.3s ease;
        transform-origin: left;
      }

      .progress-section:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .progress-section:hover::before {
        transform: scaleX(1);
      }

      .progress-section .section-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 1.5rem 0;
        letter-spacing: -0.025em;
      }

      /* ¹⁹ Empty States - Encouraging & Actionable */
      .empty-state-small {
        text-align: center;
        padding: 3rem 2rem;
        color: var(--text-tertiary);
        background: rgba(248, 250, 252, 0.5);
        border-radius: var(--radius);
        border: 2px dashed var(--border);
      }

      .empty-state-small p {
        font-size: 0.9375rem;
        margin: 0;
        line-height: 1.5;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem 2rem;
        text-align: center;
        color: var(--text-tertiary);
        background: rgba(248, 250, 252, 0.5);
        border-radius: var(--radius);
        border: 2px dashed var(--border);
      }

      .empty-icon {
        width: 4rem;
        height: 4rem;
        margin-bottom: 1.5rem;
        color: var(--border);
        opacity: 0.6;
      }

      .empty-state p {
        font-size: 1rem;
        max-width: 28rem;
        line-height: 1.6;
        margin: 0;
        font-weight: 500;
      }

      /* ²⁰ Responsive Design - Laptop-Optimized Approach */
      @media (max-width: 1400px) {
        .metrics-grid {
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.25rem;
        }

        .focus-grid {
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 1.25rem;
        }

        .tools-grid {
          grid-template-columns: repeat(auto-fit, minmax(2, 1fr));
          gap: 1.25rem;
        }

        .progress-grid {
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.25rem;
        }
      }

      @media (max-width: 1200px) {
        .metrics-grid {
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
        }

        .focus-grid {
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1rem;
        }

        .tools-grid {
          grid-template-columns: repeat(auto-fit, minmax(2, 1fr));
          gap: 1rem;
        }

        .progress-grid {
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 1rem;
        }
      }

      @media (max-width: 1024px) {
        .hub-content {
          padding: 2rem 1.5rem;
        }

        .header-stats {
          gap: 2rem;
        }

        .metrics-grid {
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 1.5rem;
        }

        .metric-card {
          padding: 1.5rem;
        }

        .focus-grid {
          grid-template-columns: 1fr;
        }

        .tools-grid {
          grid-template-columns: 1fr;
        }

        .progress-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 768px) {
        .hub-header {
          padding: 1.5rem 1rem 0;
        }

        .hub-header::before {
          height: 3px;
        }

        .header-content {
          flex-direction: column;
          gap: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .hub-title {
          font-size: 1.75rem;
          text-align: center;
        }

        .hub-icon {
          width: 2rem;
          height: 2rem;
        }

        .header-stats {
          gap: 1.5rem;
          padding: 1rem;
          width: 100%;
          justify-content: center;
        }

        .tab-navigation {
          overflow-x: auto;
          padding: 0 1rem;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .tab-navigation::-webkit-scrollbar {
          display: none;
        }

        .tab-button {
          white-space: nowrap;
          padding: 0.875rem 1.25rem;
          flex-shrink: 0;
        }

        .hub-content {
          padding: 1.5rem;
        }

        .section-title {
          font-size: 1.25rem;
          margin-bottom: 1.5rem;
        }

        .view-header {
          flex-direction: column;
          gap: 1.5rem;
          align-items: stretch;
        }

        .metrics-grid {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        .focus-grid {
          gap: 1.5rem;
        }

        .focus-card {
          padding: 1.5rem;
        }

        .activity-timeline {
          padding-left: 2rem;
        }

        .activity-timeline::before {
          left: 0.5rem;
          width: 2px;
        }

        .activity-marker {
          left: -1.25rem;
          width: 0.75rem;
          height: 0.75rem;
          border-width: 2px;
        }

        .tool-section,
        .progress-section {
          padding: 1.5rem;
        }
      }

      @media (max-width: 480px) {
        .hub-header {
          padding: 1rem 0.75rem 0;
        }

        .hub-content {
          padding: 1rem;
        }

        .hub-title {
          font-size: 1.5rem;
        }

        .metric-card,
        .focus-card,
        .tool-section,
        .progress-section {
          padding: 1rem;
        }

        .section-title {
          font-size: 1.125rem;
        }

        .tab-button {
          padding: 0.75rem 1rem;
          font-size: 0.8125rem;
        }

        .header-stats {
          gap: 1rem;
          padding: 0.75rem;
        }

        .stat-value {
          font-size: 1.25rem;
        }
      }
    </style>
  </template>
}

class StudyHubEmbedded extends Component<typeof StudyHub> {
  // ³³ Embedded format
  <template>
    <div class='study-hub-embedded'>
      <div class='hub-summary'>
        <div class='hub-header'>
          <h3 class='hub-name'>{{if
              @model.hubName
              @model.hubName
              'Study Hub'
            }}</h3>
          <div class='hub-stats'>
            <div class='stat'>
              <span class='value'>{{@model.currentStreak}}</span>
              <span class='label'>day streak</span>
            </div>
            <div class='stat'>
              <span class='value'>{{if
                  @model.studyResources
                  @model.studyResources.length
                  0
                }}</span>
              <span class='label'>resources</span>
            </div>
          </div>
        </div>

        {{#if (gt @model.studyGoals.length 0)}}
          <div class='recent-goals'>
            <h4>Active Goals</h4>
            <div class='goals-preview'>
              {{#each @model.studyGoals as |goal index|}}
                {{#if (lt index 2)}}
                  <div class='goal-item'>
                    <span class='goal-title'>{{if
                        goal.goalTitle
                        goal.goalTitle
                        (if goal.title goal.title 'Untitled Goal')
                      }}</span>
                    <span class='goal-progress'>{{if
                        goal.progress
                        goal.progress
                        0
                      }}%</span>
                  </div>
                {{/if}}
              {{/each}}
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* ³⁴ Embedded styling */
      .study-hub-embedded {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        padding: 1rem;
        background: white;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        font-size: 0.8125rem;
      }

      .hub-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
      }

      .hub-name {
        font-size: 1rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
      }

      .hub-stats {
        display: flex;
        gap: 1rem;
      }

      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }

      .stat .value {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        line-height: 1;
      }

      .stat .label {
        font-size: 0.625rem;
        color: #6b7280;
        margin-top: 0.125rem;
      }

      .progress-overview {
        margin-bottom: 1rem;
      }

      .progress-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .progress-label {
        font-size: 0.75rem;
        color: #6b7280;
        min-width: 4rem;
      }

      .progress-bar {
        flex: 1;
        height: 6px;
        background: #f3f4f6;
        border-radius: 3px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border-radius: 3px;
        transition: width 0.3s ease;
      }

      .progress-percent {
        font-size: 0.75rem;
        font-weight: 500;
        color: #374151;
        min-width: 2.5rem;
        text-align: right;
      }

      .recent-goals h4 {
        font-size: 0.75rem;
        font-weight: 500;
        color: #6b7280;
        margin: 0 0 0.5rem 0;
      }

      .goals-preview {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .goal-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.375rem 0.5rem;
        background: #f9fafb;
        border-radius: 4px;
      }

      .goal-title {
        font-size: 0.75rem;
        color: #374151;
        font-weight: 500;
      }

      .goal-progress {
        font-size: 0.6875rem;
        color: #3b82f6;
        font-weight: 600;
      }
    </style>
  </template>
}

export class StudyHub extends CardDef {
  static displayName = 'Study Hub';
  static icon = BrainIcon;
  static prefersWideFormat = true;

  @field hubName = contains(StringField); // ¹⁰¹ Hub identification
  @field weeklyGoal = contains(NumberField); // minutes per week

  // ¹⁰² Dynamic relationships to separate card entities (using arrow functions to prevent circular dependencies)
  @field studyResources = linksToMany(() => StudyResource);
  @field studyGoals = linksToMany(() => StudyGoal);
  @field studySessions = linksToMany(() => StudySession);

  // ¹⁰³ Dynamic card relationships for main entities
  @field flashcards = linksToMany(() => FlashcardCard);
  @field studyNotes = linksToMany(() => StudyNoteCard);

  @field practiceQuizzes = linksToMany(() => PracticeQuizCard);
  @field focusTimers = linksToMany(() => FocusTimerCard);

  // ¹⁰⁴ Dynamic dashboard functionality - no manual maintenance needed

  // ¹⁰⁵ New comprehensive feature fields - now dynamic cards
  @field studyCalendar = linksTo(() => CalendarCard); // ¹¹⁹ Dynamic calendar card
  @field annotations = linksToMany(() => AnnotationCard); // ¹²¹ Dynamic annotation cards

  // ²¹ Computed title
  @field title = contains(StringField, {
    computeVia: function (this: StudyHub) {
      try {
        return this.hubName ?? 'My Study Hub';
      } catch (e) {
        console.error('StudyHub: Error computing title', e);
        return 'Study Hub';
      }
    },
  });

  // ¹⁰⁶ Use dynamic progress calculation from component (no duplication)

  @field currentStreak = contains(NumberField, {
    computeVia: function (this: StudyHub) {
      try {
        // ³⁴³ Add loading state protection to prevent accessing undefined during load
        if (!this.studySessions) {
          console.log(
            'StudyHub: StudySessions not yet loaded, returning 0 streak',
          );
          return 0;
        }

        const sessions = this.studySessions;
        if (!Array.isArray(sessions) || sessions.length === 0) return 0;

        // ³²⁵ Enhanced session validation with multiple safety checks
        const validSessions = sessions.filter((session) => {
          try {
            // Check if session exists and is a proper object
            if (!session || typeof session !== 'object') {
              console.warn('StudyHub: Invalid session object for streak', {
                session,
              });
              return false;
            }

            // Check if session has required startTime property
            if (!session.startTime) {
              console.warn('StudyHub: Session missing startTime for streak', {
                session,
              });
              return false;
            }

            // Verify startTime is a valid date
            const testDate = new Date(session.startTime);
            if (isNaN(testDate.getTime())) {
              console.warn(
                'StudyHub: Session has invalid startTime for streak',
                { session, startTime: session.startTime },
              );
              return false;
            }

            return true;
          } catch (e) {
            console.warn('StudyHub: Error validating session for streak', {
              session,
              error: e,
            });
            return false;
          }
        });

        if (validSessions.length === 0) {
          console.info(
            'StudyHub: No valid sessions found for streak calculation',
          );
          return 0;
        }

        // Sort sessions by date with enhanced error handling
        const sortedSessions = [...validSessions].sort((a, b) => {
          try {
            const dateA = new Date(a.startTime).getTime();
            const dateB = new Date(b.startTime).getTime();
            return dateB - dateA; // Most recent first
          } catch (e) {
            console.warn('StudyHub: Error sorting sessions for streak', {
              a,
              b,
              error: e,
            });
            return 0;
          }
        });

        let streak = 0;
        let currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0); // Start of today

        // Check if there's a session today or yesterday (grace period)
        const twoDaysAgo = new Date(
          currentDate.getTime() - 2 * 24 * 60 * 60 * 1000,
        );

        const recentSession = sortedSessions.find((session) => {
          try {
            const sessionDate = new Date(session.startTime);
            sessionDate.setHours(0, 0, 0, 0);
            return sessionDate >= twoDaysAgo;
          } catch (e) {
            console.warn('StudyHub: Error checking recent session for streak', {
              session,
              error: e,
            });
            return false;
          }
        });

        if (!recentSession) {
          console.info(
            'StudyHub: No recent sessions found for streak (within 2 days)',
          );
          return 0;
        }

        // Count consecutive days with sessions
        const sessionDates = new Set();
        sortedSessions.forEach((session) => {
          try {
            const date = new Date(session.startTime);
            date.setHours(0, 0, 0, 0);
            sessionDates.add(date.getTime());
          } catch (e) {
            console.warn('StudyHub: Error processing session date for streak', {
              session,
              error: e,
            });
          }
        });

        let checkDate = new Date(currentDate);
        while (
          sessionDates.has(checkDate.getTime()) ||
          sessionDates.has(checkDate.getTime() - 24 * 60 * 60 * 1000)
        ) {
          if (sessionDates.has(checkDate.getTime())) {
            streak++;
          }
          checkDate.setDate(checkDate.getDate() - 1);
        }

        console.info('StudyHub: Calculated streak successfully', {
          streak,
          validSessionsCount: validSessions.length,
        });
        return Math.max(streak, 0);
      } catch (e) {
        console.error('StudyHub: Critical error calculating study streak', {
          error: e,
        });
        return 0;
      }
    },
  });

  static isolated = StudyHubIsolated;

  static embedded = StudyHubEmbedded;

  static fitted = class Fitted extends Component<typeof StudyHub> {
    // ³⁵ Fitted format

    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='hub-badge'>
            <svg
              class='hub-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44L2 17H1a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1l5.04-2.94A2.5 2.5 0 0 1 9.5 2Z'
              />
            </svg>
            <div class='badge-content'>
              <div class='hub-name'>{{if
                  @model.hubName
                  @model.hubName
                  'Study Hub'
                }}</div>
              <div class='hub-metric'>{{@model.currentStreak}} day streak</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='hub-strip'>
            <div class='strip-header'>
              <svg
                class='hub-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44L2 17H1a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1l5.04-2.94A2.5 2.5 0 0 1 9.5 2Z'
                />
              </svg>
              <div class='strip-title'>{{if
                  @model.hubName
                  @model.hubName
                  'Study Hub'
                }}</div>
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='hub-tile'>
            <div class='tile-header'>
              <h3 class='tile-title'>{{if
                  @model.hubName
                  @model.hubName
                  'Study Hub'
                }}</h3>
              <svg
                class='hub-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44L2 17H1a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1l5.04-2.94A2.5 2.5 0 0 1 9.5 2Z'
                />
              </svg>
            </div>

            <div class='tile-metrics'>
              <div class='metric'>
                <span class='metric-value'>{{@model.currentStreak}}</span>
                <span class='metric-label'>day streak</span>
              </div>
              <div class='metric'>
                <span class='metric-value'>{{if
                    (Number @model.studyResources.length)
                    @model.studyResources.length
                    0
                  }}</span>
                <span class='metric-label'>resources</span>
              </div>
              <div class='metric'>
                <span class='metric-value'>{{if
                    (Number @model.studyGoals.length)
                    @model.studyGoals.length
                    0
                  }}</span>
                <span class='metric-label'>goals</span>
              </div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='hub-card'>
            <div class='card-header'>
              <div class='header-left'>
                <h3 class='card-title'>{{if
                    @model.hubName
                    @model.hubName
                    'Study Hub'
                  }}</h3>
                <div class='card-subtitle'>Personal learning dashboard</div>
              </div>
              <svg
                class='hub-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44L2 17H1a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1l5.04-2.94A2.5 2.5 0 0 1 9.5 2Z'
                />
              </svg>
            </div>

            <div class='card-metrics'>
              <div class='metric-row'>
                <div class='metric'>
                  <span class='metric-value'>{{@model.currentStreak}}</span>
                  <span class='metric-label'>day streak</span>
                </div>
                <div class='metric'>
                  <span class='metric-value'>{{if
                      @model.studyResources
                      (Number @model.studyResources.length)
                      0
                    }}</span>
                  <span class='metric-label'>resources</span>
                </div>
                <div class='metric'>
                  <span class='metric-value'>{{if
                      @model.studyGoals
                      @model.studyGoals.length
                      0
                    }}</span>
                  <span class='metric-label'>goals</span>
                </div>
              </div>
            </div>

            {{#if (gt @model.studyGoals.length 0)}}
              <div class='card-goals'>
                <div class='goals-title'>Recent Goals</div>
                <div class='goals-list'>
                  {{#each @model.studyGoals as |goal index|}}
                    {{#if (lt index 2)}}
                      <div class='goal-item'>
                        <span class='goal-name'>{{if
                            goal.goalTitle
                            goal.goalTitle
                            (if goal.title goal.title 'Untitled Goal')
                          }}</span>
                        <span class='goal-progress'>{{if
                            goal.progress
                            goal.progress
                            0
                          }}%</span>
                      </div>
                    {{/if}}
                  {{/each}}
                </div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        /* ³⁶ Fitted styling */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
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

        .hub-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          color: white;
          border-radius: 6px;
          padding: 0.5rem;
          box-sizing: border-box;
        }

        .hub-badge .hub-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }

        .badge-content {
          flex: 1;
          min-width: 0;
        }

        .hub-name {
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
          margin-bottom: 0.125rem;
        }

        .hub-metric {
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

        .hub-strip {
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

        .strip-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .strip-header .hub-icon {
          width: 1rem;
          height: 1rem;
          color: #3b82f6;
        }

        .strip-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #1f2937;
        }

        .strip-stats {
          display: flex;
          gap: 0.75rem;
          font-size: 0.6875rem;
          color: #6b7280;
          font-weight: 500;
        }

        /* Tile Format (≤399px width, ≥170px height) */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        .hub-tile {
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
          color: #1f2937;
          margin: 0;
          line-height: 1.2;
        }

        .tile-header .hub-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #3b82f6;
        }

        .tile-metrics {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }

        .metric {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .metric-value {
          font-size: 1rem;
          font-weight: 700;
          color: #1f2937;
          line-height: 1;
        }

        .metric-label {
          font-size: 0.625rem;
          color: #6b7280;
          margin-top: 0.125rem;
        }

        .tile-progress {
          margin-top: auto;
        }

        .progress-label {
          font-size: 0.6875rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: #f3f4f6;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 0.25rem;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .progress-text {
          font-size: 0.6875rem;
          color: #374151;
          font-weight: 500;
          text-align: center;
        }

        /* Card Format (≥400px width, ≥170px height) */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .hub-card {
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

        .card-title {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
          line-height: 1.2;
        }

        .card-subtitle {
          font-size: 0.75rem;
          color: #6b7280;
          margin-top: 0.125rem;
        }

        .card-header .hub-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: #3b82f6;
        }

        .card-metrics {
          margin-bottom: 1rem;
        }

        .metric-row {
          display: flex;
          justify-content: space-around;
        }

        .card-metrics .metric {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .card-metrics .metric-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: #1f2937;
          line-height: 1;
        }

        .card-metrics .metric-label {
          font-size: 0.6875rem;
          color: #6b7280;
          margin-top: 0.25rem;
        }

        .card-progress {
          margin-bottom: 1rem;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.375rem;
        }

        .progress-title {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
        }

        .progress-percent {
          font-size: 0.75rem;
          color: #374151;
          font-weight: 600;
        }

        .card-goals {
          margin-top: auto;
        }

        .goals-title {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
          margin-bottom: 0.5rem;
        }

        .goals-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .goal-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.25rem 0.5rem;
          background: #f9fafb;
          border-radius: 4px;
        }

        .goal-name {
          font-size: 0.6875rem;
          color: #374151;
          font-weight: 500;
        }

        .goal-progress {
          font-size: 0.6875rem;
          color: #3b82f6;
          font-weight: 600;
        }
      </style>
    </template>
  };
}
