import {
  Component,
  field,
  contains,
  containsMany,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';
import { BoxelFrontmatterField } from './boxel-frontmatter-field';
import { CommandField } from './command-field';

// The `boxel:` namespace of a skill markdown file (`boxel.kind: skill`). Mirrors
// the field shape of the legacy `Skill` card so the host's command-definition
// upload flow reads `markdownDef.boxel.commands` exactly as it reads
// `Skill.commands`. `name`/`description` are sourced from the shared top-level
// frontmatter (see `MarkdownDef.extractAttributes`).
export class SkillField extends BoxelFrontmatterField {
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
