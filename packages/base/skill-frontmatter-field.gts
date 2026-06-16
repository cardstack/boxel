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

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      {{@model.name}}
    </template>
  };
}
