import ChevronDown from '@cardstack/boxel-icons/chevron-down';
import ChevronUp from '@cardstack/boxel-icons/chevron-up';
import Eye from '@cardstack/boxel-icons/eye';
import EyeOff from '@cardstack/boxel-icons/eye-off';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { bool, cn, cssVar } from '../../helpers.ts';
import ContextButton from '../context-button/index.gts';
import FieldContainer from '../field-container/index.gts';
import IconButton from '../icon-button/index.gts';
import BoxelInput from '../input/index.gts';
import type { KanbanColumnConfig } from './engine.ts';

interface Signature {
  Args: {
    column: KanbanColumnConfig;
    isFirst?: boolean;
    isLast?: boolean;
    onColorChange?: (val: string) => void;
    onLabelChange?: (val: string) => void;
    onReorder?: (direction: 'up' | 'down') => void;
    onToggleCollapsed?: () => void;
    onWipLimitChange?: (val: string) => void;
    rowId: string;
  };
  Element: HTMLElement;
}

const KanbanColumnConfigSidebarRow: TemplateOnlyComponent<Signature> =
  <template>
    <li class='col-row' data-test-col-config-row={{@rowId}} ...attributes>
      {{#if @onReorder}}
        <div class='col-row-order'>
          <IconButton
            @icon={{ChevronUp}}
            @size='extra-small'
            @disabled={{@isFirst}}
            aria-label='Move column up'
            data-test-move-col-up-btn={{@rowId}}
            {{on 'click' (fn @onReorder 'up')}}
          />
          <IconButton
            @icon={{ChevronDown}}
            @size='extra-small'
            @disabled={{@isLast}}
            aria-label='Move column down'
            data-test-move-col-down-btn={{@rowId}}
            {{on 'click' (fn @onReorder 'down')}}
          />
        </div>
      {{/if}}
      {{#if @onColorChange}}
        <label class='col-color-wrap'>
          <span class='boxel-sr-only'>Color</span>
          <BoxelInput
            @type='color'
            @value={{if @column.color @column.color '#94a3b8'}}
            @onInput={{@onColorChange}}
            data-test-col-config-color={{@rowId}}
          />
        </label>
      {{else if @column.color}}
        <span class='col-dot' style={{cssVar col-dot-bg=@column.color}}></span>
      {{/if}}
      {{#if @onLabelChange}}
        <BoxelInput
          class='col-label-input'
          @value={{if @column.label @column.label ''}}
          @placeholder='Label'
          @onInput={{@onLabelChange}}
          aria-label='Column label'
          data-test-col-config-label={{@rowId}}
        />
      {{else}}
        {{#if @column.label}}{{@column.label}}{{else}}Column {{@rowId}}{{/if}}
      {{/if}}
      {{#if @onWipLimitChange}}
        <FieldContainer
          class='col-wip-field'
          @tag='label'
          @label='Max'
          @inline={{true}}
        >
          <BoxelInput
            @value={{if @column.wipLimit @column.wipLimit 0}}
            @type='number'
            @min={{0}}
            @onInput={{@onWipLimitChange}}
            data-test-col-config-wip={{@rowId}}
          />
        </FieldContainer>
      {{/if}}
      {{#if @onToggleCollapsed}}
        <ContextButton
          class={{cn 'col-visible-btn' is-hidden=@column.collapsed}}
          @isActive={{bool @column.collapsed}}
          @isToggle={{true}}
          @icon={{if @column.collapsed EyeOff Eye}}
          @size='extra-small'
          @label={{if @column.collapsed 'Show column' 'Hide column'}}
          @variant='ghost'
          data-test-col-config-toggle-visible={{@rowId}}
          {{on 'click' @onToggleCollapsed}}
        />
      {{/if}}
    </li>

    <style scoped>
      .col-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid
          color-mix(
            in oklch,
            var(
                --boxel-col-config-sidebar-border,
                var(--border, var(--boxel-border-color))
              )
              50%,
            transparent
          );
      }
      .col-row:last-child {
        border-bottom: none;
      }
      .col-row-order {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        flex-shrink: 0;
      }
      .col-color-wrap {
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }
      .col-label-input {
        flex: 1;
        min-width: 0;
      }
      .col-wip-field {
        --boxel-field-content-size: 3rem;
        --boxel-input-icon-size: 0;
        flex-shrink: 0;
      }
      .col-visible-btn {
        color: var(
          --_kanban-muted-fg,
          var(--muted-foreground, var(--boxel-500))
        );
      }
      .col-dot {
        width: 0.625rem;
        height: 0.625rem;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--col-dot-bg, var(--_kanban-muted-fg));
        box-shadow: 0 0 0 1.5px
          color-mix(in oklch, var(--col-dot-bg) 30%, transparent);
      }
    </style>
  </template>;

export default KanbanColumnConfigSidebarRow;
