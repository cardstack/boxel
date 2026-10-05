// Pretui — Descriptions usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Descriptions } from './descriptions';
import type { DescriptionsItem } from './descriptions';
import type { ListingSizeArg } from '../internal/reading-listing';
import { LOTS, SIZES } from '../examples-listing';
import type { Lot } from '../examples-listing';

class DescriptionsUsage extends Component {
  sizes = SIZES;
  layouts = ['horizontal', 'vertical'];

  @tracked columns = 3;
  @tracked bordered = true;
  @tracked layout: 'horizontal' | 'vertical' = 'horizontal';
  @tracked size: ListingSizeArg = 'm';
  @tracked colon = false;

  setColumns = (v: number) => (this.columns = v);
  setBordered = (v: boolean) => (this.bordered = v);
  setLayout = (v: string) => (this.layout = v as 'horizontal' | 'vertical');
  setSize = (v: string) => (this.size = v as ListingSizeArg);
  setColon = (v: boolean) => (this.colon = v);

  items: DescriptionsItem[] = [
    { label: 'Lot', value: (LOTS[0] as Lot).id, mono: true },
    { label: 'Tea', value: (LOTS[0] as Lot).tea },
    { label: 'Supplier', value: (LOTS[0] as Lot).supplier },
    { label: 'Origin', value: (LOTS[0] as Lot).place },
    { label: 'Grade', value: (LOTS[0] as Lot).grade },
    { label: 'Weight', value: String((LOTS[0] as Lot).kg) + ' kg', mono: true },
    { label: 'Price', value: (LOTS[0] as Lot).price, mono: true },
    { label: 'Chests', value: '2', mono: true },
    { label: 'Cupping note', value: (LOTS[0] as Lot).note, span: 'fill' },
  ];

  <template>
    <FreestyleUsage
      @name='Descriptions'
      @slug='descriptions'
      @description='The read-only record display: label/value pairs in an N-column grid that folds to stacked. It is not RecordDetail (that is the editing machine) and not KeyValue (that is the plain two-column dl, which stays exactly what it is).'
    >
      <:example>
        <Descriptions
          @items={{this.items}}
          @columns={{this.columns}}
          @bordered={{this.bordered}}
          @layout={{this.layout}}
          @size={{this.size}}
          @colon={{this.colon}}
          @title='Lot record'
        >
          <:extra>
            <Button @appearance='outlined' @size='s'>Edit</Button>
          </:extra>
        </Descriptions>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @value={{this.items}}
          @description='The pairs, in reading order. Each carries label, an optional value string, an optional span (a number, or "fill" to take the rest of the row), an optional key, and mono for machine values.'
        />
        <Args.Number
          @name='columns'
          @value={{this.columns}}
          @min={{1}}
          @max={{4}}
          @step={{1}}
          @defaultValue={{3}}
          @description='Pairs per row at full width, 1–4. column is accepted as Ant’s spelling. The container query only ever REDUCES this — narrow the artboard and watch it go 3 → 2 → 1 and then fold the label above the value. Ant resolves the same thing through matchMedia on the window, which is the wrong box inside a card.'
          @onInput={{this.setColumns}}
        />
        <Args.Bool
          @name='bordered'
          @value={{this.bordered}}
          @defaultValue={{false}}
          @description='Rule the grid and tint the label cells. Unlike Ant, the semantics do not change with the flag: dt is the term and dd the description in both modes, because this is a dl and not a table dressed as one.'
          @onInput={{this.setBordered}}
        />
        <Args.String
          @name='layout'
          @value={{this.layout}}
          @options={{this.layouts}}
          @defaultValue='horizontal'
          @description="'horizontal' puts the label beside its value, 'vertical' above it. At the narrowest container width horizontal folds to vertical anyway — two columns of text in a 26rem pane is not a record, it is a wrap."
          @onInput={{this.setLayout}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{this.sizes}}
          @defaultValue='m'
          @description='Density on the house scale.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='colon'
          @value={{this.colon}}
          @defaultValue={{false}}
          @description='Trailing colon after every label. Ant defaults this to true, which puts a colon on labels that already sit in their own tinted cell; here it is opt-in and the glyph is aria-hidden so it is never read aloud.'
          @onInput={{this.setColon}}
        />
        <Args.String
          @name='labelWidth'
          @description='Width of the label column in horizontal layout (any CSS length; default max-content). It goes through the kit’s cssValue guard, so a caller string can never inject a second declaration.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Named blocks: value (item, index) for markup in a description; title and extra for the header.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DESCRIPTIONS: Record<string, unknown> = {
  Descriptions: DescriptionsUsage,
};
