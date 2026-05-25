// KanbanColumnField — Lane configuration for a Kanban board.
// Each column represents a status/category lane.

import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import ColorField from 'https://cardstack.com/base/color';

import { FieldContainer } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

export class KanbanColumnField extends FieldDef {
  static displayName = 'Kanban Column';

  @field key = contains(StringField); // unique lane ID (e.g. "todo", "in-progress")
  @field label = contains(StringField); // display name ("To Do", "In Progress")
  @field color = contains(ColorField); // label accent color hex (e.g. "#3b82f6")
  @field wipLimit = contains(NumberField); // max cards (0 = unlimited)
  @field collapsed = contains(BooleanField);
  @field sortOrder = contains(NumberField); // lane display order

  static edit = class Edit extends Component<typeof KanbanColumnField> {
    <template>
      <div class='column-edit'>
        <div class='column-main'>
          <FieldContainer @label='Label' @tag='label' @vertical={{true}}>
            <@fields.label />
          </FieldContainer>
          <FieldContainer @label='Key' @tag='label' @vertical={{true}}>
            <@fields.key />
          </FieldContainer>
          <FieldContainer @label='Color' @tag='label' @vertical={{true}}>
            <@fields.color />
          </FieldContainer>
        </div>
        <div class='column-meta'>
          <FieldContainer @label='WIP Limit' @tag='label' @vertical={{true}}>
            <@fields.wipLimit />
          </FieldContainer>
          <FieldContainer @label='Sort Order' @tag='label' @vertical={{true}}>
            <@fields.sortOrder />
          </FieldContainer>
          <FieldContainer @label='Collapsed' @tag='label' @vertical={{true}}>
            <@fields.collapsed />
          </FieldContainer>
        </div>
      </div>
      <style scoped>
        .column-edit {
          display: grid;
          gap: var(--boxel-sp);
        }
        .column-main,
        .column-meta {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: var(--boxel-sp);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof KanbanColumnField> {
    <template>
      <span class='column-pill'>
        {{#if @model.color}}
          <span
            class='color-dot'
            style={{cssVar kanban-column-label-color=@model.color}}
          />
        {{/if}}
        <span
          class='column-label'
          style={{cssVar
            kanban-column-label-color=(if
              @model.color @model.color 'var(--foreground)'
            )
          }}
        >{{if @model.label @model.label 'Untitled'}}</span>
        {{#if @model.wipLimit}}
          <span class='wip-badge'>max {{@model.wipLimit}}</span>
        {{/if}}
      </span>
      <style scoped>
        .column-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          font-size: 11px;
          color: var(--foreground);
          background: color-mix(in oklab, var(--foreground) 5%, transparent);
          border-radius: var(--boxel-border-radius-xs);
        }
        .color-dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          flex-shrink: 0;
          background-color: var(--kanban-column-label-color);
        }
        .column-label {
          font-weight: 600;
          color: var(
            --kanban-column-label-color,
            var(--foreground, var(--boxel-dark))
          );
        }
        .wip-badge {
          font-size: 9px;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
