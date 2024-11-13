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
    new DndColumn('In Progress', []),
    new DndColumn('Done', []),
  ];
  @tracked isLoading = false;

  @cssVariable({ cssClassName: 'dnd-freestyle-container' })
  declare dndContainerGap: CSSVariableInfo;
  @cssVariable({ cssClassName: 'dnd-freestyle-container' })
  declare dndColumnBorderRadius: CSSVariableInfo;
  @cssVariable({ cssClassName: 'dnd-freestyle-container' })
  declare dndHeaderBg: CSSVariableInfo;
  @cssVariable({ cssClassName: 'dnd-freestyle-container' })
  declare dndDropZoneBg: CSSVariableInfo;

  <template>
    <FreestyleUsage
      @name='Dnd Kanban Board'
      style={{cssVar
        dnd-container-gap=this.dndContainerGap.value
        dnd-column-border-radius=this.dndColumnBorderRadius.value
        dnd-header-bg=this.dndHeaderBg.value
        dnd-drop-zone-bg=this.dndDropZoneBg.value
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
        <div class='dnd-wrapper'>
          <DndKanbanBoard
            @columns={{this.columns}}
            @isLoading={{this.isLoading}}
          >
            <:header as |column|>
              {{column.title}}
            </:header>
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
        </div>
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
        <Args.Action
          @name='onMove'
          @description='Custom callback function triggered when a card is moved'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='dnd-container-gap'
          @type='length'
          @description='Gap between columns in the kanban board - px'
          @defaultValue={{this.dndContainerGap.defaults}}
          @value={{this.dndContainerGap.value}}
          @onInput={{this.dndContainerGap.update}}
        />
        <Css.Basic
          @name='dnd-column-border-radius'
          @type='length'
          @description='Border radius for kanban board columns'
          @defaultValue={{this.dndColumnBorderRadius.defaults}}
          @value={{this.dndColumnBorderRadius.value}}
          @onInput={{this.dndColumnBorderRadius.update}}
        />
        <Css.Basic
          @name='dnd-header-bg'
          @type='color'
          @description='Background color for kanban board headers'
          @defaultValue={{this.dndHeaderBg.defaults}}
          @value={{this.dndHeaderBg.value}}
          @onInput={{this.dndHeaderBg.update}}
        />
        <Css.Basic
          @name='dnd-drop-zone-bg'
          @type='color'
          @description='Background color for kanban board drop zones'
          @defaultValue={{this.dndDropZoneBg.defaults}}
          @value={{this.dndDropZoneBg.value}}
          @onInput={{this.dndDropZoneBg.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .dnd-wrapper {
        height: 600px;
      }
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
