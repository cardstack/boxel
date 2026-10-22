// Pretui — Cascader usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Cascader } from './cascader';
import type { CascaderOption } from './cascader';

const ORIGINS: CascaderOption[] = [
  {
    value: 'americas',
    label: 'Americas',
    children: [
      { value: 'colombia', label: 'Colombia', children: [{ value: 'huila', label: 'Huila' }, { value: 'narino', label: 'Nariño' }] },
      { value: 'guatemala', label: 'Guatemala', children: [{ value: 'antigua', label: 'Antigua' }] },
    ],
  },
  {
    value: 'africa',
    label: 'Africa',
    children: [
      { value: 'ethiopia', label: 'Ethiopia', children: [{ value: 'yirgacheffe', label: 'Yirgacheffe' }, { value: 'guji', label: 'Guji' }] },
      { value: 'kenya', label: 'Kenya', children: [{ value: 'nyeri', label: 'Nyeri' }] },
    ],
  },
  { value: 'asia', label: 'Asia', children: [{ value: 'yunnan', label: 'Yunnan' }] },
];

export class CascaderUsage extends Component {
  origins = ORIGINS;
  @tracked path: string[] = ['africa', 'ethiopia', 'guji'];
  @tracked changeOnSelect = false;
  setPath = (v: string[]) => (this.path = v);
  setChangeOnSelect = (v: boolean) => (this.changeOnSelect = v);
  get usage() {
    let bits = ['@options={{this.origins}}', '@value={{this.path}}', '@onChange={{this.setPath}}', "@label='Origin'"];
    if (this.changeOnSelect) bits.push('@changeOnSelect={{true}}');
    return `<Cascader ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Cascader'
      @description='Pick one path through a hierarchy as one value, shown as Africa / Ethiopia / Guji. The popup is a column per level; arrows walk within a column, Right or Enter goes into a branch, Left comes back, Enter on a leaf commits. Tree browses without a value; TreeSelect collects a checked set.'
      @source={{this.usage}}
    >
      <:example>
        <div class='cs-demo'>
          <Cascader @options={{this.origins}} @value={{this.path}} @onChange={{this.setPath}} @changeOnSelect={{this.changeOnSelect}} @label='Origin' @placeholder='Choose an origin' />
          <p class='cs-demo-value'>Value: <code>{{#each this.path as |v|}}{{v}} {{/each}}</code></p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object @name='options' @required={{true}} @description='{ value, label, children?, disabled? }[]' />
        <Args.Object @name='value' @description='The path of values, root first. defaultValue seeds the uncontrolled form.' />
        <Args.Action @name='onChange' @description='The committed path and its labels.' />
        <Args.Bool @name='changeOnSelect' @value={{this.changeOnSelect}} @defaultValue={{false}} @onInput={{this.setChangeOnSelect}} @description='Commit a path that ends on a branch too.' />
        <Args.String @name='label' />
        <Args.String @name='placeholder' />
        <Args.String @name='separator' @defaultValue=' / ' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .cs-demo {
        display: grid;
        gap: var(--space-2, 0.375rem);
        padding-block-end: 16rem;
      }
      .cs-demo-value {
        margin: 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_CASCADER: Record<string, unknown> = {
  Cascader: CascaderUsage,
};
