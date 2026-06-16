import {
  Component,
  field,
  contains,
  containsMany,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';
import { FrontmatterField } from './frontmatter-field';
import { CommandField } from './command-field';

// A skill markdown file's frontmatter (`boxel.kind: skill`). Adds typed fields
// on top of the base `FrontmatterField` (which holds the raw frontmatter in
// `rawContent`). Mirrors the field shape of the legacy `Skill` card so the
// host's command-definition upload flow reads `markdownDef.frontmatter.commands`
// exactly as it reads `Skill.commands`. `name`/`description` are sourced from the
// shared top-level frontmatter keys (see `MarkdownDef.extractAttributes`).
export class SkillFrontmatterField extends FrontmatterField {
  static displayName = 'Skill';

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field commands = containsMany(CommandField);

  // `name`/`description` come from the shared top-level frontmatter keys;
  // `commands` from the `boxel:` namespace. Only this subclass knows that
  // mapping.
  static fromFrontmatter(
    frontmatter: Record<string, unknown>,
  ): Record<string, unknown> {
    let boxel =
      frontmatter.boxel &&
      typeof frontmatter.boxel === 'object' &&
      !Array.isArray(frontmatter.boxel)
        ? (frontmatter.boxel as Record<string, unknown>)
        : undefined;
    return {
      ...super.fromFrontmatter(frontmatter),
      name: frontmatter.name,
      description: frontmatter.description,
      commands: boxel?.commands,
    };
  }

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      {{@model.name}}
    </template>
  };
}
