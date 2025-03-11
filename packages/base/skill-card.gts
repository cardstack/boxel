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
import SquareChevronRightIcon from '@cardstack/boxel-icons/square-chevron-right';
import { simpleHash } from '@cardstack/runtime-common';

function friendlyModuleName(fullModuleUrl: string) {
  return fullModuleUrl
    .split('/')
    .pop()!
    .replace(/\.gts$/, '');
}

export class CommandField extends FieldDef {
  static displayName = 'CommandField';
  static icon = SquareChevronRightIcon;

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

      const hashed = simpleHash(`${this.codeRef.module}#${this.codeRef.name}`);
      let name =
        this.codeRef.name === 'default'
          ? friendlyModuleName(this.codeRef.module)
          : this.codeRef.name;
      return `${name}_${hashed.slice(0, 4)}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='command-embedded'>
        <SquareChevronRightIcon class='icon' />
        <div class='command-data'>
          <div>
            Module:
            {{@model.codeRef.module}}
          </div>
          <div>
            Name:
            {{@model.codeRef.name}}
          </div>
          <div class='requires-approval'>
            Requires Approval:
            <@fields.requiresApproval />
          </div>
          <div class='function-name'>
            Function Name (computed):
            <@fields.functionName />
          </div>
        </div>
      </div>
      <style scoped>
        .command-embedded {
          display: flex;
          align-items: top;
          justify-content: stretch;
          gap: var(--boxel-sp-xxs);
        }
        .command-data {
          flex-grow: 1;
          border-left: var(--boxel-sp-4xs) solid var(--boxel-purple-300);
          padding-left: var(--boxel-sp-xxs);
        }
        .icon {
          color: var(--boxel-purple-300);
          margin-top: var(--boxel-sp-xxs);
          width: 30px;
          height: 30px;
        }
        .requires-approval,
        .function-name {
          margin-top: var(--boxel-sp-xxs);
        }
      </style>
    </template>
  };
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
