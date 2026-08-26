import {
  CardDef,
  Component,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import ListTreeIcon from '@cardstack/boxel-icons/list-tree';

import { Task } from './task';
import { Tree, type TreeNode } from './components/tree';

function taskNode(task: Task): TreeNode<Task> {
  return {
    item: task,
    children: ((task.subtasks ?? []) as Task[]).filter(Boolean).map(taskNode),
  };
}

// Usage page for the Tree block: real Task cards with their subtasks as the
// nested structure, each row the consumer's own content (title + status).
export class TreeDemo extends CardDef {
  static displayName = 'Tree Demo';
  static icon = ListTreeIcon;

  @field records = linksToMany(() => Task);

  static isolated = class Isolated extends Component<typeof TreeDemo> {
    get roots(): TreeNode<Task>[] {
      return ((this.args.model?.records ?? []) as Task[])
        .filter(Boolean)
        .map(taskNode);
    }

    <template>
      <div class='demo'>
        <Tree @roots={{this.roots}} @emptyMessage='No tasks linked yet.'>
          <:row as |task meta|>
            <span class='row-title'>{{task.cardTitle}}</span>
            {{#if meta.hasChildren}}
              <span class='row-count'>{{meta.descendantCount}} subtasks</span>
            {{/if}}
            <span class='row-status'>{{task.status}}</span>
          </:row>
        </Tree>
      </div>
      <style scoped>
        .demo {
          max-width: 36rem;
          margin: 0 auto;
          padding: 1.5rem 1rem;
        }
        .row-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .row-count {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          margin-right: var(--boxel-sp-xs);
        }
        .row-status {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
      </style>
    </template>
  };
}
