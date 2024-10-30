import MarkdownField from './markdown';
import { CardDef, Component, field, contains } from './card-api';
import RobotIcon from '@cardstack/boxel-icons/robot';

export class SkillCard extends CardDef {
  static displayName = 'Skill';
  static icon = RobotIcon;
  @field instructions = contains(MarkdownField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}
