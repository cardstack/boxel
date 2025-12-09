import { on } from '@ember/modifier';

import {
  FieldDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import enumField from 'https://cardstack.com/base/enum';
import { Skill } from 'https://cardstack.com/base/skill';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';

import ExternalLink from '@cardstack/boxel-icons/external-link';

import { eq } from '@cardstack/boxel-ui/helpers';

export class SkillReference extends FieldDef {
  static displayName = 'Skill Reference';

  @field skill = linksTo(Skill); // Link to actual skill card

  // Enumerated inclusion mode with three valid options
  @field inclusionMode = contains(
    enumField(StringField, {
      options: [
        { value: 'full', label: 'Full Instructions' },
        { value: 'essential', label: 'Essential Only' },
        { value: 'link-only', label: 'Link Only' },
      ],
    }),
  );

  @field contentSummary = contains(TextAreaField, {
    // Content summary (renamed from readFullWhen, using TextArea for multi-line)
    description:
      'Brief summary of what content this skill contains (helps LLM decide whether to load full instructions)',
  });

  @field alternateTitle = contains(StringField, {
    // Optional override title
    description:
      "Optional: Override the linked skill's title for this reference context",
  });

  @field topicName = contains(StringField, {
    // Computed topic from skill or override
    computeVia: function (this: SkillReference) {
      return (
        this.alternateTitle || this.skill?.cardInfo?.title || 'Untitled Skill'
      );
    },
  });

  @field essentials = contains(MarkdownField, {
    // Computed essentials from skill instructions
    computeVia: function (this: SkillReference) {
      const instructions = this.skill?.instructions;
      if (!instructions) return undefined;

      // Extract content before <!--more--> marker
      const moreMarkerIndex = instructions.indexOf('<!--more-->');
      if (moreMarkerIndex === -1) {
        // No marker found, return first paragraph or section
        return instructions;
      }

      return instructions.substring(0, moreMarkerIndex).trim();
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    // Embedded format

    // Click handler to open linked skill card using viewCard API
    openSkill = () => {
      const skill = this.args.model?.skill;
      if (skill && this.args.viewCard) {
        this.args.viewCard(skill, 'isolated');
      }
    };

    <template>
      <div class='skill-reference-card'>
        <div class='skill-ref-header'>
          <div class='skill-ref-title-row'>
            <h4 class='skill-ref-topic'>
              {{if
                @model.topicName
                @model.topicName
                (if @model.skill.title @model.skill.title 'Skill')
              }}
            </h4>
            <span
              class='skill-ref-mode skill-ref-mode-{{if
                  @model.inclusionMode
                  @model.inclusionMode
                  "link-only"
                }}'
            >
              {{#if (eq @model.inclusionMode 'full')}}
                Full
              {{else if (eq @model.inclusionMode 'essential')}}
                Essential
              {{else}}
                Link Only
              {{/if}}
            </span>
          </div>

          {{#if @model.skill}}
            {{! Button to open skill }}
            <button
              class='skill-view-button'
              type='button'
              {{on 'click' this.openSkill}}
            >
              <ExternalLink class='button-icon' width='14' height='14' />
              Open Skill
            </button>
          {{/if}}
        </div>

        {{#if @model.contentSummary}}
          <div class='content-summary'>
            <strong>Contains:</strong>
            {{@model.contentSummary}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* Enhanced skill reference card styles */
        .skill-reference-card {
          padding: 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--card);
          box-shadow: var(--shadow-sm);
          transition: all 0.2s ease;
        }

        .skill-reference-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--primary);
        }

        .skill-ref-header {
          display: flex;
          flex-direction: column; /* Stack title row and button */
          gap: 0.75rem;
          margin-bottom: 0.75rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
        }

        .skill-ref-title-row {
          /* Row for title and mode badge */
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.5rem;
        }

        .skill-ref-topic {
          font-size: 0.9375rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          flex: 1;
          min-width: 0;
        }

        .skill-ref-mode {
          /* Mode badge with color coding */
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.125rem 0.5rem;
          border-radius: var(--radius-sm);
          flex-shrink: 0;
          white-space: nowrap;
        }

        .skill-ref-mode-full {
          /* Full mode - primary color */
          background: var(--primary);
          color: var(--primary-foreground);
        }

        .skill-ref-mode-essential {
          /* Essential mode - accent color */
          background: var(--accent);
          color: var(--accent-foreground);
        }

        .skill-ref-mode-link-only {
          /* Link only mode - muted color */
          background: var(--muted);
          color: var(--muted-foreground);
          border: 1px solid var(--border);
        }

        .skill-view-button {
          /* Button to open skill */
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--primary);
          background: transparent;
          border: 1px solid var(--primary);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .skill-view-button:hover {
          /* Button hover state */
          background: var(--primary);
          color: var(--primary-foreground);
        }

        .button-icon {
          /* Icon in button */
          width: 0.875rem;
          height: 0.875rem;
        }

        .content-summary {
          font-size: 0.75rem;
          color: var(--muted-foreground);
          margin-top: 0.5rem;
          padding: 0.5rem;
          background: var(--muted);
          border-radius: var(--radius-sm);
          border-left: 2px solid var(--primary);
        }

        .content-summary strong {
          color: var(--foreground);
          font-weight: 600;
        }
      </style>
    </template>
  };
}
