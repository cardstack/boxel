// Pretui — KeyValue usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from '../freestyle';
import { Token } from './token';
import { KeyValue } from './key-value';

const LOT_DETAILS = [
  { key: 'Lot', value: 'B-103' },
  { key: 'Tea', value: 'Gyokuro' },
  { key: 'Origin', value: 'Shizuoka' },
  { key: 'Harvest', value: 'First flush' },
];

class KeyValueUsage extends Component {
  items = LOT_DETAILS;
  <template>
    <FreestyleUsage @name='KeyValue' @description='A semantic description list for compact record facts, with an optional value block for links, tokens or status.' @source='<KeyValue @items={{this.items}} />'>
      <:example><KeyValue @items={{this.items}}><:value as |item|>{{#if (this.isLot item)}}<Token @value={{item.value}} />{{else}}{{item.value}}{{/if}}</:value></KeyValue></:example>
      <:api as |Args|><Args.Object @name='items' @value={{this.items}} /><Args.Yield @name='value' @description='Receives the current item.' /></:api>
    </FreestyleUsage>
  </template>
  isLot = (item: { key: string }) => item.key === 'Lot';
}

export const DEMOS_KEY_VALUE: Record<string, unknown> = {
  KeyValue: KeyValueUsage,
};
