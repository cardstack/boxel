import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import TagIcon from '@cardstack/boxel-icons/tag';
import { htmlSafe } from '@ember/template';
import { stateColor } from './utils/index';

export const SKILL_CATEGORIES = [
  'language',
  'framework',
  'tool',
  'platform',
  'practice',
];

export const SKILL_CATEGORY_COLORS: Record<string, { bg: string; fg: string }> =
  {
    language: stateColor('purple'),
    framework: stateColor('blue'),
    tool: stateColor('amber'),
    platform: stateColor('pink'),
    practice: stateColor('green'),
  };

export const SkillCategoryField = enumField(StringField, {
  options: SKILL_CATEGORIES.map((category) => ({
    value: category,
    label: category,
  })),
  displayName: 'Skill Category',
});

export class Skill extends CardDef {
  static displayName = 'Skill';
  static icon = TagIcon;

  @field name = contains(StringField);
  @field category = contains(SkillCategoryField);

  @field title = contains(StringField, {
    computeVia: function (this: Skill) {
      return this.name?.trim() || 'Unnamed Skill';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get categoryStyle() {
      let c = SKILL_CATEGORY_COLORS[this.args.model?.category ?? ''] ?? {
        bg: 'var(--muted, var(--boxel-100))',
        fg: 'var(--muted-foreground, var(--boxel-450))',
      };
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <article class='skill-isolated'>
        <span class='icon-chip'>
          <TagIcon class='icon-chip-svg' />
        </span>
        <h1>{{@model.title}}</h1>
        {{#if @model.category}}
          <span class='category-chip' style={{this.categoryStyle}}>
            {{@model.category}}
          </span>
        {{/if}}
      </article>
      <style scoped>
        .skill-isolated {
          padding: var(--boxel-sp-xl);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          height: 100%;
          box-sizing: border-box;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--boxel-sp-sm);
        }
        .icon-chip {
          width: 3rem;
          height: 3rem;
          border-radius: var(--radius, 0.875rem);
          background: var(--accent, var(--boxel-100));
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .icon-chip-svg {
          width: 1.5rem;
          height: 1.5rem;
          color: var(--foreground, var(--boxel-dark));
        }
        h1 {
          margin: 0;
          font-weight: 800;
          font-size: var(--boxel-font-size-xl);
          letter-spacing: -0.02em;
          font-family: var(--font-heading, inherit);
        }
        .category-chip {
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get categoryStyle() {
      let c = SKILL_CATEGORY_COLORS[this.args.model?.category ?? ''] ?? {
        bg: 'var(--muted, var(--boxel-100))',
        fg: 'var(--muted-foreground, var(--boxel-450))',
      };
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <span class='skill-chip' style={{this.categoryStyle}}>
        {{@model.title}}
      </span>
      <style scoped>
        .skill-chip {
          display: inline-flex;
          align-items: center;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs, 0.75rem);
          font-weight: 600;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='skill-atom'>{{@model.title}}</span>
      <style scoped>
        .skill-atom {
          font-size: 0.8125rem;
          font-weight: 500;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get categoryStyle() {
      let c = SKILL_CATEGORY_COLORS[this.args.model?.category ?? ''] ?? {
        bg: 'var(--muted, var(--boxel-100))',
        fg: 'var(--muted-foreground, var(--boxel-450))',
      };
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <div class='fit'>
        <span class='chip' style={{this.categoryStyle}}>{{@model.title}}</span>
      </div>
      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          padding: 4px 8px;
          overflow: hidden;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}
