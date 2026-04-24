import {
  KanbanDragManager,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

import type { Issue, Project } from './darkfactory';
import type { IssueOptionField } from './issue-option';
import { KanbanColumnField } from './kanban-column';
import { defaultColumns, type Option } from './kanban-config';

type GroupByOption = { displayName: string; sort: string };

type ProjectKanbanModel = {
  id?: string | null;
  groupBy?: string | null;
  hideEmptyColumns?: boolean | null;
  issues?: Issue[];
  issuePriorityOptions?: IssueOptionField[];
  issueStatusOptions?: IssueOptionField[];
  issueTypeOptions?: IssueOptionField[];
  statusColumnConfig?: KanbanColumnField[];
  priorityColumnConfig?: KanbanColumnField[];
  typeColumnConfig?: KanbanColumnField[];
};

type CreateCardInput = {
  realmURL?: URL;
  doc: {
    data: {
      type: 'card';
      attributes: Record<string, string>;
      relationships: {
        project: { links: { self: string | null } };
      };
      meta: {
        adoptsFrom: IssueCodeRef;
      };
    };
  };
};

type IssueCodeRef = {
  module: string;
  name: string;
};

export class ProjectKanbanController {
  dragManager: KanbanDragManager;
  private orderInitPending = false;

  constructor(
    private getModel: () => Project | undefined,
    private getRealmURL: () => URL | undefined,
    private issueCodeRef: IssueCodeRef,
    private createCard?: (
      codeRef: IssueCodeRef,
      codeRefURL: URL,
      input: CreateCardInput,
    ) => Promise<unknown>,
    private viewCard?: (card: Issue, format: 'isolated') => void,
    private onSelect?: (index: number) => void,
  ) {
    this.dragManager = new KanbanDragManager({
      placements: () => this.kanbanPlacements,
      columnCount: () => this.kanbanColumns.length || 4,
      containerElement: () => null,
      onChange: (newPlacements) => this.commitPlacements(newPlacements),
      onSelect: (index) => {
        this.onSelect?.(index);
      },
      onOpen: (index) => {
        const card = this.model?.issues?.[index];
        if (card) {
          this.viewCard?.(card, 'isolated');
        }
      },
    });
  }

  get manager(): KanbanDragManager {
    return this.dragManager;
  }

  get model(): ProjectKanbanModel | undefined {
    return this.getModel();
  }

  get kanbanPlacements(): KanbanPlacement[] {
    const placements = this.computePlacements();
    this.scheduleOrderInit(placements);
    return placements;
  }

  get kanbanColumns(): KanbanColumnConfig[] {
    const model = this.model;
    if (!model) return [];
    const source = this.groupBySource;
    const boardOptionsByGroup: Record<string, IssueOptionField[]> = {
      priority: model.issuePriorityOptions ?? [],
      issueType: model.issueTypeOptions ?? [],
      status: model.issueStatusOptions ?? [],
    };
    const configByGroup: Record<string, KanbanColumnField[]> = {
      issueType: model.typeColumnConfig ?? [],
      priority: model.priorityColumnConfig ?? [],
      status: model.statusColumnConfig ?? [],
    };
    const boardOptions = boardOptionsByGroup[source.value];
    const options: Option[] = boardOptions?.length
      ? (boardOptions as Option[])
      : source.options;
    const config = configByGroup[source.value] ?? [];

    return options
      .map((option, index) => {
        const stored = config.find((column) => column.key === option.value);
        return {
          key: option.value,
          label: option.label,
          color: stored?.color ?? option.color ?? null,
          wipLimit: stored?.wipLimit ?? null,
          collapsed: stored?.collapsed ?? null,
          sortOrder: stored?.sortOrder ?? index,
        };
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  get cardCount(): number {
    return this.model?.issues?.length ?? 0;
  }

  get groupBySource() {
    const groupBy = this.model?.groupBy;
    return (
      defaultColumns.find((option) => option.value === groupBy) ??
      defaultColumns[0]!
    );
  }

  get groupByOptions(): GroupByOption[] {
    return defaultColumns.map(({ value, label }) => ({
      displayName: label,
      sort: value,
    }));
  }

  get selectedGroupByOption(): GroupByOption | undefined {
    const groupBy = this.model?.groupBy ?? 'status';
    return this.groupByOptions.find((option) => option.sort === groupBy);
  }

  get hideEmptyColumns(): boolean {
    return Boolean(this.model?.hideEmptyColumns);
  }

  setGroupBy(groupBy: string): void {
    const model = this.model;
    if (!model || model.groupBy === groupBy) return;
    model.groupBy = groupBy;
  }

  toggleHideEmptyColumns(): void {
    const model = this.model;
    if (!model) return;
    model.hideEmptyColumns = !this.hideEmptyColumns;
  }

  async addCardToColumn(columnKey: string | null | undefined): Promise<void> {
    if (!columnKey || !this.createCard) return;
    const model = this.model;
    if (!model) return;

    const attributeName = this.groupBySource.fieldName;
    const projectCardId = model.id ?? null;

    await this.createCard(
      this.issueCodeRef,
      new URL(this.issueCodeRef.module),
      {
        realmURL: this.getRealmURL(),
        doc: {
          data: {
            type: 'card',
            attributes: { [attributeName]: columnKey },
            relationships: {
              project: { links: { self: projectCardId } },
            },
            meta: { adoptsFrom: this.issueCodeRef },
          },
        },
      },
    );
  }

  setColumnColor(key: string | null | undefined, color: string): void {
    if (!key) return;
    this.setColumnConfig(key, { color });
  }

  setColumnWipLimit(key: string | null | undefined, raw: number): void {
    if (!key) return;
    this.setColumnConfig(key, {
      wipLimit: Number.isNaN(raw) || raw <= 0 ? null : raw,
    });
  }

  setColumnCollapsed(key: string | null | undefined, collapsed: boolean): void {
    if (!key) return;
    this.setColumnConfig(key, { collapsed });
  }

  moveColUp(key: string | null | undefined): void {
    if (!key) return;
    const cols = this.kanbanColumns;
    const index = cols.findIndex((column) => column.key === key);
    if (index <= 0) return;
    const current = cols[index]!;
    const previous = cols[index - 1]!;
    const currentOrder = current.sortOrder ?? index;
    const previousOrder = previous.sortOrder ?? index - 1;
    this.setColumnConfig(current.key!, { sortOrder: previousOrder });
    this.setColumnConfig(previous.key!, { sortOrder: currentOrder });
  }

  moveColDown(key: string | null | undefined): void {
    if (!key) return;
    const cols = this.kanbanColumns;
    const index = cols.findIndex((column) => column.key === key);
    if (index < 0 || index >= cols.length - 1) return;
    const current = cols[index]!;
    const next = cols[index + 1]!;
    const currentOrder = current.sortOrder ?? index;
    const nextOrder = next.sortOrder ?? index + 1;
    this.setColumnConfig(current.key!, { sortOrder: nextOrder });
    this.setColumnConfig(next.key!, { sortOrder: currentOrder });
  }

  private computePlacements(): KanbanPlacement[] {
    const cards = this.model?.issues ?? [];
    const columns = this.kanbanColumns;
    if (cards.length === 0) return [];
    const maxSortOrder: Record<number, number> = {};
    const source = this.groupBySource;

    return cards.map((card, index) => {
      const value = this.getCardValue(card, source.fieldName);
      const colIndex = columns.findIndex((column) => column.key === value);
      const column = colIndex >= 0 ? colIndex : 0;
      const stored = this.getCardValue(card, source.orderField);

      if (stored != null && typeof stored === 'number') {
        maxSortOrder[column] = Math.max(maxSortOrder[column] ?? 0, stored);
        return { index, column, sortOrder: stored };
      }

      maxSortOrder[column] = (maxSortOrder[column] ?? 0) + 1;
      return { index, column, sortOrder: maxSortOrder[column]! };
    });
  }

  private scheduleOrderInit(placements: KanbanPlacement[]): void {
    if (this.orderInitPending) return;
    const cards = this.model?.issues ?? [];
    const orderField = this.groupBySource.orderField;
    const uninitialized = placements.filter(
      (placement) =>
        cards[placement.index] &&
        this.getCardValue(cards[placement.index]!, orderField) == null,
    );
    if (uninitialized.length === 0) return;

    this.orderInitPending = true;
    Promise.resolve().then(() => {
      this.orderInitPending = false;
      for (const placement of uninitialized) {
        const card = cards[placement.index];
        if (card && this.getCardValue(card, orderField) == null) {
          this.setCardValue(card, orderField, placement.sortOrder);
        }
      }
    });
  }

  private commitPlacements(newPlacements: KanbanPlacement[]): void {
    const cards = this.model?.issues;
    if (!cards) return;
    const columns = this.kanbanColumns;
    const source = this.groupBySource;

    for (const placement of newPlacements) {
      const card = cards[placement.index];
      const column = columns[placement.column];
      if (!card || !column) continue;
      if (this.getCardValue(card, source.fieldName) !== column.key) {
        this.setCardValue(card, source.fieldName, column.key);
      }
      if (this.getCardValue(card, source.orderField) !== placement.sortOrder) {
        this.setCardValue(card, source.orderField, placement.sortOrder);
      }
    }
  }

  private get activeColumnConfig(): KanbanColumnField[] {
    const model = this.model;
    if (!model) return [];
    const groupBy = model.groupBy ?? 'status';
    if (groupBy === 'issueType') return model.typeColumnConfig ?? [];
    if (groupBy === 'priority') return model.priorityColumnConfig ?? [];
    return model.statusColumnConfig ?? [];
  }

  private setColumnConfig(key: string, patch: Record<string, unknown>): void {
    const cols = this.activeColumnConfig;
    const config = cols.find((column) => column.key === key) as
      | (KanbanColumnField & Record<string, unknown>)
      | undefined;

    if (config) {
      for (const [patchKey, value] of Object.entries(patch)) {
        config[patchKey] = value;
      }
      return;
    }

    cols.push(new KanbanColumnField({ key, ...patch }));
  }

  private getCardValue(card: Issue, key: string): unknown {
    return (card as unknown as Record<string, unknown>)[key];
  }

  private setCardValue(card: Issue, key: string, value: unknown): void {
    (card as unknown as Record<string, unknown>)[key] = value;
  }
}
