import { dayjsFormat, add } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  field,
  contains,
  containsMany,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DateRangeField from 'https://cardstack.com/base/date-range-field';
import { gt } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

export class WorkflowStepField extends FieldDef {
  static displayName = 'Workflow Step';

  @field name = contains(StringField);
  @field description = contains(MarkdownField);
  @field isComplete = contains(BooleanField);
  @field dueDate = contains(DateField);
}

export class WorkflowPlanner extends CardDef {
  static displayName = 'Workflow Planner';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field steps = containsMany(WorkflowStepField);
  @field dateRange = contains(DateRangeField);

  @field completedTasks = contains(NumberField, {
    computeVia: function (this: WorkflowPlanner) {
      return this.steps.filter((step) => step.isComplete).length;
    },
  });
  @field completedPercentage = contains(NumberField, {
    computeVia: function (this: WorkflowPlanner) {
      if (this.steps.length === 0) return 0;
      return Math.round((this.completedTasks / this.steps.length) * 100);
    },
  });

  static isolated = class Isolated extends Component<typeof WorkflowPlanner> {
    <template>
      <div class='workflow-planner'>
        <header class='workflow-header'>
          <div class='header-content'>
            <div class='title-section'>
              <h1 class='workflow-title'>{{@model.title}}</h1>
            </div>
            <div class='workflow-dates'>
              {{#if @model.dateRange.start}}
                <div class='date-badge start-date'>
                  <div class='date-content'>
                    <span class='date-label'>Start</span>
                    <span class='date-value'>{{dayjsFormat
                        @model.dateRange.start
                        'MMM D, YYYY'
                      }}</span>
                  </div>
                </div>
              {{/if}}
              {{#if @model.dateRange.end}}
                <div class='date-badge end-date'>
                  <div class='date-content'>
                    <span class='date-label'>End</span>
                    <span class='date-value'>{{dayjsFormat
                        @model.dateRange.end
                        'MMM D, YYYY'
                      }}</span>
                  </div>
                </div>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='workflow-description'>
          <div class='description-card'>
            <@fields.description />
          </div>
        </div>

        <div class='workflow-steps'>
          <div class='steps-header'>
            <h2>Workflow Steps</h2>
            {{#if @model.steps.length}}
              <div class='progress-indicator'>
                <span class='progress-text'>
                  {{@model.completedTasks}}
                  of
                  {{@model.steps.length}}
                  completed
                </span>
                <div class='progress-bar'>
                  <div
                    class='progress-fill'
                    style={{htmlSafe
                      (concat 'width: ' @model.completedPercentage '%')
                    }}
                  ></div>
                </div>
              </div>
            {{/if}}
          </div>

          {{#if @model.steps.length}}
            <div class='steps-timeline'>
              {{#each @model.steps as |step index|}}
                <div class='step-container {{if step.isComplete "completed"}}'>
                  <div
                    class='timeline-connector {{if (gt index 0) "visible"}}'
                  ></div>

                  <div class='step-item'>
                    <div class='step-indicator'>
                      <div class='step-number'>
                        {{#if step.isComplete}}
                          <span class='checkmark'>✓</span>
                        {{else}}
                          {{add index 1}}
                        {{/if}}
                      </div>
                    </div>

                    <div class='step-content'>
                      <div class='step-header'>
                        <h3 class='step-name'>{{step.name}}</h3>
                        {{#if step.dueDate}}
                          <div class='step-due'>
                            <span class='due-text'>Due:
                              {{dayjsFormat step.dueDate 'MMM D, YYYY'}}</span>
                          </div>
                        {{/if}}
                        {{#if step.isComplete}}
                          <div class='completion-badge'>
                            <span class='badge-text'>Complete</span>
                          </div>
                        {{/if}}
                      </div>
                      <div class='step-description'>
                        {{step.description}}
                      </div>
                    </div>
                  </div>
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class='no-steps'>
              <div class='empty-state'>
                <h3>No workflow steps yet</h3>
                <p>Add your first workflow step to begin planning your project.</p>
              </div>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .workflow-planner {
          padding: 32px;
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          background: #fafafa;
          min-height: 100vh;
        }

        .workflow-header {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 24px;
        }

        .workflow-title {
          font-size: 28px;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
          letter-spacing: -0.01em;
        }

        .workflow-dates {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .date-badge {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          padding: 8px 16px;
          border-radius: 6px;
        }

        .date-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .date-label {
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .date-value {
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        }

        .workflow-description {
          margin-bottom: 24px;
        }

        .description-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
          color: #4b5563;
          line-height: 1.6;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .workflow-steps {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .steps-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid #f3f4f6;
        }

        .steps-header h2 {
          font-size: 20px;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
        }

        .progress-indicator {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .progress-text {
          font-size: 14px;
          font-weight: 500;
          color: #6b7280;
          white-space: nowrap;
        }

        .progress-bar {
          width: 150px;
          height: 6px;
          background: #f3f4f6;
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: #374151;
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .steps-timeline {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .step-container {
          position: relative;
        }

        .timeline-connector {
          position: absolute;
          left: 20px;
          top: -16px;
          width: 2px;
          height: 16px;
          background: #e5e7eb;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .timeline-connector.visible {
          opacity: 1;
        }

        .step-item {
          display: flex;
          gap: 16px;
          background: #f9fafb;
          padding: 16px;
          border-radius: 6px;
          border: 1px solid #f3f4f6;
          transition: all 0.2s ease;
        }

        .step-item:hover {
          background: #f3f4f6;
          border-color: #d1d5db;
        }

        .completed .step-item {
          background: #f0fdf4;
          border-color: #bbf7d0;
        }

        .step-indicator {
          flex-shrink: 0;
        }

        .step-number {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #374151;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
        }

        .completed .step-number {
          background: #16a34a;
        }

        .checkmark {
          font-size: 16px;
        }

        .step-content {
          flex: 1;
          min-width: 0;
        }

        .step-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }

        .step-name {
          font-size: 16px;
          font-weight: 500;
          color: #1f2937;
          margin: 0;
          flex: 1;
          min-width: 200px;
        }

        .step-due {
          background: #fef3c7;
          border: 1px solid #fbbf24;
          color: #92400e;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }

        .completion-badge {
          background: #dcfce7;
          border: 1px solid #16a34a;
          color: #15803d;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }

        .step-description {
          font-size: 14px;
          color: #6b7280;
          line-height: 1.5;
        }

        .no-steps {
          text-align: center;
          padding: 48px 24px;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .empty-state h3 {
          font-size: 18px;
          font-weight: 500;
          color: #374151;
          margin: 0;
        }

        .empty-state p {
          font-size: 14px;
          color: #6b7280;
          margin: 0;
          max-width: 400px;
        }

        @media (max-width: 768px) {
          .workflow-planner {
            padding: 16px;
          }

          .header-content {
            flex-direction: column;
            align-items: flex-start;
          }

          .workflow-title {
            font-size: 24px;
          }

          .step-item {
            flex-direction: column;
            gap: 12px;
          }

          .step-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }

          .progress-indicator {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }

          .progress-bar {
            width: 100%;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof WorkflowPlanner> {
    <template>
      <div class='workflow-edit'>
        <div class='edit-header'>
          <h1>Edit Workflow</h1>
          <p>Customize your workflow planner</p>
        </div>

        <div class='edit-form'>
          <div class='field-container'>
            <label>Title</label>
            <@fields.title />
          </div>

          <div class='field-container'>
            <label>Description</label>
            <@fields.description />
          </div>

          <div class='field-container'>
            <label>Date Range</label>
            <@fields.dateRange />
          </div>

          <div class='field-container'>
            <label>Workflow Steps</label>
            <@fields.steps />
          </div>
        </div>
      </div>

      <style scoped>
        .workflow-edit {
          background: #fafafa;
          min-height: 100vh;
          padding: 32px;
        }

        .edit-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .edit-header h1 {
          font-size: 28px;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: #1f2937;
        }

        .edit-header p {
          font-size: 16px;
          color: #6b7280;
          margin: 0;
        }

        .edit-form {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 32px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .field-container {
          margin-bottom: 24px;
        }

        label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          font-size: 14px;
          color: #374151;
        }

        @media (max-width: 768px) {
          .workflow-edit {
            padding: 16px;
          }

          .edit-form {
            padding: 24px;
          }

          .date-fields {
            grid-template-columns: 1fr;
            gap: 24px;
          }
        }
      </style>
    </template>
  };
}
