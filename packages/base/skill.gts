import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  type BaseDefComponent,
} from './card-api';
import MarkdownField from './markdown';
import StringField from './string';
import RobotIcon from '@cardstack/boxel-icons/robot';
import { CommandField } from './command-field';

export const isSkillCard = Symbol.for('is-skill-card');

// Re-exported for back-compat: `CommandField` now lives in its own module so
// `SkillField` (skill markdown frontmatter) can reuse it without depending on
// the legacy `Skill` card.
export { CommandField };

export class Skill extends CardDef {
  static displayName = 'Skill';
  static icon = RobotIcon;
  [isSkillCard] = true;

  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field instructions = contains(MarkdownField);
  @field commands = containsMany(CommandField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      <@fields.cardTitle />
    </template>
  };
}
