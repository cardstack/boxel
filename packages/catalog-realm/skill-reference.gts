// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  FieldDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string'; // ²⁶ Import StringField for inclusion parameters
import MarkdownField from 'https://cardstack.com/base/markdown'; // ²² Changed from StringField to MarkdownField
import { Skill } from 'https://cardstack.com/base/skill'; // ²⁴ Import base Skill

export class SkillReference extends FieldDef {
  // ² Skill reference field
  static displayName = 'Skill Reference';

  @field skill = linksTo(Skill); // ²⁵ Link to base Skill

  @field inclusionMode = contains(StringField, {
    // ²⁷ How skill content should be included in skill set
    description:
      'How to include this skill: "full" (entire instructions), "essential" (content before <!--more-->), or "link-only" (reference only, no content)',
  });

  @field readFullWhen = contains(StringField, {
    // ²⁸ Condition for when to read the complete skill file
    description:
      'Optional: Specify when the full skill content should be read (e.g., "user requests code generation", "debugging needed")',
  });

  @field topicName = contains(StringField, {
    // ³⁰ Computed topic name from linked skill
    computeVia: function (this: SkillReference) {
      try {
        const skillCard = this.skill as any;
        // First try topic field, then title field, then id-based fallback
        if (skillCard?.topic) return skillCard.topic;
        if (skillCard?.title) return skillCard.title;

        // Extract name from ID as last resort
        if (skillCard?.id) {
          const parts = skillCard.id.split('/');
          const lastPart = parts[parts.length - 1];
          // Convert kebab-case or camelCase to Title Case
          return lastPart
            .replace(/-/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .split(' ')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
            .trim();
        }

        return 'Untitled';
      } catch (e) {
        console.error('SkillReference: Error accessing topic name', e);
        return 'Untitled';
      }
    },
    description:
      'Topic name extracted from the linked skill (topic → title → id-based name)',
  });

  @field essentials = contains(MarkdownField, {
    // ²³ Changed to MarkdownField for rich formatting
    computeVia: function (this: SkillReference) {
      try {
        // Access essentials field directly from the skill object
        const skillCard = this.skill as any;
        const essentials = skillCard?.essentials;

        // If essentials is blank/empty, use the full instructions instead
        if (!essentials || essentials.trim() === '') {
          return skillCard?.instructions ?? '';
        }

        return essentials;
      } catch (e) {
        console.error('SkillReference: Error accessing essentials', e);
        return '';
      }
    },
    description:
      'Essential content from the linked skill - uses instructions if essentials is blank',
  });

  static embedded = class Embedded extends Component<typeof this> {
    // ⁵ Embedded template
    <template>
      {{#if @model.skill}}
        <div class='skill-reference'>
          <@fields.skill @format='embedded' />
          {{#if @model.inclusionMode}}
            <div class='inclusion-info'>
              <span class='label'>Inclusion:</span>
              {{@model.inclusionMode}}
            </div>
          {{/if}}
          {{#if @model.readFullWhen}}
            <div class='read-full-info'>
              <span class='label'>Read full when:</span>
              {{@model.readFullWhen}}
            </div>
          {{/if}}
        </div>
      {{else}}
        <div class='no-skill'>No skill linked</div>
      {{/if}}

      <style scoped>
        /* ²⁹ Styling for skill reference display */
        .skill-reference {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .inclusion-info,
        .read-full-info {
          font-size: 0.875rem;
          color: var(--boxel-600);
          padding: 0.25rem 0.5rem;
          background: var(--boxel-100);
          border-radius: 0.25rem;
        }

        .label {
          font-weight: 600;
          margin-right: 0.25rem;
        }

        .no-skill {
          font-style: italic;
          color: var(--boxel-500);
        }
      </style>
    </template>
  };
}
