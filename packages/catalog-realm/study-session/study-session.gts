// ═══ [EDIT TRACKING: ON] Mark all changes with ¹ ═══
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
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Button, Pill } from '@cardstack/boxel-ui/components'; // ² Enhanced UI components
import {
  formatDateTime,
  formatDuration,
  eq,
  gt,
  and,
  subtract,
  multiply,
} from '@cardstack/boxel-ui/helpers'; // ³ Enhanced helpers
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import BookOpenIcon from '@cardstack/boxel-icons/book-open'; // ⁴ Enhanced icon import

class StudySessionIsolated extends Component<typeof StudySession> {
  // ¹¹ Enhanced isolated format with Study Hub theming
  @tracked showEditMode = false;

  // ¹² Smart getters for session analysis
  get sessionDuration() {
    try {
      if (this.args?.model?.startTime && this.args?.model?.endTime) {
        const start = new Date(this.args.model.startTime);
        const end = new Date(this.args.model.endTime);
        const diffMs = end.getTime() - start.getTime();
        return Math.round(diffMs / (1000 * 60)); // Convert to minutes
      }
      return (
        this.args?.model?.actualDuration ||
        this.args?.model?.plannedDuration ||
        0
      );
    } catch (e) {
      console.error('StudySession: Error computing session duration', e);
      return 0;
    }
  }

  get sessionAnalysis() {
    try {
      const planned = this.args?.model?.plannedDuration || 0;
      const actual = this.sessionDuration;

      if (planned === 0)
        return {
          status: 'completed',
          message: 'Session completed successfully',
        };

      const difference = actual - planned;
      const percentDiff = (Math.abs(difference) / planned) * 100;

      if (percentDiff <= 10) {
        return {
          status: 'excellent',
          message: 'Perfect timing! Right on target.',
        };
      } else if (difference > 0 && percentDiff <= 25) {
        return {
          status: 'extended',
          message: 'Went over time but stayed focused.',
        };
      } else if (difference < 0 && percentDiff <= 25) {
        return {
          status: 'efficient',
          message: 'Finished ahead of schedule.',
        };
      } else {
        return {
          status: 'adjusted',
          message: 'Session adapted to your needs.',
        };
      }
    } catch (e) {
      console.error('StudySession: Error computing session analysis', e);
      return { status: 'completed', message: 'Session completed' };
    }
  }

  get timeOfDay() {
    try {
      if (!this.args?.model?.startTime) return 'Unknown time';
      const start = new Date(this.args.model.startTime);
      const hour = start.getHours();

      if (hour < 6) return 'Late night';
      if (hour < 12) return 'Morning';
      if (hour < 17) return 'Afternoon';
      if (hour < 21) return 'Evening';
      return 'Night';
    } catch (e) {
      console.error('StudySession: Error computing time of day', e);
      return 'Unknown time';
    }
  }

  @action
  toggleEditMode() {
    this.showEditMode = !this.showEditMode;
  }

