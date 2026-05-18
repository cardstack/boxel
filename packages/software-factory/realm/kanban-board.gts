import { get } from '@ember/helper';

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
import BooleanField from 'https://cardstack.com/base/boolean';

import { KanbanPlane, Switch } from '@cardstack/boxel-ui/components';
import type {
  KanbanColumnConfig,
  KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import { KanbanColumnField } from './kanban-column';
import { KanbanBoardPlacement } from './kanban-board-placement';

export class KanbanBoard extends CardDef {
  static displayName = 'Kanban Board';
  static prefersWideFormat = true;

  @field boardKey = contains(StringField);
  @field boardTitle = contains(StringField);
  @field cards = linksToMany(CardDef);
  @field hideEmptyColumns = contains(BooleanField);
  @field columns = containsMany(KanbanColumnField);
  @field placements = containsMany(KanbanBoardPlacement);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: KanbanBoard) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.boardTitle ?? 'Kanban Board');
    },
  });

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof KanbanBoard
  > {
    get columns(): KanbanColumnConfig[] {
      return (this.args.model.columns ?? []).map((col) => ({
        key: col.key ?? null,
        label: col.label ?? null,
        color: col.color ?? null,
        collapsed: col.collapsed ?? null,
        sortOrder: col.sortOrder ?? null,
        wipLimit: col.wipLimit ?? null,
      }));
    }

    get placements(): KanbanPlacement[] {
      let cards = this.args.model.cards ?? [];
      let raw = this.args.model.placements ?? [];

      return raw
        .map((p) => {
          let colIdx = this.columns.findIndex((c) => c.key === p.columnKey);
          let cardIdx = cards.findIndex((c) => (c as any).id === p.itemId);
          if (colIdx === -1 || cardIdx === -1) return null;
          return {
            column: colIdx,
            index: cardIdx,
            sortOrder: p.sortOrder ?? 0,
          } satisfies KanbanPlacement;
        })
        .filter((p): p is KanbanPlacement => p !== null);
    }

    get cardCount(): number {
      return this.args.model?.cards?.length ?? 0;
    }

    handleChange = (newPlacements: KanbanPlacement[]) => {
      let cards = this.args.model.cards ?? [];
      this.args.model.placements = newPlacements.map((p) =>
        Object.assign(new KanbanBoardPlacement(), {
          itemId: (cards[p.index] as any)?.id ?? '',
          columnKey: this.columns[p.column]?.key ?? '',
          sortOrder: p.sortOrder,
        }),
      );
    };

    toggleHideEmptyColumns = (): void => {
      this.args.model.hideEmptyColumns = !this.args.model?.hideEmptyColumns;
    };

    handleToggleCollapsed = (
      columnKey: string | null,
      collapsed: boolean,
    ): void => {
      let columns = this.args.model.columns ?? [];
      let idx = columns.findIndex((c) => c.key === columnKey);
      if (idx === -1) return;
      this.args.model.columns = columns.map((c, i) =>
        i === idx
          ? Object.assign(new KanbanColumnField(), { ...c, collapsed })
          : c,
      );
    };

    handleShowEmptyColumns = (): void => {
      this.args.model.hideEmptyColumns = false;
    };

    <template>
      <div class='kanban-board-isolated'>
        <header class='kanban-board-header'>
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
            <div class='kanban-column-visibility-toggle'>
              <span class='kanban-header-label'>Hide empty</span>
              <Switch
                @isEnabled={{@model.hideEmptyColumns}}
                @onChange={{this.toggleHideEmptyColumns}}
                @label='Hide empty columns'
              />
            </div>
          </div>
        </header>
        <div class='kanban-area'>
          {{#if this.columns.length}}
            <KanbanPlane
              @columns={{this.columns}}
              @placements={{this.placements}}
              @hideEmpty={{@model.hideEmptyColumns}}
              @onChange={{this.handleChange}}
              @onToggleCollapsed={{this.handleToggleCollapsed}}
              @onShowEmptyColumns={{this.handleShowEmptyColumns}}
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
        </div>
      </div>
      <style scoped>
        .kanban-board-isolated {
          --board-bg: var(--background, var(--boxel-200));
          --board-fg: var(--foreground, var(--boxel-700));
          --board-card-bg: var(--card, var(--boxel-light));
          --board-card-fg: var(--foreground, var(--boxel-dark));
          --board-muted-bg: var(--muted, var(--boxel-100));
          --board-muted-fg: var(--muted-foreground, var(--boxel-500));
          --board-border: var(--border, var(--boxel-border-color));

          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background-color: var(--board-bg);
          color: var(--board-fg);
        }
        .kanban-board-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.625rem 1rem;
          border-bottom: 1px solid var(--board-border);
          background: var(--board-card-bg);
          color: var(--board-card-fg);
          flex-shrink: 0;
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
          gap: 0.375rem;
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
        .kanban-header-label {
          font-size: 0.75rem;
          color: var(--board-muted-fg);
          white-space: nowrap;
        }
        .kanban-column-visibility-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .kanban-area {
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
          border: 1px solid var(--board-border);
          border-radius: 0.75rem;
          background: var(--board-card-bg);
          color: var(--board-card-fg);
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
          color: var(--board-muted-fg);
        }
        .kanban-empty-state :deep(svg) {
          width: 1.5rem;
          height: 1.5rem;
          margin: 0 auto 0.25rem;
          color: var(--board-muted-fg);
        }
      </style>
    </template>
  };
}
