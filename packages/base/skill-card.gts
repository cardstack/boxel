import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from './card-api';
import BooleanField from './boolean';
import CodeRefField from './code-ref';
import MarkdownField from './markdown';
import StringField from './string';
import RobotIcon from '@cardstack/boxel-icons/robot';

function djb2_xor(str: string) {
  let len = str.length;
  let h = 5381;

  for (let i = 0; i < len; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

function friendlyModuleName(fullModuleUrl: string) {
  return fullModuleUrl
    .split('/')
    .slice(-1)[0]
    .replace(/\.gts$/, ' ');
}

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

      const hashed = djb2_xor(`${this.codeRef.module}#${this.codeRef.name}`);
      let name =
        this.codeRef.name === 'default'
          ? friendlyModuleName(this.codeRef.module)
          : this.codeRef.name;
      return `${name}_${hashed.slice(0, 4)}`;
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
