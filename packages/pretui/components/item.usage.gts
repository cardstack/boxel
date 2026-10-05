// Pretui — Item usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Chip } from './chip';
import { Item } from './item';
import type { ListingSizeArg } from '../internal/reading-listing';
import { LOTS, SIZES } from '../examples-listing';
import type { Lot } from '../examples-listing';

class ItemUsage extends Component {
  sizes = SIZES;
  lot = LOTS[0] as Lot;

  @tracked size: ListingSizeArg = 'm';
  @tracked alignStart = false;
  @tracked showActions = true;

  setSize = (v: string) => (this.size = v as ListingSizeArg);
  setAlignStart = (v: boolean) => (this.alignStart = v);
  setShowActions = (v: boolean) => (this.showActions = v);

  <template>
    <FreestyleUsage
      @name='Item'
      @slug='item'
      @description='One row of a listing: leading slot, title, description, a trailing meta column and an actions column. It renders a div, never an li, so List owns the li and Item can also stand alone in a card or inside a DataTable detail row.'
    >
      <:example>
        <div class='it-demo'>
          {{#if this.showActions}}
            <Item
              @title={{this.lot.tea}}
              @description={{this.lot.supplier}}
              @size={{this.size}}
              @alignStart={{this.alignStart}}
            >
              <:leading><Chip @label={{this.lot.id}} /></:leading>
              <:trailing>{{this.lot.price}}</:trailing>
              <:actions>
                <Button @appearance='outlined' @size='s'>Open</Button>
              </:actions>
            </Item>
          {{else}}
            <Item
              @title={{this.lot.tea}}
              @description={{this.lot.note}}
              @size={{this.size}}
              @alignStart={{this.alignStart}}
            >
              <:leading><Chip @label={{this.lot.id}} /></:leading>
              <:trailing>{{this.lot.price}}</:trailing>
            </Item>
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @value={{this.lot.tea}}
          @description='The row’s name. Rendered as a span, never a heading: Ant’s List.Item.Meta hard-codes an h4 and drops it into whatever outline the list lands in. If this row IS a heading in your document, put a real one in the title block.'
          @hideControls={{true}}
        />
        <Args.String
          @name='description'
          @value={{this.lot.supplier}}
          @description='The supporting line. Both title and description truncate with all four declarations — min-width 0 plus overflow, text-overflow and white-space — because min-width 0 on its own hard-clips instead of ellipsising and looks fixed.'
          @hideControls={{true}}
        />
        <Args.String
          @name='href'
          @description='Makes the title a real anchor. A row with one obvious destination should have a link, not a click handler.'
          @hideControls={{true}}
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
          @name='alignStart'
          @value={{this.alignStart}}
          @defaultValue={{false}}
          @description='Align the leading slot to the first line instead of the block centre — right for a multi-line row, wrong for a single-line one.'
          @onInput={{this.setAlignStart}}
        />
        <Args.Bool
          @name='actions block (demo knob)'
          @value={{this.showActions}}
          @defaultValue={{true}}
          @description='Toggles the actions slot and swaps the description for a long one, so you can watch the truncation and the container-query wrap.'
          @onInput={{this.setShowActions}}
        />
        <Args.Yield
          @description='Named blocks: leading, title, description, trailing, actions, and a default block for free body content under the title.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .it-demo {
        container-type: inline-size;
        padding: var(--space-4, 11px) var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
    </style>
  </template>
}

export const DEMOS_ITEM: Record<string, unknown> = {
  Item: ItemUsage,
};
