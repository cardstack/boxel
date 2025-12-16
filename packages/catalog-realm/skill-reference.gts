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

import { Button, Pill } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

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
              <@fields.topicName />
            </h4>
            <Pill
              class='skill-ref-mode boxel-ellipsize'
              @variant={{cn
                primary=(eq @model.inclusionMode 'full')
                accent=(eq @model.inclusionMode 'essential')
                muted=(eq @model.inclusionMode 'link-only')
              }}
            >
              {{if
                (eq @model.inclusionMode 'link-only')
                'Link Only'
                @model.inclusionMode
              }}
            </Pill>
          </div>

          {{#if @model.skill}}
            <div>
              <Button
                @size='extra-small'
                class='skill-view-button'
                {{on 'click' this.openSkill}}
              >
                <ExternalLink class='button-icon' width='14' height='14' />
                Open Skill
              </Button>
            </div>
          {{/if}}
        </div>

        {{#if @model.contentSummary}}
          <div class='content-summary'>
            <p>
              <strong>Contains:</strong>
              {{@model.contentSummary}}
            </p>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .skill-reference-card {
          --skillref-background: var(--card, var(--boxel-light));
          --skillref-foreground: var(--card-foreground, var(--boxel-dark));
          --skillref-border: var(--border, var(--boxel-border-color));
          --skillref-muted: var(--muted, var(--boxel-100));
          --skillref-muted-foreground: var(
            --muted-foreground,
            var(--boxel-700)
          );

          padding: var(--boxel-sp);
          border: 1px solid var(--skillref-border);
          border-radius: var(--boxel-border-radius-lg);
          background-color: var(--skillref-background);
          color: var(--skillref-foreground);
          box-shadow: var(--shadow-sm);
        }
        .skill-ref-header {
          display: flex;
          flex-direction: column; /* Stack title row and button */
          gap: var(--boxel-sp-xs);
        }
        .skill-ref-title-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .skill-ref-topic {
          flex: 1;
          min-width: 0;
        }
        .skill-ref-mode {
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xl);
          padding: var(--boxel-sp-6xs) var(--boxel-sp-sm);
          flex-shrink: 0;
        }
        :deep(.skill-ref-mode.variant-muted) {
          --pill-border-color: var(--skillref-border);
        }
        .skill-view-button {
          gap: var(--boxel-sp-2xs);
        }
        .button-icon {
          width: 0.875rem;
          height: 0.875rem;
        }
        .content-summary {
          margin-top: var(--boxel-sp-sm);
          padding-top: var(--boxel-sp-sm);
          border-top: 1px solid var(--skillref-border);
        }
        .content-summary p {
          font-size: var(--boxel-font-size-xs);
          color: var(--skillref-muted-foreground);
          background-color: var(--skillref-muted);
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--skillref-border);
          border-left: 2px solid var(--primary, var(--boxel-highlight));
        }
        .content-summary strong {
          color: var(--foreground, var(--boxel-dark));
          font-weight: 700;
        }
      </style>
    </template>
  };
}
