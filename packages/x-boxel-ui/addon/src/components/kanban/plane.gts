// KanbanPlane — Public wrapper that owns the default drag manager.
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
    onShowEmptyColumns?: () => void;
    onToggleCollapsed?: (columnKey: string | null, collapsed: boolean) => void;
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

  isColumnVisible = (colIndex: number): boolean => {
    let column = this.args.columns[colIndex];
    if (!column || column.collapsed) {
      return false;
    }
    if (!this.args.hideEmpty) {
      return true;
    }
    return this.args.placements.some(
      (placement) => placement.column === colIndex,
    );
  };

  <template>
    <KanbanPlaneInner
      class='kanban-plane'
      @boardLabel={{@boardLabel}}
      @cardSize={{@cardSize}}
      @columns={{@columns}}
      @hideEmpty={{@hideEmpty}}
      @manager={{this.ownedManager}}
      @onAddCard={{@onAddCard}}
      @onToggleCollapsed={{@onToggleCollapsed}}
      @onShowEmptyColumns={{@onShowEmptyColumns}}
      @placements={{@placements}}
    >
      <:card as |placement|>
        {{yield placement to='card'}}
      </:card>
      <:ghost as |dragIndex|>
        {{yield dragIndex to='ghost'}}
      </:ghost>
    </KanbanPlaneInner>

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
        --_kanban-muted-fg: var(--muted-foreground, var(--boxel-450));
        --_kanban-radius: var(
          --boxel-kanban-radius,
          var(--radius, var(--boxel-border-radius-sm))
        );
        --_kanban-col-gap: 0.5rem; /* KANBAN_INSERTION_GAP_PX (8px) in JS calculations */
      }
    </style>
  </template>
}
