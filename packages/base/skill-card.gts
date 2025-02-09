import BooleanField from './boolean';
import CodeRefField from './code-ref';
import MarkdownField from './markdown';
import {
  CardDef,
  Component,
  field,
  FieldDef,
  contains,
  containsMany,
} from './card-api';
import RobotIcon from '@cardstack/boxel-icons/robot';

export class CommandField extends FieldDef {
  static displayName = 'CommandField';
  @field codeRef = contains(CodeRefField, {
    description: 'An absolute code reference to the command to be executed',
  });
  @field requiresApproval = contains(BooleanField, {
    description:
      'If true, this command will require human approval before it is executed in the host.',
  });
}

export class SkillCard extends CardDef {
  static displayName = 'Skill';
  static icon = RobotIcon;
  @field instructions = contains(MarkdownField);
  @field commands = containsMany(CommandField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}
