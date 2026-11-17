// Pretui — EmptyState usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { ButtonGroup } from './button-group';
import { Token } from './token';
import { EmptyState, type EmptyStateSize } from './empty-state';

const SIZES: EmptyStateSize[] = ['m', 's'];

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
    return `<EmptyState ${bits.join(' ')}>${message}<:action>…</:action></EmptyState>`;
  }
  <template>
    <FreestyleUsage
      @name='EmptyState'
      @description='A named absence with optional action. Texture is confined to this low-information surface and never competes with data.'
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
            <:action><Button @tone='neutral' @appearance='outlined'>Clear filters</Button></:action>
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
            <:action><Button @tone='neutral' @appearance='outlined'>Clear filters</Button></:action>
          </EmptyState>
        {{/if}}
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
          @name='action'
          @description="Any content, placed under the message as given: one Button, or several in the caller's own layout."
        />
      </:api>
    </FreestyleUsage>
    <FreestyleUsage
      @name='EmptyState with several actions'
      @description='The action block places what it is given and does not lay it out. For several actions, bring a layout such as a ButtonGroup.'
      @source={{SEVERAL_ACTIONS_SOURCE}}
    >
      <:example>
        <EmptyState @title='No batches yet' @message='Start one from scratch, or bring your records in.'>
          <:action>
            <ButtonGroup>
              <Button @tone='neutral' @appearance='outlined'>Start blank</Button>
              <Button @tone='neutral' @appearance='outlined'>Import CSV</Button>
            </ButtonGroup>
          </:action>
        </EmptyState>
      </:example>
    </FreestyleUsage>
  </template>
}

const SEVERAL_ACTIONS_SOURCE = `<EmptyState @title='No batches yet' @message='…'>
  <:action>
    <ButtonGroup>
      <Button>Start blank</Button>
      <Button>Import CSV</Button>
    </ButtonGroup>
  </:action>
</EmptyState>`;

export const DEMOS_EMPTY_STATE: Record<string, unknown> = {
  EmptyState: EmptyStateUsage,
};
