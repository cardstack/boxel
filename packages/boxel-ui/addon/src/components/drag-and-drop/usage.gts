import { cssVar } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';
import { get } from 'lodash';

import Pill from '../pill/index.gts';
import DndKanbanBoard, { DndColumn } from './index.gts';

export default class DndUsage extends Component {
  @tracked columns = [
    new DndColumn('Todo', [
      { assignee: 'Justin', task: 'Implement a Todo App' },
      { assignee: 'Lucas', task: 'Create Boxel UI Component' },
      { assignee: 'Richard', task: 'Design a Chess App' },
      { assignee: 'Chuan', task: 'Research on Bug' },
    ]),
    new DndColumn('In progress', []),
    new DndColumn('Done', []),
  ];
  @tracked isLoading = false;
  @tracked isDisabled = false;

  @cssVariable({ cssClassName: 'dnd-kanban-freestyle-container' })
  declare dndKanbanHeaderBg: CSSVariableInfo;

  @cssVariable({ cssClassName: 'dnd-kanban-freestyle-container' })
  declare dndKanbanDropZoneBg: CSSVariableInfo;

  <template>
    <FreestyleUsage
      @name='Dnd Kanban Board'
      style={{cssVar
        dnd-kanban-header-bg=this.dndKanbanHeaderBg.value
        dnd-kanban-drop-zone-bg=this.dndKanbanDropZoneBg.value
      }}
    >
      <:description>
        This component implements a drag-and-drop Kanban board using
        ember-draggable-modifiers. It allows users to create custom
        functionality for column headers and design custom draggable cards. This
        flexibility enables developers to implement unique actions or menus
        within column headers. Users can also define their own draggable card
        designs with custom styles.
      </:description>
      <:example>
        <DndKanbanBoard
          @columns={{this.columns}}
          @isLoading={{this.isLoading}}
          @isDisabled={{this.isDisabled}}
        >
          <:card as |card column|>
            <div class='custom-card'>
              <Pill @kind='default' class='column-info'>
                {{column.title}}
              </Pill>
              <h3>{{get card 'assignee'}}</h3>
              <p>{{get card 'task'}}</p>
            </div>
          </:card>
        </DndKanbanBoard>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='columns'
          @description='Array of Column objects representing the kanban board columns'
          @required={{true}}
        />
        <Args.Bool
          @name='isLoading'
          @description='Indicates if the card is in a loading state. You can also use onMove arguments to experiment with the loading state, allowing for dynamic updates during card movements.'
          @optional={{true}}
          @onInput={{fn (mut this.isLoading)}}
          @value={{this.isLoading}}
        />
        <Args.Bool
          @name='isDisabled'
          @description='Disables all drag and drop features on the DndKanban board'
          @optional={{true}}
          @onInput={{fn (mut this.isDisabled)}}
          @value={{this.isDisabled}}
        />
        <Args.Action
          @name='onMove'
          @description='Custom callback function triggered when a card is moved'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='dnd-kanban-header-bg'
          @type='color'
          @description='Background color for kanban board headers'
          @defaultValue={{this.dndKanbanHeaderBg.defaults}}
          @value={{this.dndKanbanHeaderBg.value}}
          @onInput={{this.dndKanbanHeaderBg.update}}
        />
        <Css.Basic
          @name='dnd-kanban-drop-zone-bg'
          @type='color'
          @description='Background color for kanban board drop zones'
          @defaultValue={{this.dndKanbanDropZoneBg.defaults}}
          @value={{this.dndKanbanDropZoneBg.value}}
          @onInput={{this.dndKanbanDropZoneBg.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .custom-card {
        padding: var(--boxel-sp);
      }
      .column-info {
        display: table;
        margin-left: auto;
      }
    </style>
  </template>
}
