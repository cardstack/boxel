import { cssVar } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import { get } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import Pill from '../pill/index.gts';
import DndKanbanBoard, {
  type ColumnHeaderArgs,
  Card,
  Column,
} from './index.gts';

export default class DndUsage extends Component {
  @tracked columns = [
    new Column('Todo', [
      new Card({ assignee: 'Justin', task: 'Climbing on the Tree' }),
      new Card({ assignee: 'Lucas', task: 'Driving on car' }),
      new Card({ assignee: 'Richard', task: 'Build on house' }),
      new Card({ assignee: 'Chuan', task: 'RUN on bot' }),
    ]),
    new Column('In progress', []),
    new Column('Done', []),
  ];

  @cssVariable({ cssClassName: 'dnd-kanban-freestyle-container' })
  declare dndKanbanHeaderBg: CSSVariableInfo;

  @cssVariable({ cssClassName: 'dnd-kanban-freestyle-container' })
  declare dndKanbanDropZoneBg: CSSVariableInfo;

  @action handleColumnMove(newColumns: Column[]) {
    this.columns = newColumns;
  }

  @action handleCardMove(newColumns: Column[]) {
    this.columns = newColumns;
  }

  <template>
    <FreestyleUsage
      @name='Dnd Kanban Board'
      style={{cssVar
        dnd-kanban-header-bg=this.dndKanbanHeaderBg.value
        dnd-kanban-drop-zone-bg=this.dndKanbanDropZoneBg.value
      }}
    >
      <:example>
        <DndKanbanBoard
          @columns={{this.columns}}
          @columnHeader={{ColumnHeader}}
          as |card column|
        >
          <div class='custom-card'>
            <Pill @kind='default' class='column-info'>
              {{column.title}}
            </Pill>
            <h3>{{get card 'assignee'}}</h3>
            <p>{{get card 'task'}}</p>
          </div>
        </DndKanbanBoard>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='columns'
          @description='Array of Column objects representing the kanban board columns'
          @required={{true}}
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
      .column-info {
        display: table;
        margin-left: auto;
      }
    </style>
  </template>
}

class ColumnHeader extends Component<ColumnHeaderArgs> {
  <template>
    <div class='custom-header'>
      {{@title}}
    </div>
    <style scoped>
      .custom-header {
        display: flex;
        justify-content: space-between;
      }
    </style>
  </template>
}
