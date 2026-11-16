// Pretui — EmptyState usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { ButtonGroup } from './button-group';
import { Token } from './token';
import { EmptyState, type EmptyStateSize } from './empty-state';

const SIZES: EmptyStateSize[] = ['m', 's'];
// Two equal paths in a ButtonGroup, at a width that holds the row and one that doesn't.
const PATH_FRAMES = ['wide', 'narrow'];

class EmptyStateUsage extends Component {
  @tracked title = 'No lots match';
  @tracked message = '';
  @tracked texture = true;
  @tracked size: EmptyStateSize = 'm';
  setTitle = (v: string) => (this.title = v);
  setMessage = (v: string) => (this.message = v);
  toggleTexture = (v: boolean) => (this.texture = v);
  setSize = (v: string) => (this.size = v as EmptyStateSize);
  get messageVal() {
    return this.message || undefined;
  }
  get usage() {
    let bits = [`@title='${this.title}'`];
    if (this.messageVal) {
      bits.push(`@message='${this.messageVal}'`);
    }
    if (this.size !== 'm') {
      bits.push(`@size='${this.size}'`);
    }
    if (!this.texture) {
      bits.push('@texture={{false}}');
    }
    let message = this.messageVal
      ? ''
      : '<:default>Try clearing the <Token …/> filters.</:default>';
    return `<EmptyState ${bits.join(' ')}>${message}<:actions>…</:actions></EmptyState>`;
  }
  <template>
    <FreestyleUsage
      @name='EmptyState'
      @description='A named absence with optional actions. Texture is confined to this low-information surface and never competes with data.'
      @source={{this.usage}}
    >
      <:example>
        {{! A block wins over @message, so the block is passed only while the message knob is empty. }}
        {{#if this.messageVal}}
          <EmptyState
            @title={{this.title}}
            @message={{this.messageVal}}
            @texture={{this.texture}}
            @size={{this.size}}
          >
            <:actions><Button @tone='neutral' @appearance='outlined'>Clear filters</Button></:actions>
          </EmptyState>
        {{else}}
          <EmptyState
            @title={{this.title}}
            @texture={{this.texture}}
            @size={{this.size}}
          >
            <:default>Try clearing the
              <Token @value='origin' />
              and
              <Token @value='harvest' />
              filters.</:default>
            <:actions><Button @tone='neutral' @appearance='outlined'>Clear filters</Button></:actions>
          </EmptyState>
        {{/if}}
        <div class='empty-state-usage-paths'>
          {{#each PATH_FRAMES as |width|}}
            <div class='empty-state-usage-frame' data-width={{width}}>
              <EmptyState @title='No proofs yet' @size={{this.size}} @texture={{this.texture}}>
                <:actions>
                  <ButtonGroup @label='Ways forward' @separator='or' @size={{this.size}}>
                    <Button @appearance='accent'>Go to checkout</Button>
                    <Button @tone='neutral' @appearance='outlined'>Back to the shop</Button>
                  </ButtonGroup>
                </:actions>
              </EmptyState>
            </div>
          {{/each}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @value={{this.title}}
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='message'
          @value={{this.message}}
          @description='Plain-text message. The default block wins over it when both are given; this page passes the block only while the knob is empty.'
          @onInput={{this.setMessage}}
        />
        <Args.Bool
          @name='texture'
          @value={{this.texture}}
          @defaultValue={{true}}
          @onInput={{this.toggleTexture}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{SIZES}}
          @defaultValue='m'
          @description="House scale. 's' is the compact well for an empty note inside a card section (--boxel-sp padding, the title at --boxel-font-size); 'm' sizes for a page section. xs lands on s, l and xl on m (Pretui addition)."
          @onInput={{this.setSize}}
        />
        <Args.Yield
          @name='default'
          @description='The message with markup in it (a Token, a link, emphasis), in the same place and type as @message. Wins over @message when both are given.'
        />
        <Args.Yield
          @name='actions'
          @description="The ways forward, placed under the message as given: one Button, or several in a ButtonGroup, which lays them out. Two equal paths take the group's @separator='or'."
        />
        <Args.Yield @name='action' @description='Deprecated alias of actions.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .empty-state-usage-paths {
        display: grid;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp);
      }
      .empty-state-usage-frame[data-width='wide'] {
        max-inline-size: 36rem;
      }
      .empty-state-usage-frame[data-width='narrow'] {
        max-inline-size: 18rem;
      }
    </style>
  </template>
}

export const DEMOS_EMPTY_STATE: Record<string, unknown> = {
  EmptyState: EmptyStateUsage,
};
