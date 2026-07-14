import { get } from '@ember/helper';
import { on } from '@ember/modifier';

import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

import {
  Button,
  KanbanPlane,
  autoPlaceKanban,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import SquareKanban from '@cardstack/boxel-icons/square-kanban';

// PATTERN: layout-kanban-drag-drop
//
// Persist board order separately from the linked cards:
//   linked cards own identity and content
//   placements own lane + sort order
//   KanbanPlane owns pointer/keyboard drag behavior

export class BoardColumn extends FieldDef {
  static displayName = 'Board Column';

  @field key = contains(StringField);
  @field label = contains(StringField);
  @field color = contains(ColorField);
  @field collapsed = contains(BooleanField);
  @field sortOrder = contains(NumberField);
  @field wipLimit = contains(NumberField);

  static embedded = class extends Component<typeof BoardColumn> {
    <template>
      <span class='column-chip'>
        <span class='dot' style='background: {{@model.color}}'></span>
        {{@model.label}}
      </span>
      <style scoped>
        .column-chip { display: inline-flex; align-items: center; gap: 0.375rem; }
        .dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; }
      </style>
    </template>
  };
}

export class BoardPlacement extends FieldDef {
  static displayName = 'Board Placement';

  @field itemId = contains(StringField);
  @field columnKey = contains(StringField);
  @field sortOrder = contains(NumberField);

  static embedded = class extends Component<typeof BoardPlacement> {
    <template>
      <span>{{@model.itemId}} -> {{@model.columnKey}} #{{@model.sortOrder}}</span>
    </template>
  };
}

export class WorkItem extends CardDef {
  static displayName = 'Work Item';

