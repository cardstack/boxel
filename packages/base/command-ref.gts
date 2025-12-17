import { Component, FieldDef, field, contains, relativeTo } from './card-api';
import BooleanField from './boolean';
import { AbsoluteCodeRefField } from './code-ref';
import StringField from './string';
import CommandIcon from '@cardstack/boxel-icons/square-chevron-right';
import { Pill } from '@cardstack/boxel-ui/components';
import { buildCommandFunctionName } from '@cardstack/runtime-common';

export default class CommandField extends FieldDef {
  static displayName = 'CommandField';
  static icon = CommandIcon;

  @field title = contains(StringField, {
    computeVia: function (this: CommandField) {
      let moduleRef = this.codeRef?.module;
      if (!moduleRef) {
        return 'Untitled Command';
      }
      let nameSegment = moduleRef.split('/').pop();
      let formattedName = nameSegment
        ?.split(/[-_]/g)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      return formattedName;
    },
  });

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
      <div class='command-compact'>
        <CommandIcon class='command-icon' />
        <div class='command-info'>
          <div class='command-title'>{{@model.title}}</div>
          <div class='command-meta'>
            <code
              class='command-path'
            >{{@model.codeRef.module}}/{{@model.codeRef.name}}</code>
          </div>
          {{#if @model.requiresApproval}}
            <div>
              <Pill class='command-label'>Requires Approval</Pill>
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .command-compact {
          --muted-color: color-mix(in lab, var(--muted) 60%, var(--foreground));
          display: flex;
          gap: var(--boxel-sp-3xs);
          padding: var(--boxel-sp-xs);
          background-color: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-border-radius));
        }
        .command-icon {
          color: var(--muted-color, var(--boxel-400));
          flex-shrink: 0;
        }
        .command-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-3xs);
          padding-left: var(--boxel-sp-2xs);
          border-left: 3px solid var(--muted-color, var(--boxel-400));
        }
        .command-title {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
        }
        .command-meta {
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--muted-foreground, var(--boxel-700));
        }
        .command-path {
          word-break: break-all;
        }
        .command-label {
          font-size: var(--boxel-font-size-2xs);
          letter-spacing: var(--boxel-lsp-lg);
        }
      </style>
    </template>
  };
}
