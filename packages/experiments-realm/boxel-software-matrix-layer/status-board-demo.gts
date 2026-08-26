import {
  CardDef,
  Component,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import SquareKanbanIcon from '@cardstack/boxel-icons/square-kanban';

import { Task, TaskStatusField } from './task';
import { StatusBoard } from './components/status-board';

// Usage page for the StatusBoard block: real Task cards laid out by the
// Task lifecycle. Read-only — no onMove, so drags are inert; a consumer
// wires onMove to its own status-writing command.
export class StatusBoardDemo extends CardDef {
  static displayName = 'Status Board Demo';
  static icon = SquareKanbanIcon;

  @field records = linksToMany(() => Task);

  static isolated = class Isolated extends Component<typeof StatusBoardDemo> {
    statusOf = (item: CardDef) => (item as Task).status;

    <template>
      <div class='demo'>
        <StatusBoard
          @boardLabel='Tasks by status'
          @items={{@model.records}}
          @statusField={{TaskStatusField}}
          @statusOf={{this.statusOf}}
        />
      </div>
      <style scoped>
        .demo {
          height: 100%;
          min-height: 480px;
          padding: 1rem;
          box-sizing: border-box;
        }
      </style>
    </template>
  };
}
