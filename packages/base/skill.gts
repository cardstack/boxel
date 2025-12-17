import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  type BaseDefComponent,
} from './card-api';
import MarkdownField from './markdown';
import CommandField from './command-ref';
import RobotIcon from '@cardstack/boxel-icons/robot';

export { CommandField };

export const isSkillCard = Symbol.for('is-skill-card');

export class Skill extends CardDef {
  static displayName = 'Skill';
  static icon = RobotIcon;
  [isSkillCard] = true;

  @field instructions = contains(MarkdownField);
  @field commands = containsMany(CommandField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      <@fields.title />
    </template>
  };
}
