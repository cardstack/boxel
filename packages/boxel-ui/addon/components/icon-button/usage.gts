import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import BoxelIconButton from './index';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { array, fn } from '@ember/helper';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import {
  cssVariable,
  CSSVariableInfo,
} from 'ember-freestyle/decorators/css-variable';

export default class IconButtonUsage extends Component {
  @tracked icon = 'icon-plus-circle';
  @tracked variant?: string;
  @tracked width = '40px';
  @tracked height = '40px';
  @tracked tooltip = 'Add a card to this collection';

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
          @tooltip={{this.tooltip}}
          aria-label='Special Button'
          {{on 'click' (fn this.log 'Button clicked')}}
          style={{cssVar
            boxel-icon-button-width=this.boxelIconButtonWidth.value
            boxel-icon-button-height=this.boxelIconButtonHeight.value
          }}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='icon'
          @description='the name of the svg to show'
          @value={{this.icon}}
          @onInput={{fn (mut this.icon)}}
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
        <Args.String
          @name='tooltip'
          @description='tooltip text on hover'
          @value={{this.tooltip}}
          @onInput={{fn (mut this.tooltip)}}
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
