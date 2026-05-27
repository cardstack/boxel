import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import {
  type FittedFormatId,
  fittedFormatById,
  fittedFormatIds,
} from '../../helpers.ts';
import CardContainer from '../card-container/index.gts';
import BoxelGridContainer from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class GridContainerUsage extends Component<Signature> {
  fittedFormats = fittedFormatIds;
  usageFormatOptions = [undefined, ...this.fittedFormats];
  sampleItems = ['Item A', 'Item B', 'Item C', 'Item D', 'Item E', 'Item F'];

  @tracked size: FittedFormatId | undefined = 'regular-tile';
  @tracked viewFormat: 'grid' | 'list' = 'grid';
  @tracked fullWidthItem = false;

  formatTitle(size: FittedFormatId) {
    return fittedFormatById.get(size)?.title ?? size;
  }

  formatDimensions(size: FittedFormatId) {
    let spec = fittedFormatById.get(size);
    return spec ? `${spec.width}px × ${spec.height}px` : '';
  }

  <template>
    <FreestyleUsage @name='GridContainer'>
      <:description>
        A CSS grid container for laying out fitted cards. Supports both a simple
        default slot and an item-based API that yields a
        <code>GridItemContainer</code>
        per item. Pass a
        <code>@size</code>
        to constrain card dimensions using fitted format specs, and use
        <code>@viewFormat</code>
        to switch between grid and list layouts.
      </:description>
      <:example>
        <BoxelGridContainer
          @items={{this.sampleItems}}
          @size={{this.size}}
          @viewFormat={{this.viewFormat}}
          @fullWidthItem={{this.fullWidthItem}}
          as |item GridItemContainer|
        >
          <GridItemContainer>
            <CardContainer @displayBoundaries={{true}}>
              <h3>{{item}}</h3>
              {{#if this.size}}
                <p>{{this.formatDimensions this.size}}</p>
              {{/if}}
            </CardContainer>
          </GridItemContainer>
        </BoxelGridContainer>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='Array of items to iterate over. Each item and a GridItemContainer component are yielded to the block. When omitted, an empty block is yielded for custom content.'
          @value={{this.sampleItems}}
        />
        <Args.String
          @name='size'
          @description='Fitted format size id. Controls grid column width and row height. Must be a valid FittedFormatId.'
          @options={{this.usageFormatOptions}}
          @value={{this.size}}
          @onInput={{fn (mut this.size)}}
        />
        <Args.String
          @name='viewFormat'
          @description='"grid" uses auto-fill columns sized to the format width. "list" stacks items in a single column.'
          @options={{array 'grid' 'list'}}
          @value={{this.viewFormat}}
          @onInput={{fn (mut this.viewFormat)}}
          @defaultValue='grid'
        />
        <Args.Bool
          @name='fullWidthItem'
          @description='When true, each GridItemContainer stretches to full width. Height is still constrained by @size.'
          @value={{this.fullWidthItem}}
          @onInput={{fn (mut this.fullWidthItem)}}
          @defaultValue={{false}}
        />
        <Args.String
          @name='tag'
          @description='HTML element tag used to render the container element.'
          @defaultValue='div'
        />
        <Args.Yield
          @description='When @items is provided, yields (item, GridItemContainer) per entry. When @items is omitted, yields an empty block for custom content.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
