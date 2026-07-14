import { Component, FieldDef, field, contains, relativeTo } from './card-api';
import BooleanField from './boolean';
import { AbsoluteCodeRefField } from './code-ref';
import { JsonField } from './json-field';
import StringField from './string';
import CommandIcon from '@cardstack/boxel-icons/square-chevron-right';
import { Pill } from '@cardstack/boxel-ui/components';
import { buildCommandFunctionName } from '@cardstack/runtime-common';

// A single tool attached to a skill: an absolute code reference plus the
// approval policy the host applies before invoking it. Shared by the legacy
// `Skill` card (`commands`) and by `SkillFrontmatterField` (skill markdown
// frontmatter, `boxel.tools`).
export class ToolField extends FieldDef {
  static displayName = 'ToolField';
  static icon = CommandIcon;

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ToolField) {
      let moduleRef = this.codeRef?.module;
      if (!moduleRef) {
        return 'Untitled Tool';
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
    description: 'An absolute code reference to the tool to be executed',
  });
  @field requiresApproval = contains(BooleanField, {
    description:
      'If true, this tool will require human approval before it is executed in the host.',
  });

  // The tool's ready-to-use LLM tool definition (`{ type: 'function',
  // function: { name, description, parameters } }`), generated from the tool
  // class's input schema at indexing time and stamped onto the skill's
  // file-meta resource. Present only on tools rehydrated from an enriched
  // index row — a tool authored in frontmatter has no value here until the
  // file indexes. Consumers that need a definition and find none must
  // generate it themselves (see the host's `uploadToolDefinitions`).
  @field definition = contains(JsonField);

  @field functionName = contains(StringField, {
    description: 'The name of the function to be executed',
    computeVia: function (this: ToolField) {
      // Resolve the code ref in RRI space (no VirtualNetwork). `codeRef` is a
      // canonical (absolute) code ref; relative modules join against the
      // instance's relative-to base.
      return buildCommandFunctionName(
        this.codeRef,
        this[Symbol.for('cardstack-relative-to') as typeof relativeTo],
      );
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='tool-compact'>
        <CommandIcon class='tool-icon' />
        <div class='tool-info'>
          <div class='tool-title'>{{@model.cardTitle}}</div>
          <div class='tool-meta'>
            <code
              class='tool-path'
            >{{@model.codeRef.module}}/{{@model.codeRef.name}}</code>
          </div>
          {{#if @model.requiresApproval}}
            <div>
              <Pill class='tool-label'>Requires Approval</Pill>
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .tool-compact {
          --muted-color: color-mix(in lab, var(--muted) 60%, var(--foreground));
          display: flex;
          gap: var(--boxel-sp-3xs);
          padding: var(--boxel-sp-xs);
          background-color: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-border-radius));
        }
        .tool-icon {
          color: var(--muted-color, var(--boxel-400));
          flex-shrink: 0;
        }
        .tool-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-3xs);
          padding-left: var(--boxel-sp-2xs);
          border-left: 3px solid var(--muted-color, var(--boxel-400));
        }
        .tool-title {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
        }
        .tool-meta {
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--muted-foreground, var(--boxel-700));
        }
        .tool-path {
          word-break: break-all;
        }
        .tool-label {
          font-size: var(--boxel-font-size-2xs);
          letter-spacing: var(--boxel-lsp-lg);
        }
      </style>
    </template>
  };
}

// Pre-rename spelling of `ToolField`; new code imports `ToolField`.
export { ToolField as CommandField };
