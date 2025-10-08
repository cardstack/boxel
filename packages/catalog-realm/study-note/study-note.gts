// ═══ [EDIT TRACKING: ON] Mark all changes with ¹ ═══
import {
  CardDef,
  field,
  contains,
  Component,
  containsMany,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { formatDateTime, gt, lt, subtract } from '@cardstack/boxel-ui/helpers'; // ³ Formatters
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import NotebookIcon from '@cardstack/boxel-icons/notebook'; // ⁴ Icon import

class StudyNoteIsolated extends Component<typeof StudyNoteCard> {
  // ¹⁰ Clean, focus-first isolated format
  @tracked isExpanded = false;

  @action
  toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  <template>
    <div class='study-note-clean'>
      <header class='note-header'>
        {{#if @model.subject}}
          <div class='subject-badge'>
            {{@model.subject}}
          </div>
        {{/if}}

        <h1 class='note-title'>{{if
            @model.noteTitle
            @model.noteTitle
            'Untitled Note'
          }}</h1>

        <div class='note-meta'>
          {{#if @model.createdAt}}
            <div class='created-date'>
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
              {{formatDateTime @model.createdAt size='medium'}}
            </div>
          {{/if}}

          {{#if @model.lastModified}}
            <div class='modified-date'>
              <svg
                class='meta-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M12 20h9' />
                <path
                  d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                />
              </svg>
              Modified
              {{formatDateTime @model.lastModified size='short'}}
            </div>
          {{/if}}
        </div>
      </header>

      <main class='note-content'>
        {{#if @model.content}}
          <div class='content-area'>
            <@fields.content />
          </div>
        {{else}}
          <div class='empty-content'>
            <svg
              class='empty-icon'
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
            <p>Start writing your study notes here!</p>
            <span class='empty-hint'>Use markdown for formatting: **bold**,
              *italic*, \`code\`</span>
          </div>
        {{/if}}
      </main>

      {{#if (gt @model.tags.length 0)}}
        <footer class='note-footer'>
          <div class='tags-section'>
            <svg
              class='tags-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z'
              />
              <line x1='7' y1='7' x2='7.01' y2='7' />
            </svg>
            <div class='tags-container'>
              {{#each @model.tags as |tag|}}
                <span class='tag'>{{tag}}</span>
              {{/each}}
            </div>
          </div>
        </footer>
      {{/if}}
    </div>

    <style scoped>
      .study-note-clean {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        max-width: 50rem;
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

      /* Clean header */
      .note-header {
        text-align: center;
        margin-bottom: 3rem;
      }

      .subject-badge {
        display: inline-block;
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        margin-bottom: 1.5rem;
      }

      .note-title {
        font-size: 2.5rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 1.5rem 0;
        line-height: 1.1;
        letter-spacing: -0.025em;
      }

      .note-meta {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        justify-content: center;
        flex-wrap: wrap;
        color: var(--text-secondary);
        font-size: 0.9375rem;
      }

      .created-date,
      .modified-date {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 500;
      }

      .meta-icon {
        width: 1.125rem;
        height: 1.125rem;
        opacity: 0.8;
      }

      /* Content area - reading focused */
      .note-content {
        margin-bottom: 3rem;
      }

      .content-area {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 3rem;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--border);
        font-size: 1.0625rem;
        line-height: 1.7;
        color: var(--text-primary);
      }

      .empty-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem 2rem;
        text-align: center;
        color: var(--text-secondary);
        background: var(--surface);
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

      .empty-content p {
        font-size: 1.125rem;
        margin: 0 0 0.5rem 0;
        font-weight: 500;
      }

      .empty-hint {
        font-size: 0.875rem;
        color: var(--text-secondary);
        opacity: 0.8;
      }

      /* Tags footer */
      .note-footer {
        padding: 2rem 0 0;
        border-top: 1px solid rgba(226, 232, 240, 0.6);
      }

      .tags-section {
        display: flex;
        align-items: center;
        gap: 1rem;
        justify-content: center;
      }

      .tags-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--text-secondary);
        opacity: 0.7;
      }

      .tags-container {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: center;
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
        .study-note-clean {
          padding: 1rem;
        }

        .note-title {
          font-size: 1.875rem;
        }

        .content-area {
          padding: 2rem 1.5rem;
          font-size: 1rem;
        }

        .note-meta {
          flex-direction: column;
          gap: 0.75rem;
        }

        .tags-container {
          justify-content: center;
        }
      }
    </style>
  </template>
}

export class StudyNoteCard extends CardDef {
  // ⁵ Study note card definition - simplified
  static displayName = 'Study Note';
  static icon = NotebookIcon;

  @field noteTitle = contains(StringField); // ⁶ Essential fields only
  @field content = contains(MarkdownField);
  @field subject = contains(StringField);
  @field tags = containsMany(StringField); // ⁷ Individual tag fields for easy editing
  @field createdAt = contains(DatetimeField);
  @field lastModified = contains(DatetimeField);

  // ⁸ Computed title from noteTitle
  @field title = contains(StringField, {
    computeVia: function (this: StudyNoteCard) {
      try {
        return this.noteTitle || 'Untitled Note';
      } catch (e) {
        console.error('StudyNote: Error computing title', e);
        return 'Untitled Note';
      }
    },
  });

  static isolated = StudyNoteIsolated;

  static embedded = class Embedded extends Component<typeof StudyNoteCard> {
    // ¹¹ Clean embedded format
    <template>
      <div class='study-note-embedded'>
        <div class='note-header'>
          {{#if @model.subject}}
            <div class='subject-badge'>{{@model.subject}}</div>
          {{/if}}

          <div class='note-type-indicator'>
            <svg
              class='note-icon'
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
          </div>
        </div>

        <div class='note-content'>
          <h4 class='note-title'>{{if
              @model.noteTitle
              @model.noteTitle
              'Untitled Note'
            }}</h4>

          <div class='content-preview'>
            {{#if @model.content}}
              <@fields.content />
            {{else}}
              <div class='empty-content'>
                <span>No content yet. Click to start writing!</span>
              </div>
            {{/if}}
          </div>
        </div>

        <div class='note-footer'>
          {{#if @model.lastModified}}
            <div class='last-modified'>
              <svg
                class='time-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M12 20h9' />
                <path
                  d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'
                />
              </svg>
              {{formatDateTime @model.lastModified size='tiny'}}
            </div>
          {{/if}}

          {{#if (gt @model.tags.length 0)}}
            <div class='tags-preview'>
              {{#each @model.tags as |tag index|}}
                {{#if (lt index 2)}}
                  <span class='tag'>{{tag}}</span>
                {{/if}}
              {{/each}}
              {{#if (gt @model.tags.length 2)}}
                <span class='tag-more'>+{{subtract
                    (Number @model.tags.length)
                    2
                  }}</span>
              {{/if}}
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        /* Focus Flow embedded styling */
        .study-note-embedded {
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
          min-height: 200px;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;

          --primary: #1e3a8a;
          --secondary: #059669;
          --text-primary: #1f2937;
          --text-secondary: #6b7280;
          --surface-subtle: #f8fafc;
        }

        .study-note-embedded::before {
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

        .study-note-embedded:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px -8px rgba(30, 58, 138, 0.15);
        }

        .study-note-embedded:hover::before {
          opacity: 1;
        }

        .note-header {
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

        .note-type-indicator {
          width: 1.5rem;
          height: 1.5rem;
          background: rgba(30, 58, 138, 0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .note-icon {
          width: 0.875rem;
          height: 0.875rem;
          color: var(--primary);
        }

        .note-content {
          flex: 1;
          padding: 0 1rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .note-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 0.75rem 0;
          line-height: 1.3;
        }

        .content-preview {
          background: var(--surface-subtle);
          border-radius: 6px;
          padding: 1rem;
          font-size: 0.8125rem;
          line-height: 1.4;
          color: var(--text-primary);
          border: 1px solid rgba(226, 232, 240, 0.6);
          max-height: 6rem;
          overflow: hidden;
          position: relative;
        }

        .content-preview::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 1rem;
          background: linear-gradient(
            to top,
            var(--surface-subtle),
            transparent
          );
        }

        .empty-content {
          color: var(--text-secondary);
          font-style: italic;
          text-align: center;
          padding: 1.5rem;
          background: var(--surface-subtle);
          border-radius: 6px;
          border: 1px dashed #d1d5db;
        }

        .note-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem 1rem;
          gap: 0.5rem;
        }

        .last-modified {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          color: var(--text-secondary);
          font-size: 0.6875rem;
          font-weight: 500;
        }

        .time-icon {
          width: 0.75rem;
          height: 0.75rem;
        }

        .tags-preview {
          display: flex;
          gap: 0.25rem;
          align-items: center;
        }

        .tag {
          background: var(--surface-subtle);
          color: var(--text-secondary);
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

        @media (max-width: 480px) {
          .note-content {
            padding: 0 0.75rem;
          }

          .note-footer {
            flex-direction: column;
            gap: 0.75rem;
            align-items: flex-start;
            padding: 0.75rem;
          }
        }
      </style>
    </template>
  };
}
