// Pretui — Table usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';
import { Table } from './table';
import { LOT_ROWS } from '../demo-foundations';

class TableUsage extends Component {
  rows = LOT_ROWS;
  @tracked framed = true;
  setFramed = (v: boolean) => (this.framed = v);
  <template>
    <FreestyleUsage
      @name='Table'
      @description='A yieldable table shell for custom cells. It shares DataGrid cloth but leaves row data, semantics and interactions with the caller.'
      @source='<Table><:head>…</:head><:body>…</:body></Table>'
      @viewportMode='wide'
    >
      <:example>
        <Table @framed={{this.framed}}>
          <:head><tr><th>Lot</th><th>Tea</th><th>Origin</th><th>Chests</th></tr></:head>
          <:body>{{#each this.rows as |row|}}<tr><td><Token @value={{row.lot}} /></td><td>{{row.tea}}</td><td>{{row.origin}}</td><td>{{row.chests}}</td></tr>{{/each}}</:body>
        </Table>
      </:example>
      <:api as |Args|>
        <Args.Object @name='sample rows' @value={{this.rows}} />
        <Args.Bool
          @name='framed'
          @value={{this.framed}}
          @defaultValue={{true}}
          @description='Off drops the radius and hairline, for a table inside a panel.'
          @onInput={{this.setFramed}}
        />
        <Args.Yield @name='head' @description='Table header rows.' />
        <Args.Yield @name='body' @description='Table body rows.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_TABLE: Record<string, unknown> = {
  Table: TableUsage,
};
