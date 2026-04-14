// KanbanCard — Kanban board with insertion-based drag engine.
// No wells at rest. Insertion gaps open between cards during drag.

import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  CSSField,
  CssImportField,
} from '../card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import StringField from '../string';
import BooleanField from '../boolean';
import enumField from '../enum';
import { tracked } from '@glimmer/tracking';
import { fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import KanbanIcon from '@cardstack/boxel-icons/columns-3';

import { KanbanColumnField } from './kanban-column';
import { KanbanPlane } from './kanban-plane';
import { KanbanDragManager } from './kanban-drag';
import { type KanbanPlacement } from './kanban-engine';
import {
  Project,
  Issue,
  issueStatusOptions,
  issuePriorityOptions,
  issueTypeOptions,
} from './issue';

const defaultColumnOptions: {
  value: string;
  label: string;
  fieldName: string; // field to read for column matching (may be computed)
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
    fieldName: 'computedPriority',
    writeFieldName: 'priority',
    orderField: 'priorityBoardOrder',
    options: issuePriorityOptions,
  },
  {
    value: 'ticketType',
    label: 'Type',
    fieldName: 'computedTicketType',
    writeFieldName: 'ticketType',
    orderField: 'ticketTypeBoardOrder',
    options: issueTypeOptions,
  },
];

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
      groupBy === 'ticketType'
        ? 'typeColumnConfig'
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
          <h2 class='kanban-title'>
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='5' height='18' rx='1' />
              <rect x='10' y='3' width='5' height='12' rx='1' />
              <rect x='17' y='3' width='5' height='15' rx='1' />
            </svg>
            <@fields.cardTitle />
          </h2>
          <span class='card-count'>{{this.cardCount}} cards</span>
        </div>
        <div class='toolbar-right'>
          <button
            type='button'
            class='settings-btn {{if this.showSettings "is-active"}}'
            {{on 'click' this.toggleSettings}}
          >⚙</button>
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
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 100%;
        background: #eceef1;
        color: #1e293b;
      }
      .kanban-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        border-bottom: 1px solid #e2e8f0;
        background: #fff;
        flex-shrink: 0;
      }
      .toolbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .kanban-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .card-count {
        font-size: 12px;
        color: #94a3b8;
        padding: 2px 8px;
        background: #f1f5f9;
        border-radius: 4px;
      }
      .settings-btn {
        padding: 3px 8px;
        font-size: 14px;
        line-height: 1;
        background: transparent;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 4px;
        cursor: pointer;
        color: var(--muted-foreground, #64748b);
      }
      .settings-btn.is-active {
        background: var(--muted, #f1f5f9);
        border-color: var(--border, #cbd5e1);
        color: var(--foreground, #1e293b);
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
        font-size: 12px;
        color: #94a3b8;
      }
      /* ── Settings panel ── */
      .settings-panel {
        width: 240px;
        flex-shrink: 0;
        background: var(--card, #fff);
        border-left: 1px solid var(--border, #e2e8f0);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }
      .settings-header {
        padding: 8px 12px;
        border-bottom: 1px solid var(--border, #e2e8f0);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted-foreground, #64748b);
        flex-shrink: 0;
      }
      .settings-row {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border, #f1f5f9);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .settings-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .settings-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--foreground, #1e293b);
      }
      .settings-order {
        display: flex;
        gap: 2px;
      }
      .order-btn {
        padding: 1px 5px;
        font-size: 11px;
        line-height: 1.4;
        background: var(--muted, #f1f5f9);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 3px;
        cursor: pointer;
        color: var(--foreground, #1e293b);
      }
      .order-btn:hover {
        background: var(--border, #e2e8f0);
      }
      .settings-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .settings-field {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }
      .field-label {
        font-size: 11px;
        color: var(--muted-foreground, #64748b);
      }
      .color-input {
        width: 24px;
        height: 18px;
        padding: 0;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 3px;
        cursor: pointer;
      }
      .wip-input {
        width: 44px;
        padding: 2px 4px;
        font-size: 11px;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 3px;
        background: var(--muted, #f8fafc);
        color: var(--foreground, #1e293b);
      }
    </style>
  </template>
}

// ── KanbanBoard ───────────────────────────────────────────────────────── //

export class KanbanBoard extends CardDef {
  static displayName = 'Kanban Board';
  static icon = KanbanIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field hideEmptyColumns = contains(BooleanField);
  @field project = linksTo(() => Project);
  @field groupBy = contains(
    enumField(StringField, {
      options: defaultColumnOptions.map(({ value, label }) => ({
        value,
        label,
      })),
    }),
  );
  @field cards = linksToMany(Issue, {
    computeVia: function (this: KanbanBoard) {
      return this.project?.issues ?? [];
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
      const projectOptions =
        source.value === 'priority'
          ? (this.project?.priorityOptions as
              | { value: string; label: string }[]
              | undefined)
          : source.value === 'status'
            ? (this.project?.statusOptions as
                | { value: string; label: string }[]
                | undefined)
            : null;
      const options = projectOptions?.length ? projectOptions : source.options;
      const config = ((
        source.value === 'ticketType'
          ? this.typeColumnConfig
          : source.value === 'priority'
            ? this.priorityColumnConfig
            : this.statusColumnConfig
      ) ?? []) as KanbanColumnField[];
      return options
        .map((o, i) => {
          const stored = config.find((c) => c.key === o.value);
          return new KanbanColumnField({
            key: o.value,
            label: o.label,
            color: stored?.color ?? null,
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
      return this.cardInfo?.name ?? this.title ?? 'Untitled Kanban';
    },
  });
  // TODO: better way to inherit project theme
  @field cssVariables = contains(CSSField, {
    computeVia: function (this: Issue) {
      return (
        this.cardInfo.theme?.cssVariables ??
        this.project?.cardInfo?.theme?.cssVariables
      );
    },
  });
  @field cssImports = containsMany(CssImportField, {
    computeVia: function (this: Issue) {
      return (
        this.cardInfo.theme?.cssImports ??
        this.project?.cardInfo?.theme?.cssImports ??
        []
      );
    },
  });

  // ── Isolated ───────────────────────────────────────────────────────

  static isolated = Isolated;

  // ── Edit ───────────────────────────────────────────────────────────

  static edit = class Edit extends Component<typeof KanbanBoard> {
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
      if (this.groupBy === 'ticketType') return 'Type Column Config';
      return 'Status Column Config';
    }

    <template>
      <div class='kanban-edit'>
        <div class='row'>
          <FieldContainer @label='Title' @vertical={{true}}>
            <@fields.title />
          </FieldContainer>
          <FieldContainer @label='Project' @vertical={{true}}>
            <@fields.project />
          </FieldContainer>
        </div>

        <div class='row'>
          <FieldContainer @label='Group By' @vertical={{true}}>
            <@fields.groupBy />
          </FieldContainer>
          <FieldContainer @label='Hide Empty Columns' @vertical={{true}}>
            <@fields.hideEmptyColumns />
          </FieldContainer>
        </div>

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
          <span class='fitted-title'>{{if
              @model.title
              @model.title
              'Kanban'
            }}</span>
        </div>
        <div class='fitted-lanes'>
          {{#each @model.columns as |col|}}
            <div
              class='mini-lane'
              style='border-top-color: {{if
                col.color
                col.color
                "var(--border)"
              }}'
            ></div>
          {{/each}}
        </div>
        <span class='fitted-meta'>{{this.cardCount}}
          cards &middot;
          {{this.colCount}}
          lanes</span>
      </div>
      <style scoped>
        .fitted-kanban {
          container-type: size;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px;
          background: var(--card, #fff);
          overflow: hidden;
        }
        .fitted-header {
          display: flex;
          align-items: center;
          gap: 4px;
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
          gap: 3px;
          flex: 1;
          min-height: 0;
        }
        .mini-lane {
          flex: 1;
          background: var(--muted, #f1f5f9);
          border-radius: 2px;
          border-top: 2px solid;
        }
        .fitted-meta {
          font-size: 10px;
          color: var(--muted-foreground, #94a3b8);
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
          <span class='embedded-title'>{{if
              @model.title
              @model.title
              'Kanban'
            }}</span>
          <span class='embedded-meta'>{{this.cardCount}}
            cards &middot;
            {{this.colCount}}
            lanes</span>
        </div>
      </div>
      <style scoped>
        .embedded-kanban {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--card, #fff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 6px;
          color: var(--muted-foreground, #94a3b8);
        }
        .embedded-info {
          display: flex;
          flex-direction: column;
        }
        .embedded-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
        }
        .embedded-meta {
          font-size: 0.75rem;
        }
      </style>
    </template>
  };
}