  <template>
    <div class='session-view'>
      <div class='session-container'>
        <header class='session-header'>
          <div class='header-content'>
            <div class='title-section'>
              <h1 class='session-title'>{{if
                  @model.sessionTitle
                  @model.sessionTitle
                  'Study Session'
                }}</h1>
              <div class='session-context'>
                {{#if @model.subject}}
                  <span class='subject-tag'>{{@model.subject}}</span>
                {{/if}}
                <span class='time-context'>{{this.timeOfDay}} session</span>
              </div>
            </div>

            <div class='header-badges'>
              {{#if @model.isCompleted}}
                <Pill class='status-badge completed'>
                  <svg
                    class='badge-icon'
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
                  Completed
                </Pill>
              {{else}}
                <Pill class='status-badge in-progress'>
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
                  In Progress
                </Pill>
              {{/if}}

              <Pill
                class='effectiveness-badge effectiveness-{{this.sessionAnalysis.status}}'
              >
                {{@model.effectiveness}}% effective
              </Pill>
            </div>
          </div>
        </header>

        <section class='session-metrics'>
          <h2 class='metrics-title'>Session Overview</h2>

          <div class='metrics-grid'>
            <div class='metric-card duration-card'>
              <div class='metric-header'>
                <div class='metric-icon duration-icon'>
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
                <div class='metric-info'>
                  <h3 class='metric-title'>Duration</h3>
                  <p class='metric-subtitle'>Actual study time</p>
                </div>
              </div>
              <div class='metric-value'>
                {{formatDuration
                  (multiply this.sessionDuration 60)
                  unit='seconds'
                  format='humanize'
                }}
              </div>
              {{#if (gt (Number @model.plannedDuration) 0)}}
                <div class='metric-comparison'>
                  {{#if (eq this.sessionDuration @model.plannedDuration)}}
                    <span class='comparison-perfect'>Exactly as planned</span>
                  {{else if (gt this.sessionDuration @model.plannedDuration)}}
                    <span class='comparison-over'>{{subtract
                        this.sessionDuration
                        (Number @model.plannedDuration)
                      }}m over planned</span>
                  {{else}}
                    <span class='comparison-under'>{{subtract
                        (Number @model.plannedDuration)
                        this.sessionDuration
                      }}m under planned</span>
                  {{/if}}
                </div>
              {{/if}}
            </div>

            <div class='metric-card effectiveness-card'>
              <div class='metric-header'>
                <div class='metric-icon effectiveness-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <path d='M8 12l2 2 4-4' />
                  </svg>
                </div>
                <div class='metric-info'>
                  <h3 class='metric-title'>Effectiveness</h3>
                  <p class='metric-subtitle'>Session quality</p>
                </div>
              </div>
              <div class='metric-value'>{{@model.effectiveness}}%</div>
              <div class='effectiveness-analysis'>
                <div
                  class='analysis-badge analysis-{{this.sessionAnalysis.status}}'
                >
                  {{this.sessionAnalysis.message}}
                </div>
              </div>
            </div>

            <div class='metric-card timing-card'>
              <div class='metric-header'>
                <div class='metric-icon timing-icon'>
                  <svg
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
                </div>
                <div class='metric-info'>
                  <h3 class='metric-title'>Session Time</h3>
                  <p class='metric-subtitle'>When you studied</p>
                </div>
              </div>
              {{#if @model.startTime}}
                <div class='timing-details'>
                  <div class='timing-row'>
                    <span class='timing-label'>Started:</span>
                    <span class='timing-value'>{{formatDateTime
                        @model.startTime
                        size='medium'
                      }}</span>
                  </div>
                  {{#if @model.endTime}}
                    <div class='timing-row'>
                      <span class='timing-label'>Finished:</span>
                      <span class='timing-value'>{{formatDateTime
                          @model.endTime
                          size='medium'
                        }}</span>
                    </div>
                  {{/if}}
                </div>
              {{else}}
                <div class='metric-value'>Time not recorded</div>
              {{/if}}
            </div>
          </div>
        </section>

        {{#if @model.notes}}
          <section class='notes-section'>
            <div class='notes-header'>
              <h2 class='notes-title'>
                <svg
                  class='notes-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                  />
                  <polyline points='14,2 14,8 20,8' />
                  <line x1='16' y1='13' x2='8' y2='13' />
                  <line x1='16' y1='17' x2='8' y2='17' />
                  <polyline points='10,9 9,9 8,9' />
                </svg>
                Session Notes
              </h2>
              <div class='notes-meta'>
                {{#if (gt @model.notes.length 100)}}
                  <span class='note-length'>{{@model.notes.length}}
                    characters</span>
                {{/if}}
              </div>
            </div>

            <div class='notes-content'>
              <@fields.notes />
            </div>
          </section>
        {{else}}
          <section class='notes-section'>
            <div class='empty-notes'>
              <div class='empty-icon'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                  />
                  <polyline points='14,2 14,8 20,8' />
                  <line x1='16' y1='13' x2='8' y2='13' />
                  <line x1='16' y1='17' x2='8' y2='17' />
                  <polyline points='10,9 9,9 8,9' />
                </svg>
              </div>
              <h3>No session notes</h3>
              <p>Add notes to track what you learned, challenges faced, or key
                insights from this session.</p>
              <Button class='add-notes-btn' {{on 'click' this.toggleEditMode}}>
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='12' y1='5' x2='12' y2='19' />
                  <line x1='5' y1='12' x2='19' y2='12' />
                </svg>
                Add Notes
              </Button>
            </div>
          </section>
        {{/if}}

        <section class='insights-section'>
          <h2 class='insights-title'>
            <svg
              class='insights-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'
              />
            </svg>
            Session Insights
          </h2>

          <div class='insights-grid'>
            <div class='insight-card productivity-insight'>
              <div class='insight-header'>
                <h4>Productivity Analysis</h4>
                <div
                  class='productivity-score score-{{this.sessionAnalysis.status}}'
                >
                  {{this.sessionAnalysis.status}}
                </div>
              </div>
              <p
                class='insight-description'
              >{{this.sessionAnalysis.message}}</p>

              {{#if (and @model.plannedDuration @model.actualDuration)}}
                <div class='timing-breakdown'>
                  <div class='timing-item'>
                    <span class='timing-label'>Planned:</span>
                    <span class='timing-value'>{{formatDuration
                        (multiply (Number @model.plannedDuration) 60)
                        unit='seconds'
                        format='humanize'
                      }}</span>
                  </div>
                  <div class='timing-item'>
                    <span class='timing-label'>Actual:</span>
                    <span class='timing-value'>{{formatDuration
                        (multiply (Number @model.actualDuration) 60)
                        unit='seconds'
                        format='humanize'
                      }}</span>
                  </div>
                </div>
              {{/if}}
            </div>

            {{#if (and @model.startTime @model.endTime)}}
              <div class='insight-card schedule-insight'>
                <div class='insight-header'>
                  <h4>Schedule Impact</h4>
                  <div class='time-badge'>{{this.timeOfDay}}</div>
                </div>
                <div class='schedule-details'>
                  <div class='schedule-row'>
                    <svg
                      class='schedule-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <polygon points='5,3 19,12 5,21' />
                    </svg>
                    <span>Started at
                      {{formatDateTime @model.startTime size='short'}}</span>
                  </div>
                  <div class='schedule-row'>
                    <svg
                      class='schedule-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                    </svg>
                    <span>Finished at
                      {{formatDateTime @model.endTime size='short'}}</span>
                  </div>
                </div>
              </div>
            {{/if}}
          </div>
        </section>
      </div>
    </div>

    <style scoped>
      /* ¹⁷ Enhanced Study Session styling with Study Hub theme */
      .session-view {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
        width: 100%;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 1rem;
        background: #f8fafc; /* Study Hub surface */
        overflow-y: auto; /* CRITICAL: Enable scrolling */
        box-sizing: border-box;

        /* Study Hub Design Tokens */
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

      .session-container {
        max-width: 42rem;
        width: 100%;
        background: var(--surface-elevated);
        border-radius: var(--radius);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-lg);
        padding: 2.5rem;
        margin: 0 auto 2rem auto;
        flex-shrink: 0;
        min-height: fit-content;
        position: relative;
      }

      .session-container::before {
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

      /* ¹⁸ Enhanced header with Study Hub styling */
      .session-header {
        margin-bottom: 2.5rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid rgba(226, 232, 240, 0.6);
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 2rem;
      }

      .title-section {
        flex: 1;
      }

      .session-title {
        font-size: 2rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 0.75rem 0;
        line-height: 1.2;
        letter-spacing: -0.025em;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .session-context {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
      }

      .subject-tag {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--primary);
        background: rgba(30, 58, 138, 0.1);
        padding: 0.375rem 0.75rem;
        border-radius: var(--radius-xs);
        border: 1px solid rgba(30, 58, 138, 0.2);
      }

      .time-context {
        font-size: 0.875rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .header-badges {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: flex-end;
      }

      .status-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        padding: 0.5rem 1rem;
      }

      .status-badge.completed {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
      }

      .status-badge.in-progress {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .effectiveness-badge {
        font-weight: 600;
        padding: 0.375rem 0.75rem;
      }

      .effectiveness-badge.effectiveness-excellent {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
      }

      .effectiveness-badge.effectiveness-extended,
      .effectiveness-badge.effectiveness-efficient {
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        border: 1px solid rgba(30, 58, 138, 0.2);
      }

      .effectiveness-badge.effectiveness-adjusted {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .badge-icon {
        width: 1rem;
        height: 1rem;
      }

      /* ¹⁹ Enhanced metrics section with Study Hub design language */
      .session-metrics {
        margin-bottom: 2.5rem;
      }

      .metrics-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 1.5rem 0;
        letter-spacing: -0.025em;
        position: relative;
        padding-left: 1rem;
      }

      .metrics-title::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: linear-gradient(180deg, var(--primary), var(--secondary));
        border-radius: 2px;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
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
        width: 2.5rem;
        height: 2.5rem;
        background: rgba(30, 58, 138, 0.1);
        border-radius: var(--radius-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .metric-icon svg {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary);
      }

      .metric-info {
        flex: 1;
      }

      .metric-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.25rem 0;
        letter-spacing: -0.025em;
      }

      .metric-subtitle {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
        font-weight: 500;
      }

      .metric-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 2rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
        margin-bottom: 1rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .metric-comparison {
        font-size: 0.8125rem;
        font-weight: 500;
        padding: 0.5rem 0.75rem;
        border-radius: var(--radius-xs);
      }

      .comparison-perfect {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
        border: 1px solid rgba(5, 150, 105, 0.2);
      }

      .comparison-over {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .comparison-under {
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        border: 1px solid rgba(30, 58, 138, 0.2);
      }

      .effectiveness-analysis {
        margin-top: 1rem;
      }

      .analysis-badge {
        font-size: 0.8125rem;
        font-weight: 500;
        padding: 0.75rem 1rem;
        border-radius: var(--radius-sm);
        line-height: 1.4;
      }

      .analysis-badge.analysis-excellent {
        background: rgba(5, 150, 105, 0.1);
        color: #065f46;
        border: 1px solid rgba(5, 150, 105, 0.2);
      }

      .analysis-badge.analysis-extended,
      .analysis-badge.analysis-efficient {
        background: rgba(30, 58, 138, 0.1);
        color: #1e40af;
        border: 1px solid rgba(30, 58, 138, 0.2);
      }

      .analysis-badge.analysis-adjusted {
        background: rgba(245, 158, 11, 0.1);
        color: #d97706;
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .timing-breakdown {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 1rem;
      }

      .timing-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.75rem;
        background: rgba(248, 250, 252, 0.8);
        border-radius: var(--radius-xs);
      }

      .timing-label {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        font-weight: 500;
      }

      .timing-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--text-primary);
      }

      .timing-details {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .timing-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .schedule-icon {
        width: 1rem;
        height: 1rem;
        color: var(--primary);
        flex-shrink: 0;
      }

      .productivity-score {
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-xs);
        text-transform: capitalize;
      }

      .score-excellent {
        background: rgba(5, 150, 105, 0.1);
        color: var(--secondary);
      }

      .score-extended,
      .score-efficient {
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
      }

      .score-adjusted {
        background: rgba(245, 158, 11, 0.1);
        color: var(--accent);
      }

      .time-badge {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--text-tertiary);
        background: rgba(107, 114, 128, 0.1);
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-xs);
      }

      /* ²⁰ Enhanced notes section with Study Hub design */
      .notes-section {
        margin-bottom: 2.5rem;
      }

      .notes-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }

      .notes-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.025em;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .notes-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary);
        padding: 0.5rem;
        background: rgba(30, 58, 138, 0.1);
        border-radius: var(--radius-xs);
      }

      .notes-meta {
        display: flex;
        gap: 1rem;
        align-items: center;
      }

      .note-length {
        font-size: 0.75rem;
        color: var(--text-tertiary);
        font-weight: 500;
        background: rgba(248, 250, 252, 0.8);
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-xs);
      }

      .notes-content {
        background: var(--surface-elevated);
        border: 1px solid rgba(226, 232, 240, 0.6);
        border-radius: var(--radius);
        padding: 2rem;
        box-shadow: var(--shadow);
        position: relative;
      }

      .notes-content::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background: linear-gradient(180deg, var(--primary), var(--secondary));
        border-radius: 2px 0 0 2px;
      }

      .empty-notes {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem 2rem;
        text-align: center;
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

      .empty-notes h3 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.5rem 0;
      }

      .empty-notes p {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0 0 2rem 0;
        line-height: 1.5;
        max-width: 24rem;
      }

      .add-notes-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
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
      }

      .add-notes-btn:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .btn-icon {
        width: 1rem;
        height: 1rem;
      }

      /* ²¹ Enhanced insights section with analytics style */
      .insights-section {
        margin-bottom: 2rem;
      }

      .insights-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 1.5rem 0;
        letter-spacing: -0.025em;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .insights-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary);
        padding: 0.5rem;
        background: rgba(30, 58, 138, 0.1);
        border-radius: var(--radius-xs);
      }

      .insights-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
      }

      .insight-card {
        background: var(--surface-elevated);
        border-radius: var(--radius);
        padding: 2rem;
        border: 1px solid rgba(226, 232, 240, 0.6);
        box-shadow: var(--shadow);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
      }

      .insight-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .insight-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .insight-header h4 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.025em;
      }

      .insight-description {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        margin: 0 0 1rem 0;
        line-height: 1.5;
        font-weight: 500;
      }

      /* ²² Responsive design for mobile */
      @media (max-width: 768px) {
        .session-view {
          padding: 0.75rem;
        }

        .session-container {
          padding: 1.5rem;
          margin-bottom: 1rem;
        }

        .session-title {
          font-size: 1.5rem;
        }

        .header-content {
          flex-direction: column;
          gap: 1rem;
        }

        .header-badges {
          align-items: flex-start;
          flex-direction: row;
          flex-wrap: wrap;
        }

        .metrics-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .metric-card {
          padding: 1.5rem;
        }

        .insights-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }
      }

      @media (max-width: 480px) {
        .session-container {
          padding: 1rem;
        }

        .session-title {
          font-size: 1.25rem;
        }

        .metric-card,
        .insight-card {
          padding: 1rem;
        }
      }
    </style>
  </template>
}

export class StudySession extends CardDef {
  static displayName = 'Study Session';
  static icon = BookOpenIcon; // ⁵ Better icon for study sessions
  static prefersWideFormat = false; // ⁶ Optimized for vertical layouts

  // ⁷ Core session fields
  @field sessionTitle = contains(StringField);
  @field subject = contains(StringField);
  @field startTime = contains(DatetimeField);
  @field endTime = contains(DatetimeField);
  @field plannedDuration = contains(NumberField); // minutes
  @field actualDuration = contains(NumberField); // minutes
  @field notes = contains(MarkdownField);
  @field isCompleted = contains(BooleanField);

  // ⁸ Computed title with subject context
  @field title = contains(StringField, {
    computeVia: function (this: StudySession) {
      try {
        const session = this.sessionTitle || 'Study Session';
        const subject = this.subject ? ` - ${this.subject}` : '';
        return `${session}${subject}`;
      } catch (e) {
        console.error('StudySession: Error computing title', e);
        return 'Study Session';
      }
    },
  });
  // ⁹ Enhanced computed duration
  @field duration = contains(NumberField, {
    computeVia: function (this: StudySession) {
      try {
        return this.actualDuration || this.plannedDuration || 0;
      } catch (e) {
        console.error('StudySession: Error computing duration', e);
        return 0;
      }
    },
  });

  // ¹⁰ Session effectiveness computed field
  @field effectiveness = contains(NumberField, {
    computeVia: function (this: StudySession) {
      try {
        const planned = this.plannedDuration || 0;
        const actual = this.actualDuration || 0;
        if (planned === 0) return 100;

        // Calculate efficiency: closer to planned time = higher effectiveness
        const difference = Math.abs(actual - planned);
        const efficiency = Math.max(0, 100 - (difference / planned) * 100);
        return Math.round(efficiency);
      } catch (e) {
        console.error('StudySession: Error computing effectiveness', e);
        return 100;
      }
    },
  });

  static isolated = StudySessionIsolated;

  static embedded = class Embedded extends Component<typeof StudySession> {
    // ²³ Enhanced embedded format with Study Hub design
    <template>
      <div class='session-embedded'>
        <div class='session-header'>
          <div class='header-content'>
            <h4 class='session-title'>{{if
                @model.sessionTitle
                @model.sessionTitle
                'Study Session'
              }}</h4>
            {{#if @model.subject}}
              <p class='session-subject'>{{@model.subject}}</p>
            {{/if}}
          </div>
          <div class='session-badges'>
            {{#if @model.isCompleted}}
              <Pill class='status-badge completed'>
                <svg
                  class='badge-icon'
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
                Done
              </Pill>
            {{else}}
              <Pill class='status-badge in-progress'>
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
                Active
              </Pill>
            {{/if}}
          </div>
        </div>

        <div class='session-metrics'>
          <div class='metrics-row'>
            {{#if @model.startTime}}
              <div class='metric-item'>
                <div class='metric-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polygon points='5,3 19,12 5,21' />
                  </svg>
                </div>
                <div class='metric-content'>
                  <span class='metric-label'>Started</span>
                  <span class='metric-value'>{{formatDateTime
                      @model.startTime
                      size='short'
                    }}</span>
                </div>
              </div>
            {{/if}}

            {{#if @model.duration}}
              <div class='metric-item'>
                <div class='metric-icon'>
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
                <div class='metric-content'>
                  <span class='metric-label'>Duration</span>
                  <span class='metric-value'>{{formatDuration
                      (multiply @model.duration 60)
                      unit='seconds'
                      format='short'
                    }}</span>
                </div>
              </div>
            {{/if}}

            {{#if @model.effectiveness}}
              <div class='metric-item'>
                <div class='metric-icon'>
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
                <div class='metric-content'>
                  <span class='metric-label'>Effectiveness</span>
                  <span class='metric-value'>{{@model.effectiveness}}%</span>
                </div>
              </div>
            {{/if}}
          </div>
        </div>

        {{#if @model.notes}}
          <div class='session-notes-preview'>
            <div class='notes-indicator'>
              <svg
                class='notes-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14,2 14,8 20,8' />
                <line x1='16' y1='13' x2='8' y2='13' />
                <line x1='16' y1='17' x2='8' y2='17' />
              </svg>
              <span>Session notes available</span>
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ²⁴ Enhanced embedded styling with Study Hub theme */
        .session-embedded {
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

        .session-embedded::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary), var(--secondary));
          border-radius: 8px 8px 0 0;
        }

        .session-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
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

        .session-badges {
          flex-shrink: 0;
        }

        .badge-icon {
          width: 0.75rem;
          height: 0.75rem;
          margin-right: 0.25rem;
        }

        .status-badge {
          display: flex;
          align-items: center;
          font-size: 0.6875rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
        }

        .status-badge.completed {
          background: rgba(5, 150, 105, 0.1);
          color: var(--secondary);
          border: 1px solid rgba(5, 150, 105, 0.2);
        }

        .status-badge.in-progress {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent);
          border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .session-metrics {
          margin-bottom: 1rem;
        }

        .metrics-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
        }

        .metric-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
          min-width: 0;
        }

        .metric-icon {
          flex-shrink: 0;
          width: 1.5rem;
          height: 1.5rem;
          background: rgba(30, 58, 138, 0.1);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .metric-icon svg {
          width: 0.875rem;
          height: 0.875rem;
          color: var(--primary);
        }

        .metric-content {
          flex: 1;
          min-width: 0;
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

        .session-notes-preview {
          padding-top: 0.75rem;
          border-top: 1px solid rgba(226, 232, 240, 0.6);
        }

        .notes-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .notes-icon {
          width: 0.875rem;
          height: 0.875rem;
          color: var(--primary);
        }
      </style>
    </template>
  };
}
