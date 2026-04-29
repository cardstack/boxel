// KanbanPlane — Public wrapper that owns the default drag manager.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import type { FittedFormatId } from '../../helpers.ts';
import { type KanbanDragManagerSignature, KanbanDragManager } from './drag.gts';
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
    } satisfies KanbanDragManagerSignature['Args'];

    this.ownedManager = new KanbanDragManager(owner, managerArgs);
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
      @boardLabel={{@boardLabel}}
      @cardSize={{@cardSize}}
      @columns={{@columns}}
      @hideEmpty={{@hideEmpty}}
      @manager={{this.ownedManager}}
      @onAddCard={{@onAddCard}}
      @placements={{@placements}}
    >
      <:card as |placement|>
        {{yield placement to='card'}}
      </:card>
      <:ghost as |dragIndex|>
        {{yield dragIndex to='ghost'}}
      </:ghost>
    </KanbanPlaneInner>
  </template>
}
