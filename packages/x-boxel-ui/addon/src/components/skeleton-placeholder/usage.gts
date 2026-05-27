import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers/css-var.ts';
import SkeletonPlaceholder from './index.gts';

export default class SkeletonPlaceholderUsage extends Component {
  @tracked width = '200px';
  @tracked height = '20px';
  @tracked borderRadius = '4px';
  @tracked animation: 'wave' | 'pulse' | 'none' = 'wave';

  @cssVariable({ cssClassName: 'skeleton-freestyle-container' })
  declare boxelSkeletonBackground: CSSVariableInfo;
  @cssVariable({ cssClassName: 'skeleton-freestyle-container' })
  declare boxelSkeletonHighlight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'skeleton-freestyle-container' })
  declare boxelSkeletonWidth: CSSVariableInfo;
  @cssVariable({ cssClassName: 'skeleton-freestyle-container' })
  declare boxelSkeletonHeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'skeleton-freestyle-container' })
  declare boxelSkeletonBorderRadius: CSSVariableInfo;

  <template>
    <div
      class='skeleton-freestyle-container'
      style={{cssVar
        boxel-skeleton-background=this.boxelSkeletonBackground.value
        boxel-skeleton-highlight=this.boxelSkeletonHighlight.value
        boxel-skeleton-width=this.boxelSkeletonWidth.value
        boxel-skeleton-height=this.boxelSkeletonHeight.value
        boxel-skeleton-border-radius=this.boxelSkeletonBorderRadius.value
      }}
    >
      <FreestyleUsage @name='Skeleton Placeholder'>
        <:description>
          A skeleton placeholder component to show loading states
        </:description>
        <:example>
          <SkeletonPlaceholder @animation={{this.animation}} />
        </:example>
        <:api as |Args|>
          <Args.String
            @name='animation'
            @value={{this.animation}}
            @options={{array 'wave' 'pulse' 'none'}}
            @description='Animation type for the skeleton'
            @onInput={{fn (mut this.animation)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-skeleton-width'
            @type='string'
            @description='Width of the skeleton (px or %)'
            @defaultValue={{this.boxelSkeletonWidth.defaults}}
            @value={{this.boxelSkeletonWidth.value}}
            @onInput={{this.boxelSkeletonWidth.update}}
          />
          <Css.Basic
            @name='boxel-skeleton-height'
            @type='string'
            @description='Height of the skeleton (px or %)'
            @defaultValue={{this.boxelSkeletonHeight.defaults}}
            @value={{this.boxelSkeletonHeight.value}}
            @onInput={{this.boxelSkeletonHeight.update}}
          />
          <Css.Basic
            @name='boxel-skeleton-border-radius'
            @type='string'
            @description='Border radius of the skeleton'
            @defaultValue={{this.boxelSkeletonBorderRadius.defaults}}
            @value={{this.boxelSkeletonBorderRadius.value}}
            @onInput={{this.boxelSkeletonBorderRadius.update}}
          />
          <Css.Basic
            @name='boxel-skeleton-background'
            @type='color'
            @description='Background color of the skeleton'
            @defaultValue={{this.boxelSkeletonBackground.defaults}}
            @value={{this.boxelSkeletonBackground.value}}
            @onInput={{this.boxelSkeletonBackground.update}}
          />
          <Css.Basic
            @name='boxel-skeleton-highlight'
            @type='color'
            @description='Highlight color for the wave animation (only applies when animation=wave)'
            @defaultValue={{this.boxelSkeletonHighlight.defaults}}
            @value={{this.boxelSkeletonHighlight.value}}
            @onInput={{this.boxelSkeletonHighlight.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
