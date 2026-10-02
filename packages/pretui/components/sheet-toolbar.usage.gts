// Pretui — SheetToolbar usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { Button } from './button';
import { FreestyleUsage } from './freestyle-usage';
import { Sheet } from './sheet';
import { SheetToolbar } from './sheet-toolbar';
import type { SheetColumn, SheetDatum } from './sheet';
import { LEDGER_COLUMNS, buildLedger } from '../demo-surfaces-grid';
import type { Lot } from '../demo-surfaces-grid';

// ── SheetToolbar ─────────────────────────────────────────────────────────
// Ported from nothing: boxel-grid's own <Toolbar> suite is a declarative
// grid-scoped chrome builder whose name collides with Pretui's structure
// Toolbar, so this is Pretui's own strip built from SearchInput / Button /
// Token. It cannot be demoed standalone — a toolbar with no api is a
// toolbar with nothing to say — so this page mounts a real six-lot sheet
// and knobs only the strip.
class SheetToolbarUsage extends Component {
  ledger: Lot[] = buildLedger(6);

  @tracked title = 'Bonded warehouse';
  @tracked hideSearch = false;
  @tracked placeholder = 'Filter rows…';
  @tracked showActions = true;
  @tracked exported = '';

  setTitle = (v: string) => (this.title = v);
  setHideSearch = (v: boolean) => (this.hideSearch = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setShowActions = (v: boolean) => (this.showActions = v);
  exportCsv = (_event: Event) => {
    this.exported = `${this.ledger.length} lots queued for export`;
  };

  get rows(): SheetDatum[] {
    return this.ledger;
  }
  get columns(): SheetColumn[] {
    return LEDGER_COLUMNS;
  }

  get usage() {
    let bits = [`@api={{api}}`];
    if (this.title) bits.push(`@title='${this.title}'`);
    if (this.hideSearch) bits.push('@hideSearch={{true}}');
    if (this.placeholder !== 'Filter rows…') {
      bits.push(`@placeholder='${this.placeholder}'`);
    }
    let open = `<SheetToolbar ${bits.join(' ')}`;
    return this.showActions
      ? `<Sheet @rows={{this.rows}} @columns={{this.columns}}>\n  <:toolbar as |api|>\n    ${open}>\n      <:actions>\n        <Button @size='xs'>Export CSV</Button>\n      </:actions>\n    </SheetToolbar>\n  </:toolbar>\n</Sheet>`
      : `<Sheet @rows={{this.rows}} @columns={{this.columns}}>\n  <:toolbar as |api|>\n    ${open} />\n  </:toolbar>\n</Sheet>`;
  }

  <template>
    <FreestyleUsage
      @name='SheetToolbar'
      @description='The chrome strip for <Sheet>: a title, the live row count as a machine value (Law 3 — “12/16” when a filter is on, plain “16” when it is not), the quick-filter field, and a sort reset that only exists while there is a sort to reset. It is a pure view over the SheetApi the sheet yields to <:toolbar>, so it holds no state of its own: type in the filter and the count, the status line, and the row model all move together. Composed from Pretui’s own SearchInput / Button / Token rather than boxel-grid’s <Toolbar> suite, which is grid-scoped declarative chrome with a colliding name. Slot <:actions> for anything else the table needs.'
      @source={{this.usage}}
    >
      <:example>
        <Sheet
          @rows={{this.rows}}
          @columns={{this.columns}}
          @label='Bonded warehouse'
          @density='compact'
          @maxHeight='12rem'
        >
          <:toolbar as |api|>
            <SheetToolbar
              @api={{api}}
              @title={{this.title}}
              @hideSearch={{this.hideSearch}}
              @placeholder={{this.placeholder}}
            >
              <:actions>
                {{#if this.showActions}}
                  <Button
                    @tone='neutral'
                    @appearance='outlined'
                    @size='xs'
                    {{on 'click' this.exportCsv}}
                  >Export CSV</Button>
                {{/if}}
              </:actions>
            </SheetToolbar>
          </:toolbar>
        </Sheet>

        {{#if this.exported}}
          <p class='sg-readout'>{{this.exported}}</p>
        {{/if}}
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='api'
          @description='The SheetApi yielded by <Sheet>’s <:toolbar> block — { query, setQuery, sort, toggleSort, clearSort, visibleCount, totalCount, columns }. Required: the strip renders nothing meaningful without it, and every control on it is a call back into the sheet.'
          @required={{true}}
          @hideControls={{true}}
        />
        <Args.String
          @name='title'
          @description='Name of the table, rendered as the strip’s title. Omit it and the strip opens straight with the count.'
          @value={{this.title}}
          @onInput={{this.setTitle}}
        />
        <Args.Bool
          @name='hideSearch'
          @description='Drops the quick-filter field — for a sheet whose filtering is driven from elsewhere (a controlled @filter on the Sheet, say).'
          @defaultValue={{false}}
          @value={{this.hideSearch}}
          @onInput={{this.setHideSearch}}
        />
        <Args.String
          @name='placeholder'
          @description='Placeholder for the quick-filter field. Say what a reader can type — column values, not "Search".'
          @defaultValue='Filter rows…'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Yield
          @name='<:actions>'
          @description='Extra controls, right-aligned after the search field. A slot rather than a prop (Law 7): export, add-row, and column pickers are the caller’s components, not strings this strip could render for them.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='<:actions> filled'
          @description='Not a SheetToolbar arg — a knob on this page, toggling whether the slot has anything in it, so you can see the strip’s spacing both ways.'
          @defaultValue={{true}}
          @value={{this.showActions}}
          @onInput={{this.setShowActions}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .sg-readout {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SHEET_TOOLBAR: Record<string, unknown> = {
  SheetToolbar: SheetToolbarUsage,
};
