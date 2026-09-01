import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, array } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Board, type BoardColumn } from './board';
import { Opportunity } from './opportunity';
import { PIPELINE_STAGES, STAGE_COLORS } from './pipeline-stage-field';

// Sales Pipeline — a Kanban board of Opportunities/Deals grouped by Pipeline
// Stage, with sort and close-window filtering.
//
// Same capability as the board `revenue-os.gts`'s isolated view renders
// inline (columns from PIPELINE_STAGES, sort by value/probability/staleness,
// forecast-window filter) — but packaged as a standalone component so a
// second consumer can mount it without duplicating the logic. Kept
// deliberately dumb: it takes `@items` from the consumer rather than running
// its own query, so it works the same whether the consumer's Opportunities
// come from a live realm search or a fixed list.

export type BoardSortMode = 'value' | 'probability' | 'stale';
export type CloseWindow = 'all' | 'week' | 'month' | 'quarter';

interface SalesPipelineSignature {
  Args: {
    items: Opportunity[];
    onOpen?: (item: Opportunity) => void;
  };
  Element: HTMLElement;
}

function closeWindowEnd(window: CloseWindow): Date | undefined {
  if (window === 'all') return undefined;
  let end = new Date();
  if (window === 'week') end.setDate(end.getDate() + 7);
  if (window === 'month') end.setMonth(end.getMonth() + 1);
  if (window === 'quarter') end.setMonth(end.getMonth() + 3);
  return end;
}

export default class SalesPipeline extends GlimmerComponent<SalesPipelineSignature> {
  @tracked sortMode: BoardSortMode = 'value';
  @tracked closeWindow: CloseWindow = 'all';

  boardColumns: BoardColumn[] = PIPELINE_STAGES.map((s) => ({
    key: s,
    label: s,
    color: STAGE_COLORS[s],
  }));

  columnKeyFor = (item: Opportunity) => item?.stage;

  get boardItems(): Opportunity[] {
    let items = this.args.items ?? [];
    let closesBy = closeWindowEnd(this.closeWindow);
    if (closesBy) {
      // A forecast window looks forward: a deal with no close date has not
      // been forecast at all, so it cannot be claimed to close in one.
      let from = new Date();
      from.setHours(0, 0, 0, 0);
      items = items.filter((o) => {
        if (!o.closeDate) return false;
        let at = new Date(o.closeDate);
        return at >= from && at <= closesBy;
      });
    }
    let sorted = [...items];
    if (this.sortMode === 'value') {
      sorted.sort((a, b) => (b.value?.amount ?? 0) - (a.value?.amount ?? 0));
    } else if (this.sortMode === 'probability') {
      sorted.sort(
        (a, b) => (b.effectiveProbability ?? 0) - (a.effectiveProbability ?? 0),
      );
    } else if (this.sortMode === 'stale') {
      sorted.sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
    }
    return sorted;
  }

  @action
  setSortMode(mode: BoardSortMode) {
    this.sortMode = mode;
  }

  @action
  setCloseWindow(window: CloseWindow) {
    this.closeWindow = window;
  }

  <template>
    <div class='sales-pipeline' ...attributes>
      <div class='sp-controls'>
        <div class='sp-group'>
          <button
            type='button'
            class='sp-btn {{if (eq this.sortMode "value") "is-active"}}'
            {{on 'click' (fn this.setSortMode 'value')}}
          >Value</button>
          <button
            type='button'
            class='sp-btn {{if (eq this.sortMode "probability") "is-active"}}'
            {{on 'click' (fn this.setSortMode 'probability')}}
          >Probability</button>
          <button
            type='button'
            class='sp-btn {{if (eq this.sortMode "stale") "is-active"}}'
            {{on 'click' (fn this.setSortMode 'stale')}}
          >Stalest</button>
        </div>
        <div class='sp-group'>
          {{#each (array 'all' 'week' 'month' 'quarter') as |w|}}
            <button
              type='button'
              class='sp-btn {{if (eq this.closeWindow w) "is-active"}}'
              {{on 'click' (fn this.setCloseWindow w)}}
            >{{w}}</button>
          {{/each}}
        </div>
      </div>
      <Board
        @items={{this.boardItems}}
        @columns={{this.boardColumns}}
        @columnKeyFor={{this.columnKeyFor}}
        @onOpen={{@onOpen}}
      >
        <:card as |item|>
          {{item.cardTitle}}
        </:card>
      </Board>
    </div>
    <style scoped>
      .sales-pipeline {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .sp-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .sp-group {
        display: flex;
        gap: var(--boxel-sp-5xs, 0.25rem);
      }
      .sp-btn {
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: capitalize;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--boxel-border-radius-sm, 0.375rem);
        background: var(--card, #ffffff);
        color: var(--muted-foreground, #6b7280);
        cursor: pointer;
      }
      .sp-btn.is-active {
        background: var(--primary, #111111);
        color: var(--primary-foreground, #ffffff);
        border-color: var(--primary, #111111);
      }
    </style>
  </template>
}
