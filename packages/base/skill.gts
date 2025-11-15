import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  relativeTo,
} from './card-api';
import BooleanField from './boolean';
import { AbsoluteCodeRefField } from './code-ref';
import MarkdownField from './markdown';
import StringField from './string';
import RobotIcon from '@cardstack/boxel-icons/robot';
import SquareChevronRightIcon from '@cardstack/boxel-icons/square-chevron-right';
import { buildCommandFunctionName } from '@cardstack/runtime-common';

export const isSkillCard = Symbol.for('is-skill-card');

export class CommandField extends FieldDef {
  static displayName = 'CommandField';
  static icon = SquareChevronRightIcon;

  @field codeRef = contains(AbsoluteCodeRefField, {
    description: 'An absolute code reference to the command to be executed',
  });
  @field requiresApproval = contains(BooleanField, {
    description:
      'If true, this command will require human approval before it is executed in the host.',
  });

  @field functionName = contains(StringField, {
    description: 'The name of the function to be executed',
    computeVia: function (this: CommandField) {
      return buildCommandFunctionName(
        this.codeRef,
        this[Symbol.for('cardstack-relative-to') as typeof relativeTo],
      );
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
          border-left: var(--boxel-sp-4xs) solid var(--boxel-400);
          padding-left: var(--boxel-sp-xxs);
        }
        .icon {
          color: var(--boxel-400);
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

export class Skill extends CardDef {
  static displayName = 'Skill';
  static icon = RobotIcon;
  [isSkillCard] = true;

  @field title = contains(StringField);
  @field description = contains(StringField);
  @field instructions = contains(MarkdownField);
  @field commands = containsMany(CommandField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}
