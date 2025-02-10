import BooleanField from './boolean';
import CodeRefField from './code-ref';
import MarkdownField from './markdown';
import StringField from './string';
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

  @field functionName = contains(StringField, {
    description: 'The name of the function to be executed',
    computeVia: function (this: CommandField) {
      if (!this.codeRef?.module || !this.codeRef?.name) {
        return '';
      }

      // Simple hash function that works in all environments
      const djb2 = (str: string): string => {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(16).slice(0, 4);
      };

      const input = `${this.codeRef.module}#${this.codeRef.name}`;
      return `${this.codeRef.name}_${djb2(input)}`;
    },
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
