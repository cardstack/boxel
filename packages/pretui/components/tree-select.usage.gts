// Pretui — TreeSelect usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TreeSelect } from './tree-select';
import type { TreeNode } from './tree';

const TEAS: TreeNode[] = [
  { id: 'green', label: 'Green', children: [{ id: 'sencha', label: 'Sencha' }, { id: 'gyokuro', label: 'Gyokuro' }, { id: 'matcha', label: 'Matcha' }] },
  { id: 'oolong', label: 'Oolong', children: [{ id: 'dhp', label: 'Da Hong Pao' }, { id: 'tgy', label: 'Tieguanyin' }] },
  { id: 'black', label: 'Black', children: [{ id: 'assam', label: 'Assam' }, { id: 'keemun', label: 'Keemun' }] },
  { id: 'puer', label: 'Pu-erh' },
];

export class TreeSelectUsage extends Component {
  teas = TEAS;
  @tracked value: string[] = ['green', 'sencha', 'gyokuro', 'matcha', 'dhp'];
  @tracked multiple = true;
  @tracked cascade = true;
  setValue = (v: string[]) => (this.value = v);
  setMultiple = (v: boolean) => {
    this.multiple = v;
    this.value = [];
  };
  setCascade = (v: boolean) => (this.cascade = v);
  get usage() {
    let bits = ['@nodes={{this.teas}}', '@value={{this.checked}}', '@onChange={{this.setChecked}}', "@label='Teas'"];
    if (!this.multiple) bits.push('@multiple={{false}}');
    if (!this.cascade) bits.push('@cascade={{false}}');
    return `<TreeSelect ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='TreeSelect'
      @description='A select whose popup is a checkable tree. With cascade on, checking a branch checks everything under it, a partly checked branch reads as mixed, and a fully checked branch shows as one chip. The value is every checked id in tree order. Single mode picks one node and closes.'
      @source={{this.usage}}
    >
      <:example>
        <div class='tsl-demo'>
          <TreeSelect @nodes={{this.teas}} @value={{this.value}} @onChange={{this.setValue}} @multiple={{this.multiple}} @cascade={{this.cascade}} @label='Teas' @placeholder='Any tea' />
          <p class='tsl-demo-value'>Value: <code>{{#each this.value as |v|}}{{v}} {{/each}}</code></p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object @name='nodes' @required={{true}} @description='The same TreeNode shape as Tree.' />
        <Args.Object @name='value' @description='Checked ids in tree order. defaultValue seeds the uncontrolled form.' />
        <Args.Action @name='onChange' />
        <Args.Bool @name='multiple' @value={{this.multiple}} @defaultValue={{true}} @onInput={{this.setMultiple}} />
        <Args.Bool @name='cascade' @value={{this.cascade}} @defaultValue={{true}} @onInput={{this.setCascade}} />
        <Args.Object @name='defaultExpanded' @description='Branches open when the popup opens.' />
        <Args.Number @name='maxChips' @defaultValue={{3}} @description='Chips before +N.' />
        <Args.String @name='label' />
        <Args.String @name='placeholder' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .tsl-demo {
        display: grid;
        gap: var(--space-2, 0.375rem);
        max-inline-size: 22rem;
        padding-block-end: 18rem;
      }
      .tsl-demo-value {
        margin: 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_TREE_SELECT: Record<string, unknown> = {
  TreeSelect: TreeSelectUsage,
};
