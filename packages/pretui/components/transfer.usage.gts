// Pretui — Transfer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Transfer } from './transfer';
import type { PickerRecord } from '../internal/forms-picker';

const COLUMNS: PickerRecord[] = [
  { id: 'lot', label: 'Lot', meta: 'a0X…' },
  { id: 'tea', label: 'Tea', meta: 'name' },
  { id: 'origin', label: 'Origin', meta: 'estate · region' },
  { id: 'harvest', label: 'Harvest', meta: 'date' },
  { id: 'chests', label: 'Chests', meta: 'count' },
  { id: 'grade', label: 'Grade', meta: 'cupping score' },
];

class TransferUsage extends Component {
  columns = COLUMNS;
  @tracked value: string[] = ['lot', 'tea', 'chests'];
  setValue = (ids: string[]) => (this.value = ids);

  <template>
    <FreestyleUsage
      @name='Transfer'
      @description='DuelingPicklist under the Ant name: two lists with move buttons, where the order of the right-hand list is the value. Import it when a port already says Transfer; the component and its writeup are DuelingPicklist.'
      @source="<Transfer @options={{this.columns}} @value={{this.value}} @label='Report columns' @onValueChange={{this.setValue}} />"
    >
      <:example>
        <Transfer
          @options={{this.columns}}
          @value={{this.value}}
          @label='Report columns'
          @availableLabel='Hidden'
          @selectedLabel='Shown, in order'
          @rows={{6}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object @name='options' @required={{true}} @value={{this.columns}} @description='Every record: {id, label, meta?, icon?, locked?}. Both lists derive from this plus @value.' />
        <Args.Array @name='value' @value={{this.value}} @onInput={{this.setValue}} @description='Ordered ids of the selected list. Ant targetKeys, with order kept.' />
        <Args.Base @name='availableLabel / selectedLabel' @type='String' @description='Headings over the two lists; Ant titles.' />
        <Args.Bool @name='reorder' @defaultValue={{true}} @description='The up/down column on the selected side.' />
        <Args.Action @name='onValueChange' @description='Fires with the full ordered id list after every move.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_TRANSFER: Record<string, unknown> = {
  Transfer: TransferUsage,
};
