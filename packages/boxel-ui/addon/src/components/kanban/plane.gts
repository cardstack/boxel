// KanbanPlane — Public wrapper that owns the default drag manager.
import SquareKanban from '@cardstack/boxel-icons/square-kanban';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import type { FittedFormatId } from '../../helpers.ts';
import { type KanbanDragManagerArgs, KanbanDragManager } from './drag.gts';
import { type KanbanColumnConfig, type KanbanPlacement } from './engine.ts';
import { KanbanPlaneInner } from './plane-inner.gts';

export class KanbanPlane extends Component<{
  Args: {
    boardLabel?: string;
    cardSize?: FittedFormatId;
    columns: KanbanColumnConfig[];
    hideEmpty?: boolean;
    onAddCard?: (columnKey: string | null) => void;
    onChange?: (placements: KanbanPlacement[]) => void;
    onOpen?: (index: number) => void;
    onSelect?: (index: number | null) => void;
    onToggleCollapsed?: (column: KanbanColumnConfig | null) => void;
    placements: KanbanPlacement[];
  };
  Blocks: {
    card: [KanbanPlacement];
    ghost: [number];
  };
}> {
  private ownedManager: KanbanDragManager;

  constructor(owner: Owner, args: KanbanPlane['args']) {
    super(owner, args);

    let self = this;
    let managerArgs = {
      get columns() {
        return self.args.columns;
      },
      get columnCount() {
        return self.args.columns.length;
      },
      get isColumnVisible() {
        return self.isColumnVisible;
      },
      get onChange() {
        return self.handleChange;
      },
      get onOpen() {
        return self.handleOpen;
      },
      get onSelect() {
        return self.handleSelect;
      },
      get placements() {
        return self.args.placements;
      },
    } satisfies KanbanDragManagerArgs;

    this.ownedManager = new KanbanDragManager(managerArgs);
    registerDestructor(this, () => this.ownedManager.destroy());
  }

  handleChange = (placements: KanbanPlacement[]): void => {
    this.args.onChange?.(placements);
  };

  handleOpen = (index: number): void => {
    this.args.onOpen?.(index);
  };

  handleSelect = (index: number | null): void => {
    this.args.onSelect?.(index);
  };

  isColumnVisible = (colId: string): boolean => {
    let column = this.args.columns.find((c) => c.key === colId);
    return !column?.collapsed;
  };

  <template>
    {{#if @columns.length}}
      <KanbanPlaneInner
        class='kanban-plane'
        @boardLabel={{@boardLabel}}
        @cardSize={{@cardSize}}
        @columns={{@columns}}
        @hideEmpty={{@hideEmpty}}
        @manager={{this.ownedManager}}
        @onAddCard={{@onAddCard}}
        @onToggleCollapsed={{@onToggleCollapsed}}
        @placements={{@placements}}
        data-test-kanban-board
      >
        <:card as |placement|>
          {{yield placement to='card'}}
        </:card>
        <:ghost as |dragIndex|>
          {{yield dragIndex to='ghost'}}
        </:ghost>
      </KanbanPlaneInner>
    {{else}}
      <div class='kanban-empty-state'>
        <SquareKanban />
        <div class='kanban-empty-copy'>
          <h2>No content yet</h2>
          <p>
            Add columns and cards to this board to start organizing work.
          </p>
        </div>
      </div>
    {{/if}}
    <style scoped>
      .kanban-plane {
        --_kanban-bg: var(
          --boxel-kanban-bg,
          var(--background, var(--boxel-100))
        );
        --_kanban-fg: var(
          --boxel-kanban-fg,
          var(--foreground, var(--boxel-700))
        );
        --_kanban-card-bg: var(
          --boxel-kanban-card-bg,
          var(--card, var(--boxel-light))
        );
        --_kanban-card-fg: var(
          --boxel-kanban-card-fg,
          var(--card-foreground, var(--boxel-dark))
        );
        --_kanban-col-bg: var(
          --boxel-kanban-col-bg,
          var(--sidebar, var(--boxel-200))
        );
        --_kanban-col-fg: var(
          --boxel-kanban-col-fg,
          var(--sidebar-foreground, var(--boxel-dark))
        );
        --_kanban-ring: var(
          --boxel-kanban-ring,
          var(--ring, var(--boxel-highlight))
        );
        --_kanban-destructive: var(
          --boxel-kanban-destructive,
          var(--destructive, var(--boxel-danger))
        );
        --_kanban-destructive-fg: var(
          --boxel-kanban-destructive-fg,
          var(--destructive-foreground, var(--boxel-light-100))
        );
        --_kanban-primary: var(
          --boxel-kanban-primary,
          var(--primary, var(--boxel-highlight))
        );
        --_kanban-primary-fg: var(
          --boxel-kanban-primary-fg,
          var(--primary-foreground, var(--boxel-dark))
        );
        --_kanban-muted-opacity: var(--boxel-kanban-muted-opacity, 0.7);
        --_kanban-muted-fg: var(
          --boxel-kanban-muted-fg,
          var(--muted-foreground, var(--boxel-450))
        );
        --_kanban-radius: var(
          --boxel-kanban-radius,
          var(--radius, var(--boxel-border-radius-sm))
        );
        --_kanban-col-gap: 0.5rem; /* KANBAN_INSERTION_GAP_PX (8px) in JS calculations */
        --_kanban-border: var(
          --boxel-kanban-border,
          var(--border, var(--boxel-border-color))
        );
      }

      .kanban-empty-state {
        height: 100%;
        display: grid;
        place-items: center;
        padding: 2rem;
      }
      .kanban-empty-copy {
        max-width: 24rem;
        text-align: center;
        display: grid;
        gap: 0.5rem;
        padding: 1.5rem;
        border: 1px solid var(--_kanban-border);
        border-radius: 0.75rem;
        background: var(--_kanban-card-bg);
        color: var(--_kanban-card-fg);
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
      }
      .kanban-empty-copy h2,
      .kanban-empty-copy p {
        margin: 0;
      }
      .kanban-empty-copy h2 {
        font-size: 1rem;
        font-weight: 600;
      }
      .kanban-empty-copy p {
        font-size: 0.875rem;
        line-height: 1.5;
        color: var(--_kanban-muted-fg);
      }
      .kanban-empty-state :deep(svg) {
        width: 1.5rem;
        height: 1.5rem;
        margin: 0 auto 0.25rem;
        color: var(--_kanban-border);
      }
    </style>
  </template>
}
