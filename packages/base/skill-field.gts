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

// The frontmatter of a skill markdown file (`kind: skill`). Mirrors the field
// shape of the legacy `Skill` card so the host's command-definition upload flow
// reads `markdownDef.frontmatter.commands` exactly as it reads `Skill.commands`.
export class SkillField extends FrontmatterField {
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
