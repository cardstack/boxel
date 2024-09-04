import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import { ALL_ICON_COMPONENTS } from '../../icons.gts';
import IconPlusCircle from '../../icons/icon-plus-circle.gts';
import type { Icon } from '../../icons/types.ts';
import BoxelIconButton from './index.gts';

export default class IconButtonUsage extends Component {
  @tracked icon: Icon = IconPlusCircle;
  @tracked variant?: string;
  @tracked width = '40px';
  @tracked height = '40px';

  cssClassName = 'boxel-icon-button';
  @cssVariable declare boxelIconButtonWidth: CSSVariableInfo;
  @cssVariable declare boxelIconButtonHeight: CSSVariableInfo;

  @action log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  }

  <template>
    <FreestyleUsage @name='IconButton'>
      <:example>
        <BoxelIconButton
          @icon={{this.icon}}
          @variant={{this.variant}}
          @width={{this.width}}
          @height={{this.height}}
          aria-label='Special Button'
          {{on 'click' (fn this.log 'Button clicked')}}
          style={{cssVar
            boxel-icon-button-width=this.boxelIconButtonWidth.value
            boxel-icon-button-height=this.boxelIconButtonHeight.value
          }}
        />
      </:example>

      <:api as |Args|>
        <Args.Component
          @name='icon'
          @description='Icon component reference'
          @value={{this.icon}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon)}}
        />
        <Args.String
          @name='variant'
          @optional={{true}}
          @description="the variant to render as (applies CSS class) - 'null' or 'primary' or 'secondary'"
          @value={{this.variant}}
          @options={{array 'primary' 'secondary' '<undefined>'}}
          @onInput={{fn (mut this.variant)}}
          @defaultValue='<undefined>'
        />
        <Args.Number
          @name='width'
          @description='used to size the SVG rendering'
          @defaultValue={{'16px'}}
          @value={{this.width}}
          @onInput={{fn (mut this.width)}}
        />
        <Args.Number
          @name='height'
          @description='used to size the SVG rendering'
          @defaultValue={{'16px'}}
          @value={{this.height}}
          @onInput={{fn (mut this.height)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-icon-button-width'
          @type='dimension'
          @description='Used to size the boundaries of the button'
          @defaultValue={{this.boxelIconButtonWidth.defaults}}
          @value={{this.boxelIconButtonWidth.value}}
          @onInput={{this.boxelIconButtonWidth.update}}
        />
        <Css.Basic
          @name='boxel-icon-button-height'
          @type='dimension'
          @description='Used to size the boundaries of the button'
          @defaultValue={{this.boxelIconButtonHeight.defaults}}
          @value={{this.boxelIconButtonHeight.value}}
          @onInput={{this.boxelIconButtonHeight.update}}
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}