  @field title = contains(StringField);
  @field owner = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: WorkItem) {
      return this.cardInfo.name?.trim() || this.title || 'Untitled work item';
    },
  });

  static isolated = class extends Component<typeof WorkItem> {
    <template>
      <article class='item-isolated'>
        <h1><@fields.cardTitle /></h1>
        {{#if @model.owner}}<p>Owner: {{@model.owner}}</p>{{/if}}
      </article>
      <style scoped>
        .item-isolated { display: grid; gap: 0.75rem; padding: 1rem; color: var(--foreground); }
        h1 { margin: 0; font-size: 1.25rem; }
        p { margin: 0; color: var(--muted-foreground); }
      </style>
    </template>
  };

  static embedded = class extends Component<typeof WorkItem> {
    <template>
      <span>{{@model.title}}</span>
    </template>
  };

  static fitted = class extends Component<typeof WorkItem> {
    <template>
      <article class='item-card'>
        <strong>{{@model.title}}</strong>
        {{#if @model.owner}}<span>{{@model.owner}}</span>{{/if}}
      </article>
      <style scoped>
        .item-card {
          height: 100%;
          display: grid;
          align-content: start;
          gap: 0.375rem;
          padding: 0.75rem;
          background: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          overflow: hidden;
        }
        strong { font-size: 0.875rem; line-height: 1.25; }
        span { font-size: 0.75rem; color: var(--muted-foreground); }
      </style>
    </template>
  };
}

export class WorkBoard extends CardDef {
  static displayName = 'Work Board';
  static prefersWideFormat = true;
  static icon = SquareKanban;

  @field boardTitle = contains(StringField);
  @field cards = linksToMany(() => WorkItem);
  @field columns = containsMany(BoardColumn);
  @field placements = containsMany(BoardPlacement);
  @field hideEmptyColumns = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: WorkBoard) {
      return this.cardInfo.name?.trim() || this.boardTitle || 'Work Board';
    },
  });

  static isolated = class extends Component<typeof WorkBoard> {
    get columns(): KanbanColumnConfig[] {
      return [...(this.args.model.columns ?? [])]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((column) => ({
          key: column.key ?? null,
          label: column.label ?? null,
          color: column.color ?? null,
          collapsed: column.collapsed ?? null,
          sortOrder: column.sortOrder ?? null,
          wipLimit: column.wipLimit ?? null,
        }));
    }

    get placements(): KanbanPlacement[] {
      let cards = this.args.model.cards ?? [];
      let raw = this.args.model.placements ?? [];

      let stored = raw
        .map((placement) => {
          let column = this.columns.findIndex(
            (candidate) => candidate.key === placement.columnKey,
          );
          let index = cards.findIndex(
            (card) => (card as CardDef | undefined)?.id === placement.itemId,
          );

          if (column === -1 || index === -1) {
            return null;
          }

          return {
            column,
            index,
            sortOrder: placement.sortOrder ?? 0,
          } satisfies KanbanPlacement;
        })
        .filter((placement): placement is KanbanPlacement => placement !== null);

      return stored.length
        ? stored
        : autoPlaceKanban(cards.length, this.columns.length);
    }

    get cardCount(): number {
      return this.args.model.cards?.length ?? 0;
    }

    handleChange = (next: KanbanPlacement[]) => {
      let cards = this.args.model.cards ?? [];

      this.args.model.placements = next.map((placement) =>
        Object.assign(new BoardPlacement(), {
          itemId: (cards[placement.index] as CardDef | undefined)?.id ?? '',
          columnKey: this.columns[placement.column]?.key ?? '',
          sortOrder: placement.sortOrder,
        }),
      );
    };

    toggleHideEmptyColumns = (): void => {
      this.args.model.hideEmptyColumns = !this.args.model.hideEmptyColumns;
    };

    <template>
      <section class='board'>
        <header class='board-header'>
          <h1><@fields.cardTitle /></h1>
          <Button class='toggle' {{on 'click' this.toggleHideEmptyColumns}}>
            {{#if @model.hideEmptyColumns}}Show empty{{else}}Hide empty{{/if}}
          </Button>
        </header>

        <p class='summary'>
          {{#if (eq this.cardCount 1)}}1 card{{else}}{{this.cardCount}} cards{{/if}}
        </p>

        <div class='board-plane'>
          {{#if this.columns.length}}
            <KanbanPlane
              @boardLabel={{@model.boardTitle}}
              @columns={{this.columns}}
              @placements={{this.placements}}
              @hideEmpty={{@model.hideEmptyColumns}}
              @onChange={{this.handleChange}}
            >
              <:card as |placement|>
                {{#let (get @fields.cards placement.index) as |CardField|}}
                  {{#if CardField}}
                    <CardField @format='fitted' @displayContainer={{false}} />
                  {{/if}}
                {{/let}}
              </:card>
              <:ghost as |dragIndex|>
                {{#let (get @fields.cards dragIndex) as |CardField|}}
                  {{#if CardField}}
                    <CardField @format='fitted' @displayContainer={{false}} />
                  {{/if}}
                {{/let}}
              </:ghost>
            </KanbanPlane>
          {{else}}
            <div class='empty'>Add columns before using this board.</div>
          {{/if}}
        </div>
      </section>
      <style scoped>
        .board {
          height: 100%;
          min-height: 0;
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr);
          background: var(--background);
          color: var(--foreground);
        }
        .board-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border);
          background: var(--card);
        }
        h1 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0;
          font-size: 1rem;
          font-weight: 650;
        }
        .toggle { white-space: nowrap; }
        .summary {
          margin: 0;
          padding: 0.5rem 1rem;
          color: var(--muted-foreground);
          font-size: 0.8125rem;
        }
        .board-plane {
          min-height: 0;
          overflow: hidden;
        }
        .empty {
          padding: 1rem;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };

  static embedded = class extends Component<typeof WorkBoard> {
    <template>
      <span><@fields.cardTitle /></span>
    </template>
  };

  static fitted = class extends Component<typeof WorkBoard> {
    <template>
      <span class='board-fitted'><@fields.cardTitle /></span>
      <style scoped>
        .board-fitted { display: inline-flex; align-items: center; gap: 0.375rem; }
      </style>
    </template>
  };
}
