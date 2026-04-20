// KanbanCard — Kanban board with insertion-based drag engine.
// No wells at rest. Insertion gaps open between cards during drag.

import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksToMany,
  realmURL,
} from '../card-api';
import {
  ContextButton,
  FieldContainer,
  Pill,
  SortDropdown,
  Switch,
} from '@cardstack/boxel-ui/components';
import StringField from '../string';
import BooleanField from '../boolean';
import DateField from '../date';
import enumField from '../enum';
import MarkdownField from '../markdown';
import { tracked } from '@glimmer/tracking';
import { fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import KanbanIcon from '@cardstack/boxel-icons/columns-3';
import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import { KanbanColumnField } from './kanban-column';
import { KanbanPlane } from './kanban-plane';
import { KanbanDragManager } from './kanban-drag';
import { type KanbanPlacement } from './kanban-engine';
import {
  IssueOptionField,
  Issue,
  makeIssueOptionFields,
  issueStatusOptions,
  issuePriorityOptions,
  issueTypeOptions,
  projectStatusOptions,
  getStatusVariant,
} from './issue';

const issueSource = {
  module: 'https://cardstack.com/base/issue-tracker/issue',
  name: 'Issue',
};

const defaultColumnOptions: {
  value: string;
  label: string;
  fieldName: string; // field to read for column matching
  writeFieldName: string; // field to write when dragging across columns (must be stored)
  orderField: string;
  options: { value: string; label: string }[];
}[] = [
  {
    value: 'status',
    label: 'Status',
    fieldName: 'computedStatus',
    writeFieldName: 'status',
    orderField: 'statusBoardOrder',
    options: issueStatusOptions,
  },
  {
    value: 'priority',
    label: 'Priority',
    fieldName: 'priority',
    writeFieldName: 'priority',
    orderField: 'priorityBoardOrder',
    options: issuePriorityOptions,
  },
  {
    value: 'issueType',
    label: 'Type',
    fieldName: 'issueType',
    writeFieldName: 'issueType',
    orderField: 'issueTypeBoardOrder',
    options: issueTypeOptions,
  },
];

function defaultThemeColumnColor(
  groupBy: string,
  optionValue: string,
  index: number,
): string {
  if (groupBy === 'status') {
    switch (optionValue) {
      case 'backlog':
        return 'var(--muted-foreground)';
      case 'in_progress':
      case 'in-progress':
      case 'active':
        return 'var(--primary)';
      case 'review':
      case 'in-review':
      case 'completed':
        return 'var(--accent)';
      case 'blocked':
      case 'on_hold':
        return 'var(--destructive)';
      case 'done':
      case 'archived':
        return 'var(--secondary)';
      default:
        return 'var(--primary)';
    }
  }

  if (groupBy === 'priority') {
    switch (optionValue) {
      case 'critical':
        return 'var(--destructive)';
      case 'high':
        return 'var(--primary)';
      case 'medium':
        return 'var(--accent)';
      case 'low':
        return 'var(--muted-foreground)';
      default:
        return 'var(--primary)';
    }
  }

  const typePalette = [
    'var(--primary)',
    'var(--accent)',
    'var(--secondary)',
    'var(--muted-foreground)',
  ];
  return typePalette[index % typePalette.length]!;
}

class Isolated extends Component<typeof KanbanBoard> {
  @tracked selectedCardIndex: number | null = null;
  @tracked showSettings = false;
  dragManager: KanbanDragManager | null = null;
  private orderInitPending = false;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.initManager();
  }

  initManager(): void {
    this.dragManager = new KanbanDragManager({
      placements: () => this.kanbanPlacements,
      columnCount: () => this.kanbanColumns.length || 4,
      containerElement: () => null,
      onChange: (newPlacements) => this.commitPlacements(newPlacements),
      onSelect: (index) => {
        this.selectedCardIndex = index;
      },
      onOpen: (index) => {
        const card = (this.args.model?.cards as any[])?.[index];
        if (card) this.args.viewCard?.(card, 'isolated');
      },
    });
  }

  get kanbanPlacements(): KanbanPlacement[] {
    const cards = this.args.model?.cards ?? [];
    const columns = this.args.model?.columns ?? [];
    if ((cards as any[]).length === 0) return [];
    const maxSortOrder: Record<number, number> = {};
    const groupBy = this.args.model?.groupBy;
    const source =
      defaultColumnOptions.find((o) => o.value === groupBy) ??
      defaultColumnOptions[0]!;
    const placements = (cards as any[]).map((card: any, index: number) => {
      const value = card[source.fieldName];
      const colIndex = (columns as any[]).findIndex(
        (col: any) => col.key === value,
      );
      const column = colIndex >= 0 ? colIndex : 0;
      const stored = card[source.orderField];
      let sortOrder: number;
      if (stored != null) {
        sortOrder = stored;
        maxSortOrder[column] = Math.max(maxSortOrder[column] ?? 0, stored);
      } else {
        maxSortOrder[column] = (maxSortOrder[column] ?? 0) + 1;
        sortOrder = maxSortOrder[column];
      }
      return { index, column, sortOrder };
    });

    // Persist default order for cards that don't have one yet (e.g. newly added).
    // Deferred so the write doesn't happen during rendering.
    const uninitialized = placements.filter(
      (p) => (cards as any[])[p.index]?.[source.orderField] == null,
    );
    if (uninitialized.length > 0 && !this.orderInitPending) {
      this.orderInitPending = true;
      const orderField = source.orderField;
      Promise.resolve().then(() => {
        this.orderInitPending = false;
        for (const p of uninitialized) {
          const card = (cards as any[])[p.index];
          if (card && card[orderField] == null) {
            card[orderField] = p.sortOrder;
          }
        }
      });
    }

    return placements;
  }

  get manager(): KanbanDragManager {
    // ²²
    if (!this.dragManager) this.initManager();
    return this.dragManager!;
  }

  get kanbanColumns(): KanbanColumnField[] {
    return this.args.model?.columns ?? [];
  }

  get cardCount(): number {
    return this.args.model?.cards?.length ?? 0;
  }

  get realmURL(): URL | undefined {
    return (this.args.model as any)[realmURL];
  }

  addCardToColumn = async (
    columnKey: string | null | undefined,
  ): Promise<void> => {
    if (!columnKey) return;
    const model = this.args.model;
    if (!model) return;

    const source =
      defaultColumnOptions.find((o) => o.value === (model as any).groupBy) ??
      defaultColumnOptions[0]!;
    const attributeName = source.writeFieldName;
    const kanbanBoardId = (model as any).id ?? null;

    await this.args.createCard?.(issueSource, new URL(issueSource.module), {
      realmURL: this.realmURL,
      doc: {
        data: {
          type: 'card',
          attributes: { [attributeName]: columnKey },
          relationships: {
            kanbanBoard: { links: { self: kanbanBoardId } },
          },
          meta: { adoptsFrom: issueSource },
        },
      },
    });
  };

  get groupByOptions(): { displayName: string; sort: string }[] {
    return defaultColumnOptions.map(({ value, label }) => ({
      displayName: label,
      sort: value,
    }));
  }

  get selectedGroupByOption():
    | { displayName: string; sort: string }
    | undefined {
    let groupBy = (this.args.model as any)?.groupBy ?? 'status';
    return (
      this.groupByOptions.find((option) => option.sort === groupBy) ?? undefined
    );
  }

  onGroupByChange = (option: { displayName: string; sort: string }): void => {
    let model = this.args.model as any;
    if (!model || model.groupBy === option.sort) {
      return;
    }
    model.groupBy = option.sort;
  };

  get hideEmptyColumns(): boolean {
    return Boolean((this.args.model as any)?.hideEmptyColumns);
  }

  toggleHideEmptyColumns = (): void => {
    let model = this.args.model as any;
    if (!model) {
      return;
    }
    model.hideEmptyColumns = !this.hideEmptyColumns;
  };

  // ── Persistence ──────────────────────────────────────────────────

  commitPlacements = (newPlacements: KanbanPlacement[]): void => {
    const model = this.args.model;
    if (!model) return;
    const cards = model.cards as any[];
    const columns = model.columns as any[];
    if (!cards || !columns) return;
    const source =
      defaultColumnOptions.find((o) => o.value === (model as any).groupBy) ??
      defaultColumnOptions[0]!;
    for (const np of newPlacements) {
      const card = cards[np.index];
      const col = columns[np.column];
      if (card && col) {
        if (card[source.writeFieldName] !== col.key)
          card[source.writeFieldName] = col.key;
        if (card[source.orderField] !== np.sortOrder)
          card[source.orderField] = np.sortOrder;
      }
    }
  };

  // ── Settings ─────────────────────────────────────────────────────

  setColumnConfig = (key: string, patch: Record<string, unknown>): void => {
    const model = this.args.model as any;
    if (!model) return;
    const groupBy = model.groupBy ?? 'status';
    const configField =
      groupBy === 'issueType'
        ? 'issueColumnConfig'
        : groupBy === 'priority'
          ? 'priorityColumnConfig'
          : 'statusColumnConfig';
    const cols: KanbanColumnField[] = model[configField] ?? [];
    const cfg = cols.find((c: any) => c.key === key) as any;
    if (cfg) {
      for (const [k, v] of Object.entries(patch)) {
        cfg[k] = v;
      }
    } else {
      cols.push(new KanbanColumnField({ key, ...patch }));
    }
  };

  toggleSettings = (): void => {
    this.showSettings = !this.showSettings;
  };

  onColorChange = (key: string | null | undefined, event: Event): void => {
    if (!key) return;
    this.setColumnConfig(key, {
      color: (event.target as HTMLInputElement).value,
    });
  };

  onWipChange = (key: string | null | undefined, event: Event): void => {
    if (!key) return;
    const raw = (event.target as HTMLInputElement).valueAsNumber;
    this.setColumnConfig(key, {
      wipLimit: isNaN(raw) || raw <= 0 ? null : raw,
    });
  };

  onCollapseChange = (key: string | null | undefined, event: Event): void => {
    if (!key) return;
    this.setColumnConfig(key, {
      collapsed: (event.target as HTMLInputElement).checked,
    });
  };

  moveColUp = (key: string | null | undefined, _event: Event): void => {
    if (!key) return;
    const cols = this.kanbanColumns;
    const idx = cols.findIndex((c) => c.key === key);
    if (idx <= 0) return;
    const a = cols[idx]!;
    const b = cols[idx - 1]!;
    const aOrder = a.sortOrder ?? idx;
    const bOrder = b.sortOrder ?? idx - 1;
    this.setColumnConfig(a.key!, { sortOrder: bOrder });
    this.setColumnConfig(b.key!, { sortOrder: aOrder });
  };

  moveColDown = (key: string | null | undefined, _event: Event): void => {
    if (!key) return;
    const cols = this.kanbanColumns;
    const idx = cols.findIndex((c) => c.key === key);
    if (idx < 0 || idx >= cols.length - 1) return;
    const a = cols[idx]!;
    const b = cols[idx + 1]!;
    const aOrder = a.sortOrder ?? idx;
    const bOrder = b.sortOrder ?? idx + 1;
    this.setColumnConfig(a.key!, { sortOrder: bOrder });
    this.setColumnConfig(b.key!, { sortOrder: aOrder });
  };

  // ── Template ─────────────────────────────────────────────────────

  <template>
    <div class='kanban-surface'>
      <header class='kanban-toolbar'>
        <div class='toolbar-left'>
          <div class='kanban-heading'>
            <div class='kanban-meta-top'>
              <Pill @size='extra-small' @variant='secondary'>
                {{if @model.projectCode @model.projectCode 'BOARD'}}
              </Pill>
              {{#if @model.projectStatus}}
                <Pill
                  @size='extra-small'
                  @variant={{getStatusVariant @model.projectStatus}}
                >
                  <@fields.projectStatus @format='atom' />
                </Pill>
              {{/if}}
            </div>
            <h2 class='kanban-title'>
              <SquareKanban />
              <@fields.cardTitle />
            </h2>
            {{#if @model.dueDate}}
              <div class='kanban-project'>
                <span class='dim-label'>Due Date</span>
                <@fields.dueDate @format='atom' />
              </div>
            {{/if}}
          </div>
          <div>
            <span class='card-count'>{{this.cardCount}} cards</span>
          </div>
        </div>
        <div class='toolbar-right'>
          <div class='column-visibility-toggle'>
            <span class='group-by-label'>Hide empty</span>
            <Switch
              @isEnabled={{this.hideEmptyColumns}}
              @onChange={{this.toggleHideEmptyColumns}}
              @label='Hide empty columns'
            />
          </div>
          <div class='group-by-picker'>
            <SortDropdown
              @options={{this.groupByOptions}}
              @selectedOption={{this.selectedGroupByOption}}
              @onSelect={{this.onGroupByChange}}
            />
          </div>
          <ContextButton
            class='settings-button'
            @label='Toggle column settings'
            @icon='context-menu-vertical'
            @variant='ghost'
            {{on 'click' this.toggleSettings}}
          />
        </div>
      </header>

      <div class='kanban-main'>
        <div class='kanban-body'>
          <KanbanPlane
            @columns={{this.kanbanColumns}}
            @placements={{this.kanbanPlacements}}
            @manager={{this.manager}}
            @interactive={{true}}
            @hideEmpty={{@model.hideEmptyColumns}}
            @onAddCard={{this.addCardToColumn}}
          >
            <:card as |placement|>
              {{#let (get @fields.cards placement.index) as |CardField|}}
                {{#if CardField}}
                  <div class='kanban-card-wrap'>
                    <CardField @format='fitted' />
                  </div>
                {{else}}
                  <div class='card-placeholder'>Card {{placement.index}}</div>
                {{/if}}
              {{/let}}
            </:card>
            <:ghost as |dragIdx|>
              {{#let (get @fields.cards dragIdx) as |CardField|}}
                {{#if CardField}}
                  <div class='ghost-wrap'>
                    <CardField @format='fitted' />
                  </div>
                {{/if}}
              {{/let}}
            </:ghost>
          </KanbanPlane>
        </div>

        {{#if this.showSettings}}
          <aside class='settings-panel'>
            <div class='settings-header'>Column Settings</div>
            {{#each this.kanbanColumns as |col|}}
              <div class='settings-row'>
                <div class='settings-top'>
                  <span class='settings-name'>{{col.label}}</span>
                  <div class='settings-order'>
                    <button
                      type='button'
                      class='order-btn'
                      {{on 'click' (fn this.moveColUp col.key)}}
                    >↑</button>
                    <button
                      type='button'
                      class='order-btn'
                      {{on 'click' (fn this.moveColDown col.key)}}
                    >↓</button>
                  </div>
                </div>
                <div class='settings-controls'>
                  <label class='settings-field'>
                    <span class='field-label'>Color</span>
                    <input
                      type='color'
                      class='color-input'
                      value={{if col.color col.color '#6366f1'}}
                      {{on 'change' (fn this.onColorChange col.key)}}
                    />
                  </label>
                  <label class='settings-field'>
                    <span class='field-label'>WIP</span>
                    <input
                      type='number'
                      class='wip-input'
                      value={{col.wipLimit}}
                      min='0'
                      placeholder='∞'
                      {{on 'change' (fn this.onWipChange col.key)}}
                    />
                  </label>
                  <label class='settings-field'>
                    <input
                      type='checkbox'
                      checked={{col.collapsed}}
                      {{on 'change' (fn this.onCollapseChange col.key)}}
                    />
                    <span class='field-label'>Collapse</span>
                  </label>
                </div>
              </div>
            {{/each}}
          </aside>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .kanban-surface {
        --kanban-surface-bg: var(--background, var(--boxel-200));
        --kanban-card-bg: var(--card, var(--boxel-light));
        --kanban-foreground: var(--foreground, var(--boxel-dark));
        --kanban-muted-bg: var(--muted, var(--boxel-100));
        --kanban-muted-foreground: var(--muted-foreground, var(--boxel-500));
        --kanban-border-color: var(--border, var(--boxel-border-color));

        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 100%;
        background: var(--kanban-surface-bg);
        color: var(--kanban-foreground);
      }
      .kanban-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 1rem;
        border-bottom: 1px solid var(--kanban-border-color);
        background: var(--kanban-card-bg);
        flex-shrink: 0;
      }
      .toolbar-left {
        display: flex;
        gap: 0.5rem;
      }
      .kanban-heading {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .kanban-meta-top {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .group-by-picker {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 11rem;
      }
      .column-visibility-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .group-by-label {
        font-size: 0.75rem;
        color: var(--kanban-muted-foreground);
        white-space: nowrap;
      }
      .group-by-picker :deep(.sort-options-label) {
        color: var(--kanban-muted-foreground);
        font-size: 0.75rem;
      }
      .group-by-picker :deep(.sort-button) {
        min-width: 8rem;
      }
      .kanban-title {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .kanban-project {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .dim-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--kanban-muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .card-count {
        font-size: 0.75rem;
        color: var(--kanban-muted-foreground);
        padding: 0.125rem 0.5rem;
        background: var(--kanban-muted-bg);
        border-radius: 4px;
      }
      .settings-button {
        color: var(--kanban-muted-foreground);
      }
      .kanban-main {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .kanban-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .kanban-card-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
      }
      .ghost-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
      }
      .card-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        font-size: 0.75rem;
        color: var(--kanban-muted-foreground);
      }
      /* ── Settings panel ── */
      .settings-panel {
        width: 15rem;
        flex-shrink: 0;
        background: var(--kanban-card-bg);
        border-left: 1px solid var(--kanban-border-color);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }
      .settings-header {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--kanban-border-color);
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--kanban-muted-foreground);
        flex-shrink: 0;
      }
      .settings-row {
        padding: 0.625rem 0.75rem;
        border-bottom: 1px solid var(--kanban-border-color);
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .settings-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .settings-name {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--kanban-foreground);
      }
      .settings-order {
        display: flex;
        gap: 0.125rem;
      }
      .order-btn {
        padding: 0.0625rem 0.3125rem;
        font-size: 0.6875rem;
        line-height: 1.4;
        background: var(--kanban-muted-bg);
        border: 1px solid var(--kanban-border-color);
        border-radius: 3px;
        cursor: pointer;
        color: var(--kanban-foreground);
      }
      .order-btn:hover {
        background: var(--kanban-border-color);
      }
      .settings-controls {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex-wrap: wrap;
      }
      .settings-field {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        cursor: pointer;
      }
      .field-label {
        font-size: 0.6875rem;
        color: var(--kanban-muted-foreground);
      }
      .color-input {
        width: 1.5rem;
        height: 1.125rem;
        padding: 0;
        border: 1px solid var(--kanban-border-color);
        border-radius: 3px;
        cursor: pointer;
      }
      .wip-input {
        width: 2.75rem;
        padding: 0.125rem 0.25rem;
        font-size: 0.6875rem;
        border: 1px solid var(--kanban-border-color);
        border-radius: 3px;
        background: var(--kanban-muted-bg);
        color: var(--kanban-foreground);
      }
    </style>
  </template>
}

// ── KanbanBoard ───────────────────────────────────────────────────────── //

export class KanbanBoard extends CardDef {
  static displayName = 'Kanban Board';
  static icon = KanbanIcon;
  static prefersWideFormat = true;

  @field projectCode = contains(StringField);
  @field projectName = contains(StringField);
  @field projectStatus = contains(
    enumField(StringField, { options: projectStatusOptions }),
  );
  @field description = contains(MarkdownField);
  @field dueDate = contains(DateField);
  @field hideEmptyColumns = contains(BooleanField);
  @field groupBy = contains(
    enumField(StringField, {
      options: defaultColumnOptions.map(({ value, label }) => ({
        value,
        label,
      })),
    }),
  );
  @field issuePriorityOptions = containsMany(IssueOptionField);
  @field issueStatusOptions = containsMany(IssueOptionField);
  @field issueTypeOptions = containsMany(IssueOptionField);
  @field cards = linksToMany(Issue, {
    query: {
      filter: {
        on: {
          module: 'https://cardstack.com/base/issue-tracker/issue',
          name: 'Issue',
        },
        eq: { 'kanbanBoard.id': '$this.id' },
      },
    },
  });
  @field statusColumnConfig = containsMany(KanbanColumnField);
  @field priorityColumnConfig = containsMany(KanbanColumnField);
  @field typeColumnConfig = containsMany(KanbanColumnField);
  @field columns = containsMany(KanbanColumnField, {
    computeVia: function (this: KanbanBoard) {
      const source =
        defaultColumnOptions.find((o) => o.value === this.groupBy) ??
        defaultColumnOptions[0]!;
      const boardOptions =
        source.value === 'priority'
          ? (this.issuePriorityOptions as
              | { value: string; label: string }[]
              | undefined)
          : source.value === 'issueType'
            ? (this.issueTypeOptions as
                | { value: string; label: string }[]
                | undefined)
            : source.value === 'status'
              ? (this.issueStatusOptions as
                  | { value: string; label: string }[]
                  | undefined)
              : null;
      const options = boardOptions?.length ? boardOptions : source.options;
      const config = ((source.value === 'issueType'
        ? this.typeColumnConfig
        : source.value === 'priority'
          ? this.priorityColumnConfig
          : this.statusColumnConfig) ?? []) as KanbanColumnField[];
      return options
        .map((o, i) => {
          const stored = config.find((c) => c.key === o.value);
          return new KanbanColumnField({
            key: o.value,
            label: o.label,
            color:
              stored?.color ??
              defaultThemeColumnColor(source.value, o.value, i),
            wipLimit: stored?.wipLimit ?? null,
            collapsed: stored?.collapsed ?? null,
            sortOrder: stored?.sortOrder ?? i,
          });
        })
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: KanbanBoard) {
      return this.cardInfo?.name ?? this.projectName ?? 'Untitled Kanban';
    },
  });

  // ── Isolated ───────────────────────────────────────────────────────

  static isolated = Isolated;

  // ── Edit ───────────────────────────────────────────────────────────

  static edit = class Edit extends Component<typeof KanbanBoard> {
    constructor(owner: unknown, args: any) {
      super(owner, args);
      Promise.resolve().then(() => {
        let model = this.args.model as KanbanBoard | undefined;
        if (!model) return;

        if (!model.issuePriorityOptions?.length) {
          model.issuePriorityOptions =
            makeIssueOptionFields(issuePriorityOptions);
        }
        if (!model.issueStatusOptions?.length) {
          model.issueStatusOptions = makeIssueOptionFields(issueStatusOptions);
        }
        if (!model.issueTypeOptions?.length) {
          model.issueTypeOptions = makeIssueOptionFields(issueTypeOptions);
        }
      });
    }

    get groupBy(): string {
      return (this.args.model as any)?.groupBy ?? 'status';
    }
    get isStatus(): boolean {
      return this.groupBy === 'status';
    }
    get isPriority(): boolean {
      return this.groupBy === 'priority';
    }
    get colConfigLabel(): string {
      if (this.groupBy === 'priority') return 'Priority Column Config';
      if (this.groupBy === 'issueType') return 'Type Column Config';
      return 'Status Column Config';
    }

    <template>
      <div class='kanban-edit'>
        <div class='row'>
          <FieldContainer @label='Project Name' @vertical={{true}}>
            <@fields.projectName />
          </FieldContainer>
          <FieldContainer @label='Project Code' @vertical={{true}}>
            <@fields.projectCode />
          </FieldContainer>
        </div>

        <div class='row'>
          <FieldContainer @label='Status' @vertical={{true}}>
            <@fields.projectStatus />
          </FieldContainer>
          <FieldContainer @label='Due Date' @vertical={{true}}>
            <@fields.dueDate />
          </FieldContainer>
        </div>

        <FieldContainer @label='Description' @vertical={{true}}>
          <@fields.description />
        </FieldContainer>

        <div class='row'>
          <FieldContainer @label='Theme' @vertical={{true}}>
            <@fields.cardInfo.theme />
          </FieldContainer>
          <FieldContainer @label='Group By' @vertical={{true}}>
            <@fields.groupBy />
          </FieldContainer>
        </div>

        <div class='row'>
          <FieldContainer @label='Hide Empty Columns' @vertical={{true}}>
            <@fields.hideEmptyColumns />
          </FieldContainer>
        </div>

        <section class='options-section'>
          <div class='options-section-header'>
            <h2 class='section-title'>Issue Configuration</h2>
            <p class='section-copy'>
              Define the status, priority, and type options that issues in this
              board can use.
            </p>
          </div>

          <div class='options-section-body'>
            <div class='options-config-panel'>
              <FieldContainer @label='Issue Status Options' @vertical={{true}}>
                <@fields.issueStatusOptions />
              </FieldContainer>
            </div>

            <div class='options-config-panel'>
              <FieldContainer
                @label='Issue Priority Options'
                @vertical={{true}}
              >
                <@fields.issuePriorityOptions />
              </FieldContainer>
            </div>

            <div class='options-config-panel'>
              <FieldContainer @label='Issue Type Options' @vertical={{true}}>
                <@fields.issueTypeOptions />
              </FieldContainer>
            </div>
          </div>
        </section>

        <div class='col-config-row'>
          <FieldContainer @label='Configured Columns' @vertical={{true}}>
            <@fields.columns />
          </FieldContainer>
        </div>
      </div>
      <style scoped>
        .kanban-edit {
          display: grid;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-xl);
        }
        .row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .options-section {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius-lg);
        }
        .options-section-header {
          display: grid;
          gap: var(--boxel-sp-2xs);
        }
        .options-section-body {
          display: grid;
          gap: var(--boxel-sp);
        }
        .options-config-panel {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background: var(--sidebar, var(--background));
          color: var(--sidebar-foreground, var(--foreground));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
          box-shadow: inset 0 1px 0
            color-mix(in oklch, var(--card) 35%, transparent);
        }
        .section-title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .section-copy {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-600));
        }
        .col-config-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
          min-width: 0;
          align-items: start;
        }
      </style>
    </template>
  };

  // ── Fitted ─────────────────────────────────────────────────────────

  static fitted = class Fitted extends Component<typeof KanbanBoard> {
    get colCount(): number {
      return this.args.model?.columns?.length ?? 0;
    }
    get cardCount(): number {
      return this.args.model?.cards?.length ?? 0;
    }
    laneStyle = (color: string | null | undefined) =>
      htmlSafe(`border-top-color: ${color ?? 'var(--border)'};`);

    <template>
      <div class='fitted-kanban'>
        <div class='fitted-header'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='3' y='3' width='5' height='18' rx='1' />
            <rect x='10' y='3' width='5' height='12' rx='1' />
            <rect x='17' y='3' width='5' height='15' rx='1' />
          </svg>
          <span class='fitted-title'><@fields.cardTitle /></span>
        </div>
        <div class='fitted-lanes'>
          {{#each @model.columns as |col|}}
            <div class='mini-lane' style={{this.laneStyle col.color}}></div>
          {{/each}}
        </div>
        <span class='fitted-meta'>{{this.cardCount}}
          cards &middot;
          {{this.colCount}}
          lanes</span>
      </div>
      <style scoped>
        .fitted-kanban {
          --kanban-card-bg: var(--card, var(--boxel-light));
          --kanban-muted-bg: var(--muted, var(--boxel-100));
          --kanban-muted-foreground: var(--muted-foreground, var(--boxel-500));

          container-type: size;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.5rem;
          background: var(--kanban-card-bg);
          overflow: hidden;
        }
        .fitted-header {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          flex-shrink: 0;
        }
        .fitted-title {
          font-size: 0.75rem;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fitted-lanes {
          display: flex;
          gap: 0.1875rem;
          flex: 1;
          min-height: 0;
        }
        .mini-lane {
          flex: 1;
          background: var(--kanban-muted-bg);
          border-radius: 2px;
          border-top: 2px solid;
        }
        .fitted-meta {
          font-size: 0.625rem;
          color: var(--kanban-muted-foreground);
          flex-shrink: 0;
        }
        @container (max-height: 80px) {
          .fitted-lanes {
            display: none;
          }
          .fitted-meta {
            display: none;
          }
        }
      </style>
    </template>
  };

  // ── Embedded ───────────────────────────────────────────────────────

  static embedded = class Embedded extends Component<typeof KanbanBoard> {
    get cardCount(): number {
      return this.args.model?.cards?.length ?? 0;
    }
    get colCount(): number {
      return this.args.model?.columns?.length ?? 0;
    }
    <template>
      <div class='embedded-kanban'>
        <svg
          width='16'
          height='16'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <rect x='3' y='3' width='5' height='18' rx='1' /><rect
            x='10'
            y='3'
            width='5'
            height='12'
            rx='1'
          /><rect x='17' y='3' width='5' height='15' rx='1' />
        </svg>
        <div class='embedded-info'>
          <span class='embedded-title'><@fields.cardTitle /></span>
          <span class='embedded-meta'>{{this.cardCount}}
            cards &middot;
            {{this.colCount}}
            lanes</span>
        </div>
      </div>
      <style scoped>
        .embedded-kanban {
          --kanban-card-bg: var(--card, var(--boxel-light));
          --kanban-foreground: var(--foreground, var(--boxel-dark));
          --kanban-muted-foreground: var(--muted-foreground, var(--boxel-500));
          --kanban-border-color: var(--border, var(--boxel-border-color));

          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: var(--kanban-card-bg);
          border: 1px solid var(--kanban-border-color);
          border-radius: 6px;
          color: var(--kanban-muted-foreground);
        }
        .embedded-info {
          display: flex;
          flex-direction: column;
        }
        .embedded-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--kanban-foreground);
        }
        .embedded-meta {
          font-size: 0.75rem;
        }
      </style>
    </template>
  };
}
