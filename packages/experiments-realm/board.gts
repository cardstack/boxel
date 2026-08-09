import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import {
  KanbanPlane,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';

export interface BoardColumn {
  key: string;
  label?: string;
  color?: string;
}

function itemAt(items: CardDef[], index: number): CardDef | undefined {
  return items[index];
}

interface BoardSignature {
  Args: {
    boardLabel?: string;
    columnKeyFor: (item: CardDef) => string | undefined;
    columns: BoardColumn[];
    items: CardDef[];
    onMove?: (item: CardDef, columnKey: string) => void;
  };
  Blocks: {
    card: [CardDef];
  };
  Element: HTMLElement;
}

export class Board extends GlimmerComponent<BoardSignature> {
  get kanbanColumns(): KanbanColumnConfig[] {
    return this.args.columns.map((c, i) => ({
      key: c.key,
      label: c.label ?? c.key,
      color: c.color ?? null,
      collapsed: null,
      sortOrder: i,
      wipLimit: null,
    }));
  }

  get placements(): KanbanPlacement[] {
    let counters = new Map<string, number>();
    let fallback = this.args.columns[0]?.key ?? '';
    let result: KanbanPlacement[] = [];
    this.args.items.forEach((item, index) => {
      if (!item) return;
      let columnId = this.args.columnKeyFor(item) ?? fallback;
      let sortOrder = (counters.get(columnId) ?? 0) + 1;
      counters.set(columnId, sortOrder);
      result.push({ columnId, index, sortOrder });
    });
    return result;
  }

  cardComponent = (card: CardDef) => {
    return (card.constructor as typeof CardDef).getComponent(card);
  };

  @action handleChange(next: KanbanPlacement[]) {
    for (let placement of next) {
      let item = this.args.items[placement.index];
      if (item && this.args.columnKeyFor(item) !== placement.columnId) {
        this.args.onMove?.(item, placement.columnId);
      }
    }
  }

  <template>
    <div class='board' ...attributes>
      <KanbanPlane
        @boardLabel={{@boardLabel}}
        @columns={{this.kanbanColumns}}
        @placements={{this.placements}}
        @onChange={{this.handleChange}}
      >
        <:card as |placement|>
          {{#let (itemAt @items placement.index) as |item|}}
            {{#if item}}
              {{#if (has-block 'card')}}
                {{yield item to='card'}}
              {{else}}
                <div class='board-card'>
                  {{#let (this.cardComponent item) as |C|}}
                    <C @format='fitted' />
                  {{/let}}
                </div>
              {{/if}}
            {{/if}}
          {{/let}}
        </:card>
        <:ghost as |index|>
          {{#let (itemAt @items index) as |item|}}
            {{#if item}}
              <div class='board-card board-ghost'>
                {{#let (this.cardComponent item) as |C|}}
                  <C @format='fitted' />
                {{/let}}
              </div>
            {{/if}}
          {{/let}}
        </:ghost>
      </KanbanPlane>
    </div>
    <style scoped>
      .board {
        width: 100%;
        height: 100%;
        overflow-x: auto;
      }
      .board-card {
        container-type: size;
        container-name: fitted-card;
        height: 140px;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--card, #ffffff);
        overflow: hidden;
      }
      .board-ghost {
        opacity: 0.85;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      }
    </style>
  </template>
}
