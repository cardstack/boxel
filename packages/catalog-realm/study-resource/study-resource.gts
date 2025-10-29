// ═══ [EDIT TRACKING: ON] Mark all changes with ¹ ═══
import {
  CardDef,
  field,
  contains,
  Component,
  containsMany,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import UrlField from 'https://cardstack.com/base/url';
import {
  formatDateTime,
  formatDuration,
  gt,
  eq,
  lt,
  subtract,
} from '@cardstack/boxel-ui/helpers'; // ³ Helpers
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import BookOpenIcon from '@cardstack/boxel-icons/book-open'; // ⁴ Icon import

class StudyResourceIsolated extends Component<typeof StudyResource> {
  // ⁸ Clean, focus-first isolated format
  @tracked showNotes = false;

  @action
  async openResource() {
    if (this.args.model?.url) {
      window.open(this.args.model.url, '_blank', 'noopener,noreferrer');
      await this.updateLastAccessed();
    }
  }

  @action
  async updateLastAccessed() {
    if (this.args.model) {
      try {
        this.args.model.lastAccessed = new Date();
      } catch (e) {
        console.error('StudyResource: Error updating last accessed time', e);
      }
    }
  }

  @action
  toggleNotes() {
    this.showNotes = !this.showNotes;
  }
  <template>
    <div class='study-resource-clean'>
      <header class='resource-header'>
        {{#if @model.subject}}
          <div class='subject-badge'>
            {{@model.subject}}
            {{#if @model.difficulty}}
              •
              {{@model.difficulty}}
            {{/if}}
          </div>
        {{/if}}

        <h1 class='resource-title'>{{if
            @model.resourceTitle
            @model.resourceTitle
            'Untitled Resource'
          }}</h1>

        <div class='resource-type'>
          {{if @model.resourceType @model.resourceType 'Study Material'}}
        </div>
      </header>

      <div class='resource-stage'>
        <div class='resource-card'>

          <div class='quick-stats'>
            {{#if @model.estimatedTime}}
              <div class='stat-item'>
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
                {{formatDuration
                  @model.estimatedTime
                  unit='minutes'
                  format='humanize'
                }}
              </div>
            {{/if}}

            {{#if @model.completionStatus}}
              <div class='stat-item status-{{@model.completionStatus}}'>
                <svg
                  class='stat-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  {{#if (eq @model.completionStatus 'completed')}}
                    <path d='M20 6L9 17l-5-5' />
                  {{else if (eq @model.completionStatus 'in_progress')}}
                    <circle cx='12' cy='12' r='10' />
                    <polyline points='12,6 12,12 16,14' />
                  {{else}}
                    <circle cx='12' cy='12' r='10' />
                  {{/if}}
                </svg>
                {{#if (eq @model.completionStatus 'in_progress')}}
                  In Progress
                {{else if (eq @model.completionStatus 'not_started')}}
                  Not Started
                {{else if (eq @model.completionStatus 'completed')}}
                  Completed
                {{else}}
                  {{@model.completionStatus}}
                {{/if}}
              </div>
            {{/if}}

          </div>

          {{#if @model.progressPercentage}}
            <div class='progress-section'>
              <div class='progress-header'>
                <span class='progress-label'>Study Progress</span>
                <span
                  class='progress-percent'
                >{{@model.progressPercentage}}%</span>
              </div>
              <div class='progress-bar'>
                <div
                  class='progress-fill'
                  style={{htmlSafe
                    (concat 'width: ' @model.progressPercentage '%;')
                  }}
                ></div>
              </div>
            </div>
          {{/if}}

          {{#if @model.url}}
            <div class='primary-action'>
              <button class='access-button' {{on 'click' this.openResource}}>
                <svg
                  class='button-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'
                  />
                  <path
                    d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
                  />
                </svg>
                Start Studying
              </button>
            </div>
          {{/if}}
        </div>
      </div>

      {{#if @model.notes}}
        <div class='notes-section'>
          <button class='notes-toggle' {{on 'click' this.toggleNotes}}>
            <svg
              class='toggle-icon'
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
              <line x1='10' y1='9' x2='8' y2='9' />
            </svg>
            {{if this.showNotes 'Hide Notes' 'Show Notes'}}
          </button>

          {{#if this.showNotes}}
            <div class='notes-content'>
              <@fields.notes />
            </div>
          {{/if}}
        </div>
      {{/if}}

      {{#if (gt @model.tags.length 0)}}
        <div class='tags-footer'>
          {{#each @model.tags as |tag|}}
            <span class='tag'>{{tag}}</span>
          {{/each}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .study-resource-clean {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        max-width: 42rem;
        margin: 0 auto;
        padding: 2rem;
        height: 100%;
        overflow-y: auto;
        background: #f8fafc;

        --primary: #1e3a8a;
        --secondary: #059669;
        --accent: #f59e0b;
        --surface: #ffffff;
        --text-primary: #1f2937;
        --text-secondary: #6b7280;
        --border: #e5e7eb;
        --radius: 12px;
      }

      .resource-header {
        text-align: center;
        margin-bottom: 2.5rem;
      }

      .subject-badge {
        display: inline-block;
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        margin-bottom: 1rem;
      }

      .resource-title {
        font-size: 2rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 0.75rem 0;
        line-height: 1.2;
        letter-spacing: -0.025em;
      }

      .resource-type {
        font-size: 1rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      /* Resource stage - main focus */
      .resource-stage {
        margin-bottom: 2rem;
      }

      .resource-card {
        background: var(--surface);
        border-radius: var(--radius);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--border);
        padding: 2rem;
        transition: transform 0.2s ease;
      }

      .resource-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.1);
      }

      /* Quick stats row */
      .quick-stats {
        display: flex;
        gap: 1.5rem;
        margin-bottom: 2rem;
        flex-wrap: wrap;
        justify-content: center;
      }

      .stat-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .stat-icon {
        width: 1.125rem;
        height: 1.125rem;
        opacity: 0.8;
      }

      .status-completed {
        color: var(--secondary);
      }

      .status-in_progress {
        color: var(--accent);
      }

      .status-not_started {
        color: var(--text-secondary);
      }

      /* Progress section */
      .progress-section {
        margin-bottom: 2rem;
      }

      .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .progress-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-secondary);
      }

      .progress-percent {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--primary);
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
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        border-radius: 4px;
        transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
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

      /* Primary action button */
      .primary-action {
        text-align: center;
      }

      .access-button {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        background: linear-gradient(135deg, var(--primary), #2563eb);
        color: white;
        border: none;
        padding: 1rem 2rem;
        border-radius: var(--radius);
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 4px 14px 0 rgba(30, 58, 138, 0.3);
        position: relative;
        overflow: hidden;
      }

      .access-button::before {
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

      .access-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px -8px rgba(30, 58, 138, 0.5);
      }

      .access-button:hover::before {
        left: 100%;
      }

      .button-icon {
        width: 1.25rem;
        height: 1.25rem;
        transition: transform 0.3s ease;
      }

      .access-button:hover .button-icon {
        transform: scale(1.1);
      }

      /* Notes section */
      .notes-section {
        margin-bottom: 2rem;
      }

      .notes-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: rgba(59, 130, 246, 0.1);
        color: var(--primary);
        border: 1px solid rgba(59, 130, 246, 0.2);
        padding: 0.75rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 100%;
        justify-content: center;
      }

      .notes-toggle:hover {
        background: rgba(59, 130, 246, 0.15);
        border-color: rgba(59, 130, 246, 0.3);
      }

      .toggle-icon {
        width: 1rem;
        height: 1rem;
      }

      .notes-content {
        margin-top: 1rem;
        padding: 1.5rem;
        background: var(--surface);
        border-radius: 8px;
        border: 1px solid var(--border);
        font-size: 0.9375rem;
        line-height: 1.6;
      }

      /* Tags footer */
      .tags-footer {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: center;
        padding-top: 1.5rem;
        border-top: 1px solid rgba(226, 232, 240, 0.6);
      }

      .tag {
        background: rgba(148, 163, 184, 0.1);
        color: var(--text-secondary);
        padding: 0.375rem 0.75rem;
        border-radius: 1rem;
        font-size: 0.75rem;
        font-weight: 500;
        transition: all 0.2s ease;
      }

      .tag:hover {
        background: rgba(148, 163, 184, 0.2);
        transform: translateY(-1px);
      }

      /* Mobile responsive */
      @media (max-width: 768px) {
        .study-resource-clean {
          padding: 1rem;
        }

        .resource-title {
          font-size: 1.5rem;
        }

        .resource-card {
          padding: 1.5rem;
        }

        .quick-stats {
          gap: 1rem;
          justify-content: center;
        }

        .access-button {
          padding: 0.875rem 1.5rem;
          font-size: 0.9375rem;
        }
      }
    </style>
  </template>
}

export class StudyResource extends CardDef {
  // ⁵ Study Resource card
  static displayName = 'Study Resource';
  static icon = BookOpenIcon;

  @field resourceTitle = contains(StringField); // ⁶ Primary fields
  @field resourceType = contains(StringField); // lecture, textbook, article, video, assignment, notes
  @field url = contains(UrlField);
  @field subject = contains(StringField);
  @field difficulty = contains(StringField); // beginner, intermediate, advanced
  @field estimatedTime = contains(NumberField); // minutes
  @field completionStatus = contains(StringField); // not_started, in_progress, completed
  @field tags = containsMany(StringField); // ²²² Individual tag fields
  @field notes = contains(MarkdownField);
  @field lastAccessed = contains(DatetimeField);
  @field progressPercentage = contains(NumberField); // ²²³ 0-100 completion percentage

  // ⁷ Computed title
  @field title = contains(StringField, {
    computeVia: function (this: StudyResource) {
      try {
        return this.resourceTitle ?? 'Untitled Resource';
      } catch (e) {
        console.error('StudyResource: Error computing title', e);
        return 'Untitled Resource';
      }
    },
  });

  // ²²⁵ Progress indicator helpers
  get progressColor() {
    const progress = this.progressPercentage || 0;
    if (progress >= 90) return '#059669'; // green
    if (progress >= 70) return '#d97706'; // yellow
    if (progress >= 30) return '#3b82f6'; // blue
    return '#6b7280'; // gray
  }

  static isolated = StudyResourceIsolated;

  static embedded = class Embedded extends Component<typeof StudyResource> {
    // ¹⁰ Clean embedded format
    <template>
      <div class='study-resource-embedded'>
        <div class='card-header'>
          {{#if @model.subject}}
            <div class='subject-badge'>{{@model.subject}}</div>
          {{/if}}

          <div class='status-indicator {{@model.completionStatus}}'>
            <svg
              class='status-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              {{#if (eq @model.completionStatus 'completed')}}
                <path d='M20 6L9 17l-5-5' />
              {{else if (eq @model.completionStatus 'in_progress')}}
                <circle cx='12' cy='12' r='10' />
                <polyline points='12,6 12,12 16,14' />
              {{else}}
                <circle cx='12' cy='12' r='10' />
              {{/if}}
            </svg>
          </div>
        </div>

        <div class='card-content'>
          <h4 class='card-title'>{{if
              @model.resourceTitle
              @model.resourceTitle
              'Untitled Resource'
            }}</h4>

          <div class='card-meta'>
            {{#if @model.resourceType}}
              <span class='resource-type'>{{@model.resourceType}}</span>
            {{/if}}
            {{#if @model.difficulty}}
              <span
                class='difficulty difficulty-{{@model.difficulty}}'
              >{{@model.difficulty}}</span>
            {{/if}}
          </div>

          {{#if @model.estimatedTime}}
            <div class='time-estimate'>
              <svg
                class='time-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <polyline points='12,6 12,12 16,14' />
              </svg>
              {{formatDuration
                @model.estimatedTime
                unit='minutes'
                format='humanize'
              }}
            </div>
          {{/if}}
        </div>

        {{#if @model.progressPercentage}}
          <div class='card-progress'>
            <div class='progress-bar'>
              <div
                class='progress-fill'
                style={{htmlSafe
                  (concat 'width: ' @model.progressPercentage '%;')
                }}
              ></div>
            </div>
            <div class='progress-text'>{{@model.progressPercentage}}% complete</div>
          </div>
        {{/if}}

        {{#if (gt @model.tags.length 0)}}
          <div class='card-tags'>
            {{#each @model.tags as |tag index|}}
              {{#if (lt index 3)}}
                <span class='tag'>{{tag}}</span>
              {{/if}}
            {{/each}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* Focus Flow embedded styling */
        .study-resource-embedded {
          font-family:
            'Inter',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          background: #ffffff;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          font-size: 0.8125rem;
          display: flex;
          flex-direction: column;
          min-height: 180px;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;

          --primary: #1e3a8a;
          --secondary: #059669;
          --accent: #f59e0b;
          --text-primary: #1f2937;
          --text-secondary: #6b7280;
          --surface-subtle: #f8fafc;
        }

        .study-resource-embedded::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--primary), var(--secondary));
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .study-resource-embedded:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px -8px rgba(30, 58, 138, 0.15);
        }

        .study-resource-embedded:hover::before {
          opacity: 1;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1rem 0;
        }

        .subject-badge {
          background: rgba(30, 58, 138, 0.1);
          color: var(--primary);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
        }

        .status-indicator {
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .status-icon {
          width: 0.875rem;
          height: 0.875rem;
        }

        .status-indicator.not_started {
          background: #f3f4f6;
          color: #6b7280;
        }

        .status-indicator.in_progress {
          background: #fef3c7;
          color: #d97706;
        }

        .status-indicator.completed {
          background: #dcfce7;
          color: var(--secondary);
        }

        .card-content {
          flex: 1;
          padding: 0 1rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .card-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 0.5rem 0;
          line-height: 1.3;
        }

        .card-meta {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
          flex-wrap: wrap;
        }

        .resource-type {
          background: rgba(59, 130, 246, 0.1);
          color: var(--primary);
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-size: 0.625rem;
          font-weight: 500;
        }

        .difficulty {
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-size: 0.625rem;
          font-weight: 500;
        }

        .difficulty-beginner {
          background: #dcfce7;
          color: #166534;
        }

        .difficulty-intermediate {
          background: #fef3c7;
          color: #92400e;
        }

        .difficulty-advanced {
          background: #fee2e2;
          color: #dc2626;
        }

        .time-estimate {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          color: var(--text-secondary);
          font-size: 0.75rem;
          font-weight: 500;
        }

        .time-icon {
          width: 0.875rem;
          height: 0.875rem;
        }

        .card-progress {
          padding: 0 1rem;
          margin-bottom: 0.75rem;
        }

        .progress-bar {
          width: 100%;
          height: 4px;
          background: #f3f4f6;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 0.375rem;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .progress-text {
          font-size: 0.625rem;
          color: var(--text-secondary);
          text-align: center;
          font-weight: 500;
        }

        .card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
          padding: 0 1rem 1rem;
        }

        .tag {
          background: var(--surface-subtle);
          color: var(--text-secondary);
          font-size: 0.5625rem;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-weight: 500;
        }

        @media (max-width: 480px) {
          .card-content {
            padding: 0 0.75rem;
          }

          .card-header {
            padding: 0.75rem 0.75rem 0;
          }

          .card-tags {
            padding: 0 0.75rem 0.75rem;
          }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof StudyResource> {
    // ²³² Fitted format for grids and galleries
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='resource-badge'>
            <div class='badge-icon status-{{@model.completionStatus}}'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                {{#if (eq @model.completionStatus 'completed')}}
                  <path d='M20 6L9 17l-5-5' />
                {{else if (eq @model.completionStatus 'in_progress')}}
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12,6 12,12 16,14' />
                {{else}}
                  <circle cx='12' cy='12' r='10' />
                {{/if}}
              </svg>
            </div>
            <div class='badge-content'>
              <div class='badge-title'>{{if
                  @model.resourceTitle
                  @model.resourceTitle
                  'Resource'
                }}</div>
              <div class='badge-type'>{{if
                  @model.resourceType
                  @model.resourceType
                  'Study Material'
                }}</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='resource-strip'>
            <div class='strip-left'>
              <div class='strip-title'>{{if
                  @model.resourceTitle
                  @model.resourceTitle
                  'Resource'
                }}</div>
              <div class='strip-subject'>{{if
                  @model.subject
                  @model.subject
                  @model.resourceType
                }}</div>
            </div>
            <div class='strip-right'>
              <div class='strip-status {{@model.completionStatus}}'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  {{#if (eq @model.completionStatus 'completed')}}
                    <path d='M20 6L9 17l-5-5' />
                  {{else if (eq @model.completionStatus 'in_progress')}}
                    <circle cx='12' cy='12' r='10' />
                    <polyline points='12,6 12,12 16,14' />
                  {{else}}
                    <circle cx='12' cy='12' r='10' />
                  {{/if}}
                </svg>
              </div>
              {{#if @model.estimatedTime}}
                <div class='strip-time'>{{@model.estimatedTime}}m</div>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='resource-tile'>
            <div class='tile-header'>
              <h4 class='tile-title'>{{if
                  @model.resourceTitle
                  @model.resourceTitle
                  'Resource'
                }}</h4>
              <div class='tile-status {{@model.completionStatus}}'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  {{#if (eq @model.completionStatus 'completed')}}
                    <path d='M20 6L9 17l-5-5' />
                  {{else if (eq @model.completionStatus 'in_progress')}}
                    <circle cx='12' cy='12' r='10' />
                    <polyline points='12,6 12,12 16,14' />
                  {{else}}
                    <circle cx='12' cy='12' r='10' />
                  {{/if}}
                </svg>
              </div>
            </div>

            <div class='tile-meta'>
              {{#if @model.subject}}
                <div class='tile-subject'>{{@model.subject}}</div>
              {{/if}}
              {{#if @model.difficulty}}
                <div
                  class='tile-difficulty difficulty-{{@model.difficulty}}'
                >{{@model.difficulty}}</div>
              {{/if}}
            </div>

            {{#if @model.progressPercentage}}
              <div class='tile-progress'>
                <div class='progress-bar'>
                  <div
                    class='progress-fill'
                    style={{htmlSafe
                      (concat
                        'width: '
                        @model.progressPercentage
                        '%; background: '
                        @model.progressColor
                      )
                    }}
                  ></div>
                </div>
                <div class='progress-text'>{{@model.progressPercentage}}%
                  complete</div>
              </div>
            {{else}}
              <div class='tile-footer'>
                {{#if @model.estimatedTime}}
                  <div class='time-info'>{{formatDuration
                      @model.estimatedTime
                      unit='minutes'
                      format='humanize'
                    }}</div>
                {{/if}}
              </div>
            {{/if}}
          </div>
        </div>

        <div class='card-format'>
          <div class='resource-card'>
            <div class='card-header'>
              <div class='header-left'>
                <h4 class='card-title'>{{if
                    @model.resourceTitle
                    @model.resourceTitle
                    'Resource'
                  }}</h4>
                <div class='card-meta'>
                  {{#if @model.subject}}
                    <span class='subject'>{{@model.subject}}</span>
                  {{/if}}
                  {{#if @model.resourceType}}
                    <span class='type'>{{@model.resourceType}}</span>
                  {{/if}}
                </div>
              </div>
              <div class='card-status {{@model.completionStatus}}'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  {{#if (eq @model.completionStatus 'completed')}}
                    <path d='M20 6L9 17l-5-5' />
                  {{else if (eq @model.completionStatus 'in_progress')}}
                    <circle cx='12' cy='12' r='10' />
                    <polyline points='12,6 12,12 16,14' />
                  {{else}}
                    <circle cx='12' cy='12' r='10' />
                  {{/if}}
                </svg>
              </div>
            </div>

            <div class='card-content'>
              {{#if @model.progressPercentage}}
                <div class='card-progress'>
                  <div class='progress-header'>
                    <span class='progress-label'>Progress</span>
                    <span
                      class='progress-percent'
                    >{{@model.progressPercentage}}%</span>
                  </div>
                  <div class='progress-bar'>
                    <div
                      class='progress-fill'
                      style={{htmlSafe
                        (concat
                          'width: '
                          @model.progressPercentage
                          '%; background: '
                          @model.progressColor
                        )
                      }}
                    ></div>
                  </div>
                </div>
              {{/if}}

              <div class='card-details'>
                {{#if @model.difficulty}}
                  <div class='detail-item'>
                    <span class='detail-label'>Difficulty:</span>
                    <span
                      class='detail-value difficulty-{{@model.difficulty}}'
                    >{{@model.difficulty}}</span>
                  </div>
                {{/if}}
                {{#if @model.estimatedTime}}
                  <div class='detail-item'>
                    <span class='detail-label'>Time:</span>
                    <span class='detail-value'>{{formatDuration
                        @model.estimatedTime
                        unit='minutes'
                        format='humanize'
                      }}</span>
                  </div>
                {{/if}}
                {{#if @model.lastAccessed}}
                  <div class='detail-item'>
                    <span class='detail-label'>Last:</span>
                    <span class='detail-value'>{{formatDateTime
                        @model.lastAccessed
                        relative=true
                      }}</span>
                  </div>
                {{/if}}
              </div>

              {{#if (gt @model.tags.length 0)}}
                <div class='card-tags'>
                  {{#each @model.tags as |tag index|}}
                    {{#if (lt index 3)}}
                      <span class='tag'>{{tag}}</span>
                    {{/if}}
                  {{/each}}
                  {{#if (gt @model.tags.length 3)}}
                    <span class='tag-more'>+{{subtract
                        (Number @model.tags.length)
                        3
                      }}</span>
                  {{/if}}
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        /* ²³³ Fitted format styling */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'Inter', sans-serif;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.5rem);
          box-sizing: border-box;
        }

        /* Badge Format Activation */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
          }
        }

        .resource-badge {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 0.375rem;
          box-sizing: border-box;
        }

        .badge-icon {
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .badge-icon svg {
          width: 0.75rem;
          height: 0.75rem;
        }

        .badge-content {
          flex: 1;
          min-width: 0;
        }

        .badge-title {
          font-size: 0.6875rem;
          font-weight: 600;
          color: #1f2937;
          line-height: 1;
          margin-bottom: 0.125rem;
        }

        .badge-type {
          font-size: 0.5625rem;
          color: #6b7280;
          line-height: 1;
        }

        /* Strip Format Activation */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
          }
        }

        .resource-strip {
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
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1f2937;
          line-height: 1.1;
          margin-bottom: 0.125rem;
        }

        .strip-subject {
          font-size: 0.625rem;
          color: #3b82f6;
          font-weight: 500;
        }

        .strip-right {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-shrink: 0;
        }

        .strip-status {
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .strip-status svg {
          width: 0.75rem;
          height: 0.75rem;
        }

        .strip-time {
          font-size: 0.625rem;
          color: #6b7280;
          font-weight: 500;
        }

        /* Tile Format Activation */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        .resource-tile {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 0.75rem;
          box-sizing: border-box;
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }

        .tile-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
          line-height: 1.2;
          flex: 1;
          margin-right: 0.5rem;
        }

        .tile-status {
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .tile-status svg {
          width: 0.875rem;
          height: 0.875rem;
        }

        .tile-meta {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-bottom: 0.75rem;
        }

        .tile-subject {
          font-size: 0.6875rem;
          color: #3b82f6;
          font-weight: 500;
        }

        .tile-difficulty {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-weight: 500;
          align-self: flex-start;
        }

        .tile-progress,
        .tile-footer {
          margin-top: auto;
        }

        .progress-bar {
          width: 100%;
          height: 4px;
          background: #f3f4f6;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 0.25rem;
        }

        .progress-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .progress-text {
          font-size: 0.625rem;
          color: #6b7280;
          text-align: center;
        }

        .time-info {
          font-size: 0.625rem;
          color: #6b7280;
          text-align: center;
        }

        /* Card Format Activation */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .resource-card {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
          box-sizing: border-box;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
        }

        .card-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 0.25rem 0;
          line-height: 1.2;
        }

        .card-meta {
          display: flex;
          gap: 0.5rem;
          font-size: 0.6875rem;
        }

        .card-meta .subject {
          color: #3b82f6;
          font-weight: 500;
        }

        .card-meta .type {
          color: #6b7280;
        }

        .card-status {
          width: 1.75rem;
          height: 1.75rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .card-status svg {
          width: 1rem;
          height: 1rem;
        }

        .card-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .card-progress {
          margin-bottom: 0.5rem;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.375rem;
        }

        .progress-label {
          font-size: 0.6875rem;
          color: #6b7280;
          font-weight: 500;
        }

        .progress-percent {
          font-size: 0.6875rem;
          color: #1f2937;
          font-weight: 600;
        }

        .card-details {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .detail-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .detail-label {
          font-size: 0.6875rem;
          color: #6b7280;
          font-weight: 500;
        }

        .detail-value {
          font-size: 0.6875rem;
          color: #1f2937;
          font-weight: 500;
        }

        .card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
          margin-top: auto;
        }

        .tag {
          background: #f3f4f6;
          color: #374151;
          font-size: 0.5625rem;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-weight: 500;
        }

        .tag-more {
          background: #e5e7eb;
          color: #6b7280;
          font-size: 0.5625rem;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-weight: 500;
        }

        /* Status colors */
        .not_started {
          background: #f3f4f6;
          color: #6b7280;
        }

        .in_progress {
          background: #fef3c7;
          color: #d97706;
        }

        .completed {
          background: #dcfce7;
          color: #059669;
        }

        /* Difficulty colors */
        .difficulty-beginner {
          background: #dcfce7;
          color: #166534;
        }

        .difficulty-intermediate {
          background: #fef3c7;
          color: #92400e;
        }

        .difficulty-advanced {
          background: #fee2e2;
          color: #dc2626;
        }
      </style>
    </template>
  };
}
