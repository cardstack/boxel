// Pretui — List usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Chip } from './chip';
import { StatusChip } from './status-chip';
import { Item } from './item';
import { List } from './list';
import type { ListingSizeArg } from '../internal/reading-listing';
import type { RowKey, SelectionMode } from '../data-component';
import { LOTS, MODES, SIZES, lotLabel } from '../examples-listing';
import type { Lot } from '../examples-listing';

class ListUsage extends Component {
  modes = MODES;
  sizes = SIZES;
  lots = LOTS;

  @tracked selectionMode: SelectionMode = 'multi';
  @tracked size: ListingSizeArg = 'm';
  @tracked divided = true;
  @tracked bordered = true;
  @tracked lastSelection = '—';
  @tracked lastActivated = '—';

  setSelectionMode = (v: string) => (this.selectionMode = v as SelectionMode);
  setSize = (v: string) => (this.size = v as ListingSizeArg);
  setDivided = (v: boolean) => (this.divided = v);
  setBordered = (v: boolean) => (this.bordered = v);

  rowKey = (row: Lot): RowKey => row.id;
  rowLabel = (row: Lot): string => lotLabel(row);
  onSelectionChange = (keys: RowKey[]) => {
    this.lastSelection = keys.length ? keys.join(', ') : 'none';
  };
  onActivate = (row: Lot) => {
    this.lastActivated = row.id;
  };
  meta = (row: Lot): string => String(row.kg) + ' kg';

  <template>
    <FreestyleUsage
      @name='List'
      @slug='list'
      @description='The row collection: ul/li semantics, one tab stop with arrows within, the same DataSource selection model DataTable uses, and the same loading / empty / error chrome. It is what a DataTable becomes when the pane is too narrow for columns.'
    >
      <:example>
        <div class='ls-demo'>
          <div class='ls-readout'>
            <span>selected
              <strong>{{this.lastSelection}}</strong></span>
            <span>activated
              <strong>{{this.lastActivated}}</strong></span>
          </div>
          <p class='ls-hint'>Tab to the list, then ↑/↓ to walk it, Home/End for
            the ends, Space to select, Enter to open.</p>

          <List
            @items={{this.lots}}
            @key={{this.rowKey}}
            @rowLabel={{this.rowLabel}}
            @label='Lots on the desk'
            @size={{this.size}}
            @selectionMode={{this.selectionMode}}
            @divided={{this.divided}}
            @bordered={{this.bordered}}
            @itemNoun='lot'
            @onSelectionChange={{this.onSelectionChange}}
            @onActivate={{this.onActivate}}
          >
            <:header>Twelve lots, newest first</:header>
            <:item as |row|>
              <Item @title={{row.tea}} @description={{row.supplier}}>
                <:leading>
                  <Chip @label={{row.id}} />
                </:leading>
                <:trailing>
                  {{this.meta row}}
                </:trailing>
                <:actions>
                  <StatusChip @value={{row.grade}} />
                </:actions>
              </Item>
            </:item>
          </List>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @value={{this.lots}}
          @description='The collection. items is the flat-collection noun; options and dataSource are accepted aliases so a shadcn or Ant shaped call still lands. Supply EITHER items or load.'
        />
        <Args.Action
          @name='rowLabel'
          @description='(row, index) => string. The row’s accessible name, used on its selection control. It defaults to "Row N", which is honest but poor — pass this.'
        />
        <Args.String
          @name='selectionMode'
          @value={{this.selectionMode}}
          @options={{this.modes}}
          @defaultValue='none'
          @description="'none', 'single' or 'multi'. Selection is a real checkbox or radio with its own name, never a listbox option: an option’s children are presentational, so a row holding a link, a button or a named avatar would lose all of it. A list of rich rows is a list."
          @onInput={{this.setSelectionMode}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{this.sizes}}
          @defaultValue='m'
          @description='Density on the house scale. Coarse pointers get a 44px row floor regardless, without changing the fine-pointer rhythm.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='divided'
          @value={{this.divided}}
          @defaultValue={{true}}
          @description='Hairline between rows.'
          @onInput={{this.setDivided}}
        />
        <Args.Bool
          @name='bordered'
          @value={{this.bordered}}
          @defaultValue={{false}}
          @description='Frame the whole list, header and footer included.'
          @onInput={{this.setBordered}}
        />
        <Args.Action
          @name='onActivate'
          @description='(row, index) => void — Enter on the focused row. A row with one obvious destination should carry a real anchor inside the item block instead; a click handler on a row is not a link.'
        />
        <Args.Object
          @name='selected'
          @description='Controlled selection (array of row keys); defaultSelected seeds the uncontrolled case, onSelectionChange reports every change either way.'
        />
        <Args.Bool
          @name='busy'
          @value={{false}}
          @defaultValue={{false}}
          @description='A caller-driven pending state: aria-busy without replacing the rows, so focus and scroll position survive. loading is accepted as an alias. This is React Aria’s isPending semantics rather than a disabled swap.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Named blocks: item (row, index, api) where api is { index, selected, active, toggle }; header and footer inside the frame; and loading / empty / error.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .ls-demo {
        display: grid;
        gap: var(--space-4, 11px);
        min-width: 0;
      }
      .ls-readout {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4, 11px);
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .ls-readout strong {
        color: var(--foreground);
        font-weight: 500;
      }
      .ls-hint {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_LIST: Record<string, unknown> = {
  List: ListUsage,
};
