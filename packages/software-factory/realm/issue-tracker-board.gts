import { get } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import Component from '@glimmer/component';

import {
  BoxelSelect,
  FieldContainer,
  KanbanPlane,
  Switch,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import type { RenderableSearchEntryLike } from '@cardstack/runtime-common';

import { defaultColumns, type Column, type Option } from './kanban-config';

interface Signature {
  Args: {
    boardTitle?: string;
    columns?: Option[];
    cards?: RenderableSearchEntryLike[];
    hideEmpty?: boolean;
    onToggleHideEmpty?: () => void;
    onOpen?: (index: number) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLSpanElement;
}

export default class IssueTrackerBoard extends Component<Signature> {
  @tracked activeGroupBy = 'status';

  get groupByDimensions(): Column[] {
    return defaultColumns;
  }

  get selectedGroupByDimension(): Column {
    return defaultColumns.find((d) => d.key === this.activeGroupBy) ?? defaultColumns[0]!;
  }

  updateGroupBy = (dim: Column): void => {
    this.activeGroupBy = dim.key;
  };

  get kanbanColumns(): KanbanColumnConfig[] {
    let options =
      this.activeGroupBy === 'status'
        ? (this.args.columns ?? this.selectedGroupByDimension.options)
        : this.selectedGroupByDimension.options;
    let cards = this.args.cards ?? [];
    let fieldName = this.selectedGroupByDimension.fieldName;
    return options.map((opt, i) => {
      let hasCards =
        !this.args.hideEmpty ||
        cards.some(
          (entry) =>
            ((entry.item as any)?.attributes?.[fieldName] as string) ===
            opt.value,
        );
      return {
        key: opt.value,
        label: opt.label,
        sortOrder: i,
        collapsed: !hasCards,
        color: opt.color ?? null,
        wipLimit: null,
      };
    });
  }

  get placements(): KanbanPlacement[] {
    let cards = this.args.cards ?? [];
    let cols = this.kanbanColumns;
    let fieldName = this.selectedGroupByDimension.fieldName;
    let fallbackKey =
      cols.find((c) => c.key === 'backlog')?.key ?? cols[0]?.key ?? '';
    return cards.map((entry, idx) => {
      let value = (entry.item as any)?.attributes?.[fieldName] as
        | string
        | undefined;
      let colKey = cols.find((c) => c.key === value)?.key ?? fallbackKey;
      return { columnId: colKey, index: idx, sortOrder: idx };
    });
  }

  <template>
    <div class='kanban-board-isolated'>
      <header class='kanban-toolbar'>
        <div class='toolbar-left'>
          <div class='kanban-heading'>
            <h2 class='kanban-title'>
              <SquareKanban />
              <span class='kanban-title-text'>{{@boardTitle}}</span>
            </h2>
          </div>
        </div>
        <div class='toolbar-right'>
          <FieldContainer
            @label='Group by'
            @inline={{true}}
            class='group-by-field'
          >
            <BoxelSelect
              @options={{this.groupByDimensions}}
              @selected={{this.selectedGroupByDimension}}
              @onChange={{this.updateGroupBy}}
              as |dim|
            >
              <span>{{dim.label}}</span>
            </BoxelSelect>
          </FieldContainer>
          {{#if @onToggleHideEmpty}}
            <FieldContainer
              @label='Hide empty'
              @inline={{true}}
              class='hide-empty-field'
            >
              <Switch
                @isEnabled={{@hideEmpty}}
                @onChange={{@onToggleHideEmpty}}
                @label='Hide empty columns'
              />
            </FieldContainer>
          {{/if}}
          <span class='kanban-card-count' data-test-issue-tracker-card-count>
            {{#if (eq @cards.length 1)}}
              1 card
            {{else}}
              {{@cards.length}}
              cards
            {{/if}}
          </span>
        </div>
      </header>
      <div class='kanban-body'>
        <div class='kanban-area'>
          <KanbanPlane
            @boardLabel={{@boardTitle}}
            @columns={{this.kanbanColumns}}
            @placements={{this.placements}}
            @hideEmpty={{@hideEmpty}}
            @onOpen={{@onOpen}}
          >
            <:card as |placement|>
              {{#let (get @cards placement.index) as |entry|}}
                {{#if entry}}
                  <div
                    class='kanban-card-wrap'
                    data-test-issue-tracker-card={{entry.id}}
                  >
                    <entry.component />
                  </div>
                {{/if}}
              {{/let}}
            </:card>
          </KanbanPlane>
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

        container-type: inline-size;
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--board-bg);
        color: var(--board-fg);
        overflow: hidden;
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
        gap: 0.5rem;
      }
      .kanban-heading {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .toolbar-right {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: var(--boxel-sp-sm);
        color: var(--board-muted-fg);
      }
      .group-by-field :deep(.label-container),
      .hide-empty-field :deep(.label-container) {
        font-size: 0.75rem;
        color: var(--board-muted-fg);
      }
      .group-by-field :deep(.ember-power-select-trigger) {
        font-size: 0.75rem;
        min-height: unset;
        padding: 0.125rem 0.375rem;
      }
      .kanban-title {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
        min-width: 0;
      }
      .kanban-title svg {
        flex-shrink: 0;
      }
      .kanban-title-text {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-width: 0;
      }
      .kanban-card-count {
        font-size: 0.75rem;
        color: var(--board-muted-fg);
        padding: 0.125rem 0.5rem;
        background: var(--board-muted-bg);
        border-radius: 4px;
        white-space: nowrap;
      }
      .kanban-body {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
        position: relative;
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

      /* ── Narrow (< 640px): stack toolbar ── */
      @container (width < 640px) {
        .kanban-toolbar {
          flex-wrap: wrap;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .toolbar-left {
          flex: 1;
          min-width: 0;
        }
        .toolbar-right {
          flex-shrink: 0;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .kanban-area :deep(.col-collapse-btn) {
          opacity: 0.5;
        }
      }

      /* ── Very narrow (< 420px): further compress ── */
      @container (width < 420px) {
        .kanban-toolbar {
          padding: var(--boxel-sp-2xs);
        }
        .kanban-title {
          font-size: 0.875rem;
        }
      }
    </style>
  </template>
}
