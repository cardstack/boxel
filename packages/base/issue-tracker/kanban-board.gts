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
} from '../card-api';
import StringField from '../string';
import { tracked } from '@glimmer/tracking';
import Modifier from 'ember-modifier';
import { get } from '@ember/helper';
import KanbanIcon from '@cardstack/boxel-icons/columns-3';

import { GridPlacementField } from './grid-placement';
import { KanbanColumnField } from './kanban-column';
import { KanbanPlane } from './kanban-plane';
import { KanbanDragManager } from './kanban-drag';
import { type KanbanPlacement } from './kanban-engine';
import { Project, Issue, issueStatusOptions } from './issue';

// Chromeless modifier
class Chromeless extends Modifier {
  modify(el: HTMLElement) {
    const strip = () => {
      el.querySelectorAll(
        '[data-test-card-header], [data-test-edit-button], [data-test-more-options-button], ' +
          '.card-container-header, .operator-mode-card-header, .overlay-card-header, ' +
          'header.card-header, .overlay-button, .card-container-overlay, ' +
          '[data-test-overlay-card-header], .hover-button',
      ).forEach((node) => ((node as HTMLElement).style.display = 'none'));
      const firstChild = el.firstElementChild as HTMLElement | null;
      if (firstChild) {
        firstChild.style.width = '100%';
      }
    };
    strip();
    const observer = new MutationObserver(strip);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────── //

function placementsToKanban(fields: GridPlacementField[]): KanbanPlacement[] {
  return (fields ?? []).map((f, i) => ({
    index: i, // array position = card index
    column: 0, // derived from computedStatus at read time, not stored
    sortOrder: f.row ?? 1,
  }));
}

class Isolated extends Component<typeof KanbanBoard> {
  @tracked selectedCardIndex: number | null = null;
  dragManager: KanbanDragManager | null = null;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.initManager();
  }

  initManager(): void {
    // ²⁰
    this.dragManager = new KanbanDragManager({
      placements: () => this.kanbanPlacements,
      columnCount: () => this.args.model?.columns?.length ?? 4,
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
    const fields = this.args.model?.placements;
    const cards = this.args.model?.cards ?? [];
    const columns = this.args.model?.columns ?? [];

    if (!fields || fields.length === 0) {
      if ((cards as any[]).length === 0) return [];
      const colSortOrders: Record<number, number> = {};
      return (cards as any[]).map((card: any, index: number) => {
        const status = card.computedStatus;
        const colIndex = (columns as any[]).findIndex(
          (col: any) => col.key === status,
        );
        const column = colIndex >= 0 ? colIndex : 0;
        colSortOrders[column] = (colSortOrders[column] ?? 0) + 1;
        return { index, column, sortOrder: colSortOrders[column] };
      });
    }

    // Reconcile saved placements with each card's current computedStatus so
    // that editing a status outside the board moves the card to the right column.
    const maxSortOrder: Record<number, number> = {};
    const result = placementsToKanban(fields).map((p) => {
      const card = (cards as any[])[p.index];
      const status = card?.computedStatus;
      const colIndex = (columns as any[]).findIndex(
        (col: any) => col.key === status,
      );
      const column = colIndex >= 0 ? colIndex : 0;
      maxSortOrder[column] = Math.max(maxSortOrder[column] ?? 0, p.sortOrder);
      return { ...p, column };
    });

    // Cards added after the last drag won't have a saved placement — append them.
    (cards as any[]).slice(fields.length).forEach((card: any, i: number) => {
      const status = card?.computedStatus;
      const colIndex = (columns as any[]).findIndex(
        (col: any) => col.key === status,
      );
      const column = colIndex >= 0 ? colIndex : 0;
      maxSortOrder[column] = (maxSortOrder[column] ?? 0) + 1;
      result.push({ index: fields.length + i, column, sortOrder: maxSortOrder[column] });
    });

    return result;
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
    try {
      const model = this.args.model;
      if (!model) return;

      // Sync each card's status to match its new column
      const cards = model.cards as any[];
      const columns = model.columns as any[];
      if (cards && columns) {
        for (const np of newPlacements) {
          const card = cards[np.index];
          const col = columns[np.column];
          if (card && col && card.status !== col.key) {
            card.status = col.key;
          }
        }
      }

      const existingFields = model.placements as
        | GridPlacementField[]
        | undefined;

      if (existingFields && existingFields.length > 0) {
        for (const np of newPlacements) {
          const existing = existingFields[np.index]; // array position = card index
          if (existing) {
            existing.row = np.sortOrder; // col is derived from computedStatus, not stored
          }
        }
      } else {
        const fields = newPlacements
          .slice()
          .sort((a, b) => a.index - b.index) // ensure placements[i] = card i
          .map((p) => {
            const f = new GridPlacementField();
            f.row = p.sortOrder; // col is derived from computedStatus, not stored
            return f;
          });
        model.placements = fields;
      }
    } catch (e) {
      console.error('Kanban: Failed to save placements', e);
    }
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
      </header>

      <div class='kanban-body'>
        <KanbanPlane
          @columns={{this.kanbanColumns}}
          @placements={{this.kanbanPlacements}}
          @manager={{this.manager}}
          @interactive={{true}}
        >
          <:card as |placement|>
            {{#let (get @fields.cards placement.index) as |CardField|}}
              {{#if CardField}}
                <div class='kanban-card-wrap' {{Chromeless}}>
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
                <div class='ghost-wrap' {{Chromeless}}>
                  <CardField @format='fitted' />
                </div>
              {{/if}}
            {{/let}}
          </:ghost>
        </KanbanPlane>
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
    </style>
  </template>
}

// ── KanbanBoard ───────────────────────────────────────────────────────── //

export class KanbanBoard extends CardDef {
  static displayName = 'Kanban Board';
  static icon = KanbanIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field project = linksTo(() => Project);
  @field cards = linksToMany(Issue, {
    computeVia: function (this: KanbanBoard) {
      return this.project?.issues ?? [];
    },
  });
  @field columns = containsMany(KanbanColumnField, {
    computeVia: function (this: KanbanBoard) {
      let cols = issueStatusOptions ?? [];
      return cols.map(
        (c) =>
          new KanbanColumnField({
            key: c.value,
            label: c.label,
          }),
      );
    },
  });
  @field placements = containsMany(GridPlacementField); // row = sort order within column; col is derived from computedStatus

  @field cardTitle = contains(StringField, {
    computeVia: function (this: KanbanBoard) {
      return this.cardInfo?.name ?? this.title ?? 'Untitled Kanban';
    },
  });

  // ── Isolated ───────────────────────────────────────────────────────

  static isolated = Isolated;

  // ── Fitted ─────────────────────────────────────────────────────────

  static fitted = class Fitted extends Component<typeof KanbanBoard> {
    // ²⁶
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
