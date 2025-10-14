import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type BoxelButtonKind, buttonKindOptions } from '../button/index.gts';
import {
  type BoxelIconButtonSize,
  boxelIconButtonSizeOptions,
} from '../icon-button/index.gts';
import CopyButton from './index.gts';

export default class CopyButtonUsage extends Component {
  private variants = buttonKindOptions;
  private sizeVariants = boxelIconButtonSizeOptions;
  private defaultSize: BoxelIconButtonSize = 'medium';
  private defaultKind: BoxelButtonKind = 'text-only';
  @tracked private textToCopy: string = 'Text to copy';
  @tracked private size?: BoxelIconButtonSize = this.defaultSize;
  @tracked private kind?: BoxelButtonKind = this.defaultKind;
  @tracked private width?: string;
  @tracked private height?: string;

  <template>
    <FreestyleUsage @name='CopyButton'>
      <:example>
        <CopyButton
          @textToCopy={{this.textToCopy}}
          @kind={{this.kind}}
          @size={{this.size}}
          @width={{this.width}}
          @height={{this.height}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @onInput={{fn (mut this.textToCopy)}}
          @value={{this.textToCopy}}
        />
        <Args.String
          @name='kind'
          @optional={{true}}
          @value={{this.kind}}
          @options={{this.variants}}
          @onInput={{fn (mut this.kind)}}
          @defaultValue={{this.defaultKind}}
        />
        <Args.String
          @name='size'
          @optional={{true}}
          @value={{this.size}}
          @options={{this.sizeVariants}}
          @onInput={{fn (mut this.size)}}
          @defaultValue={{this.defaultSize}}
        />
        <Args.String
          @name='width'
          @optional={{true}}
          @description='icon size'
          @defaultValue='16px'
          @value={{this.width}}
          @onInput={{fn (mut this.width)}}
        />
        <Args.String
          @name='height'
          @description='icon size'
          @defaultValue='16px'
          @value={{this.height}}
          @onInput={{fn (mut this.height)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
