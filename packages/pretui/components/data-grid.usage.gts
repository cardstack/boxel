// Pretui — DataGrid usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { DataGrid } from './data-grid';
import { LOT_ROWS } from '../demo-foundations';

const LOT_COLUMNS = [
  { key: 'lot', label: 'Lot', mono: true },
  { key: 'tea', label: 'Tea' },
  { key: 'origin', label: 'Origin' },
  { key: 'chests', label: 'Chests', num: true, align: 'right' as const },
];

class DataGridUsage extends Component {
  columns = LOT_COLUMNS;
  rows = LOT_ROWS;
  @tracked selected: unknown[] = [];
  setSelected = (keys: unknown[]) => (this.selected = keys);
  cell = (row: Record<string, unknown>, column: { key: string }) => String(row[column.key] ?? '');
  <template>
    <FreestyleUsage
      @name='DataGrid'
      @description='The read-only records table: sortable headers, zebra rows and optional native-checkbox selection. Row identity is explicit and sample data is visible in the API panel.'
      @source='<DataGrid @rowKey="lot" @selectable="true" … />'
      @viewportMode='wide'
    >
      <:example>
        <DataGrid @columns={{this.columns}} @rows={{this.rows}} @rowKey='lot' @selectable={{true}} @onSelectedChange={{this.setSelected}}>
          <:cell as |row column|>{{this.cell row column}}</:cell>
        </DataGrid>
        <p class='foundation-readout'>Selected: {{this.selected.length}}</p>
      </:example>
      <:api as |Args|>
        <Args.Object @name='columns' @value={{this.columns}} />
        <Args.Object @name='rows' @value={{this.rows}} />
        <Args.String @name='rowKey' @value='lot' @defaultValue='id' />
        <Args.Bool @name='selectable' @value={{true}} />
        <Args.Action @name='onSortChange' />
        <Args.Action @name='onSelectedChange' />
        <Args.Yield @name='cell' @description='Receives row and column.' />
      </:api>
    </FreestyleUsage>
    <style scoped>.foundation-readout { margin: 8px 0 0; font: var(--text-ui-xs) var(--font-mono); color: var(--muted-foreground); }</style>
  </template>
}

export const DEMOS_DATA_GRID: Record<string, unknown> = {
  DataGrid: DataGridUsage,
};
