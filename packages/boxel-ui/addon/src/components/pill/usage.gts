/* eslint-disable no-console */
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers.ts';
import { IconPlus } from '../../icons.gts';
import Pill, { type BoxelPillKind } from './index.gts';

export default class PillUsage extends Component {
  pillKinds = ['button', 'default'];
  pillKindDefault: BoxelPillKind = 'default';
  @tracked kind: BoxelPillKind = this.pillKindDefault;
  @tracked pillBackgroundColor = '#ffffff';

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare pillPadding: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare pillGap: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare pillIconSize: CSSVariableInfo;

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        pill-padding=this.pillPadding.value
        pill-gap=this.pillGap.value
        pill-icon-size=this.pillIconSize.value
      }}
    >
      <FreestyleUsage @name='Pill'>
        <:description>
          Pills are used to display information in a compact and visually
          appealing manner. Similar to a tag, badge or label.
        </:description>
        <:example>
          <Pill
            @kind={{this.kind}}
            @pillBackgroundColor={{this.pillBackgroundColor}}
            data-test-pill-freestyle-usage
          >
            <:iconLeft>
              <IconPlus />
            </:iconLeft>
            <:default>
              Happy
            </:default>
          </Pill>
        </:example>
        <:api as |Args|>
          <Args.String
            @name='kind'
            @optional={{true}}
            @description='Controls the kind of the pill'
            @defaultValue={{this.pillKindDefault}}
            @options={{this.pillKinds}}
            @onInput={{fn (mut this.kind)}}
            @value={{this.kind}}
          />
          <Args.String
            @name='pillBackgroundColor'
            @description='3-or-6 digit hex color code for background color'
            @value={{this.pillBackgroundColor}}
            @onInput={{fn (mut this.pillBackgroundColor)}}
            @defaultValue='#ffffff'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='pill-padding'
            @type='dimension'
            @description='Padding of the pill'
            @value={{this.pillPadding.value}}
            @onInput={{this.pillPadding.update}}
          />
          <Css.Basic
            @name='pill-gap'
            @type='dimension'
            @description='Gap between the pill and the icon'
            @value={{this.pillGap.value}}
            @onInput={{this.pillGap.update}}
          />
          <Css.Basic
            @name='pill-icon-size'
            @type='dimension'
            @description='Size of the icon'
            @value={{this.pillIconSize.value}}
            @onInput={{this.pillIconSize.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
