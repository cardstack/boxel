import { get } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  field,
  contains,
  containsMany,
  linksToMany,
  Component,
  StringField,
  type BaseDefComponent,
} from 'https://cardstack.com/base/card-api';

import {
  ContextButton,
  KanbanColumnConfigSidebar,
  KanbanPlane,
  Switch,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import type {
  KanbanColumnConfig,
  KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import Settings from '@cardstack/boxel-icons/settings';
import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import { KanbanColumnField } from './kanban-column';
import { KanbanBoardPlacement } from './kanban-board-placement';

class KanbanBoardIsolated extends Component<typeof KanbanBoard> {
  @tracked isSidebarOpen = false;

  get columns(): KanbanColumnConfig[] {
    return (this.args.model.columns ?? []).map((col) => ({
      key: col.key,
      label: col.label,
      color: col.color,
      collapsed: col.collapsed ?? false,
      wipLimit: col.wipLimit ?? null,
      sortOrder: col.sortOrder,
    }));
  }

  get firstColumn(): KanbanColumnConfig | undefined {
    return [...this.columns].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  }

  get placements(): KanbanPlacement[] {
    let cards = this.args.model.cards ?? [];
    let raw = this.args.model.placements ?? [];

    return raw
      .map((p) => {
        let col =
          this.columns.find((c: KanbanColumnConfig) => c.key === p.columnKey) ??
          this.firstColumn;
        let cardIdx = cards.findIndex((c) => (c as any).id === p.itemId);
        if (!col || !col.key || cardIdx === -1) return null;
        return {
          columnId: col.key,
          index: cardIdx,
          sortOrder: p.sortOrder ?? 0,
        } satisfies KanbanPlacement;
      })
      .filter((p): p is KanbanPlacement => p !== null);
  }

  get cardCount(): number {
    return this.args.model?.cards?.length ?? 0;
  }

  get columnCardCounts(): number[] {
    return this.columns.map(
      (col: KanbanColumnConfig) =>
        this.placements.filter((p) => p.columnId === col.key).length,
    );
  }

  handleChange = (newPlacements: KanbanPlacement[]) => {
    let cards = this.args.model.cards ?? [];
    this.args.model.placements = newPlacements.map((p) =>
      Object.assign(new KanbanBoardPlacement(), {
        itemId: (cards[p.index] as any)?.id ?? '',
        columnKey: p.columnId,
        sortOrder: p.sortOrder,
      }),
    );
  };

  get hideEmpty(): boolean {
    let emptyCols = this.columns.filter(
      (_: KanbanColumnConfig, i: number) =>
        (this.columnCardCounts[i] ?? 0) === 0,
    );
    return (
      emptyCols.length > 0 &&
      emptyCols.every((col: KanbanColumnConfig) => col.collapsed)
    );
  }

  toggleHideEmptyColumns = (): void => {
    let next = !this.hideEmpty;
    this.handleColumnsChange(
      this.columns.map((col: KanbanColumnConfig, i: number) =>
        (this.columnCardCounts[i] ?? 0) === 0
          ? { ...col, collapsed: next }
          : col,
      ),
    );
  };

  handleToggleCollapsed = (col: KanbanColumnConfig | null): void => {
    if (!col) return;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, collapsed: !c.collapsed } : c,
      ),
    );
  };

  handleColumnsChange = (newColumns: KanbanColumnConfig[]): void => {
    this.args.model.columns = newColumns.map((cfg) =>
      Object.assign(new KanbanColumnField(), {
        key: cfg.key,
        label: cfg.label,
        color: cfg.color,
        collapsed: cfg.collapsed,
        wipLimit: cfg.wipLimit,
        sortOrder: cfg.sortOrder,
      }),
    );
  };

  handleLabelChange = (col: KanbanColumnConfig | null, val: string): void => {
    if (!col) return;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, label: val } : c,
      ),
    );
  };

  handleColorChange = (col: KanbanColumnConfig | null, val: string): void => {
    if (!col) return;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, color: val } : c,
      ),
    );
  };

  handleWipLimitChange = (
    col: KanbanColumnConfig | null,
    val: string,
  ): void => {
    if (!col) return;
    let raw = parseInt(val, 10);
    let wipLimit = isNaN(raw) || raw < 0 ? 0 : raw;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, wipLimit } : c,
      ),
    );
  };

  handleReorder = (newColumns: KanbanColumnConfig[]): void => {
    this.handleColumnsChange(newColumns);
  };

  toggleSidebar = (): void => {
    this.isSidebarOpen = !this.isSidebarOpen;
  };

  openCard = (index: number): void => {
    let card = this.args.model.cards?.[index];
    if (card) {
      this.args.viewCard?.(card, 'isolated');
    }
  };

  <template>
    <div class='kanban-board-isolated'>
      <header class='kanban-toolbar'>
        <div class='toolbar-left'>
          <div class='kanban-heading'>
            <h1 class='kanban-title'>
              <SquareKanban />
              <@fields.cardTitle />
            </h1>
          </div>
          <div>
            <span class='kanban-card-count'>
              {{#if (eq this.cardCount 1)}}
                1 card
              {{else}}
                {{this.cardCount}}
                cards
              {{/if}}
            </span>
          </div>
        </div>
        <div class='toolbar-right'>
          {{#if this.columns.length}}
            <div class='kanban-column-visibility-toggle'>
              <span class='kanban-header-label'>Hide empty</span>
              <Switch
                @isEnabled={{this.hideEmpty}}
                @onChange={{this.toggleHideEmptyColumns}}
                @label='Hide empty columns'
              />
            </div>
          {{/if}}
          <Tooltip @placement='bottom'>
            <:trigger>
              <ContextButton
                class='configure-btn'
                @icon={{Settings}}
                @label={{if
                  this.isSidebarOpen
                  'Close config sidebar'
                  'Open config sidebar'
                }}
                @variant='highlight'
                @isToggle={{true}}
                @isActive={{this.isSidebarOpen}}
                data-test-configure-columns-btn
                {{on 'click' this.toggleSidebar}}
              />
            </:trigger>
            <:content>{{if
                this.isSidebarOpen
                'Close config'
                'Configure columns'
              }}</:content>
          </Tooltip>
        </div>
      </header>
      <div class='kanban-body'>
        <div class='kanban-area'>
          <KanbanPlane
            @boardLabel={{@model.cardTitle}}
            @columns={{this.columns}}
            @placements={{this.placements}}
            @onChange={{this.handleChange}}
            @onOpen={{this.openCard}}
            @onToggleCollapsed={{this.handleToggleCollapsed}}
          >
            <:card as |placement|>
              {{#let (get @fields.cards placement.index) as |CardField|}}
                {{#if CardField}}
                  <div class='kanban-card-wrap'>
                    <CardField @format='fitted' @displayContainer={{false}} />
                  </div>
                {{/if}}
              {{/let}}
            </:card>
            <:ghost as |dragIdx|>
              {{#let (get @fields.cards dragIdx) as |CardField|}}
                {{#if CardField}}
                  <div class='kanban-card-wrap'>
                    <CardField @format='fitted' @displayContainer={{false}} />
                  </div>
                {{/if}}
              {{/let}}
            </:ghost>
          </KanbanPlane>
        </div>

        <div
          class={{cn 'kanban-config-sidebar-wrap' is-open=this.isSidebarOpen}}
        >
          <KanbanColumnConfigSidebar
            @columns={{this.columns}}
            @onClose={{this.toggleSidebar}}
            @onToggleCollapsed={{this.handleToggleCollapsed}}
            @onLabelChange={{this.handleLabelChange}}
            @onColorChange={{this.handleColorChange}}
            @onWipLimitChange={{this.handleWipLimitChange}}
            @onReorder={{this.handleReorder}}
          />
        </div>
      </div>
    </div>
    <style scoped>
      .kanban-board-isolated {
        --board-bg: var(--background, var(--boxel-100));
        --board-fg: var(--foreground, var(--boxel-700));
        --board-card-bg: var(--card, var(--boxel-light));
        --board-card-fg: var(--foreground, var(--boxel-dark));
        --board-muted-bg: var(--muted, var(--boxel-100));
        --board-muted-fg: var(--muted-foreground, var(--boxel-500));
        --board-border: var(--border, var(--boxel-border-color));

        /* setting boxel-ui component variables */
        --boxel-kanban-bg: var(--board-bg);
        --boxel-kanban-fg: var(--board-fg);
        --boxel-kanban-card-bg: var(--board-card-bg);
        --boxel-kanban-card-fg: var(--board-card-fg);
        --boxel-kanban-muted-fg: var(--board-muted-fg);
        --boxel-kanban-border: var(--board-border);

        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background-color: var(--board-bg);
        color: var(--board-fg);
      }
      .kanban-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 1rem;
        border-bottom: 1px solid var(--board-border);
        background: var(--board-card-bg);
        color: var(--board-card-fg);
        flex-shrink: 0;
      }
      .toolbar-left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .kanban-heading {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .kanban-title {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .kanban-card-count {
        font-size: 0.75rem;
        color: var(--board-muted-fg);
        padding: 0.125rem 0.5rem;
        background: var(--board-muted-bg);
        border-radius: 4px;
      }
      .kanban-column-visibility-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .kanban-header-label {
        font-size: 0.75rem;
        color: var(--board-muted-fg);
        white-space: nowrap;
      }
      .kanban-body {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .kanban-area {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      .kanban-card-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
      }
      .kanban-config-sidebar-wrap {
        flex-shrink: 0;
        width: 0;
        overflow: hidden;
        transition: width var(--boxel-transition);
      }
      .kanban-config-sidebar-wrap.is-open {
        width: 19rem;
      }
    </style>
  </template>
}

export class KanbanBoard extends CardDef {
  static displayName = 'Kanban Board';
  static prefersWideFormat = true;

  @field boardKey = contains(StringField);
  @field boardTitle = contains(StringField);
  @field cards = linksToMany(CardDef);
  @field columns = containsMany(KanbanColumnField);
  @field placements = containsMany(KanbanBoardPlacement);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: KanbanBoard) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.boardTitle ?? 'Kanban Board');
    },
  });

  static isolated: BaseDefComponent = KanbanBoardIsolated;
}
