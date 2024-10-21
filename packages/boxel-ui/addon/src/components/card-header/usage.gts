import CaptionsIcon from '@cardstack/boxel-icons/captions';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers.ts';
import BoxelButton from '../button/index.gts';
import CardContainer from '../card-container/index.gts';
import CardHeader from './index.gts';

export default class HeaderUsage extends Component {
  @tracked title = 'Title';
  @tracked titleIcon: ComponentLike<{ Element: Element }> = CaptionsIcon;
  @tracked detail = undefined;
  @tracked size: 'large' | undefined = 'large';
  @tracked hasBackground = true;
  @tracked hasBottomBorder = false;

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderTextFont: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderTextTransform: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderTitleIconSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderIconContainerMinWidth: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderActionsMinWidth: CSSVariableInfo;

  get sizes() {
    return ['large', '<anyting other than large>'];
  }

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        boxel-card-header-text-font=this.cardHeaderTextFont.value
        boxel-card-header-text-transform=this.cardHeaderTextTransform.value
        boxel-card-header-title-icon-size=this.cardHeaderTitleIconSize.value
        boxel-card-header-icon-container-min-width=this.cardHeaderIconContainerMinWidth.value
        boxel-card-header-actions-min-width=this.cardHeaderActionsMinWidth.value
      }}
    >
      <FreestyleUsage @name='CardHeader'>
        <:description>
          Usually shown at the top of card containers
        </:description>
        <:example>
          <CardContainer>
            <CardHeader @title={{this.title}} @titleIcon={{this.titleIcon}}>
              <:realmIcon>
                🌏
              </:realmIcon>
              <:actions>
                <BoxelButton>Edit</BoxelButton>
              </:actions>
            </CardHeader>
          </CardContainer>
        </:example>
        <:api as |Args|>
          <Args.String
            @name='title'
            @description='Title'
            @value={{this.title}}
            @onInput={{fn (mut this.title)}}
          />
          <Args.Component
            @name='titleIcon'
            @description='Title icon (often the card type icon)'
            @value={{this.titleIcon}}
            @options={{array CaptionsIcon LayoutGridIcon}}
            @onChange={{fn (mut this.titleIcon)}}
          />
          <Args.Yield
            @name='realmIcon'
            @description='This named block is rendered on the left side of the component.'
          />
          <Args.Yield
            @name='actions'
            @description='This named block is rendered on the right side of the component.'
          />
          <Args.Yield
            @name='detail'
            @description='This named block is rendered underneat the title in the center.'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-card-header-text-font'
            @type='font'
            @description='some font'
            @defaultValue={{this.cardHeaderTextFont.defaults}}
            @value={{this.cardHeaderTextFont.value}}
            @onInput={{this.cardHeaderTextFont.update}}
          />
          <Css.Basic
            @name='boxel-card-header-text-transform'
            @type='text-transform'
            @description='e.g. uppercase, lowercase'
            @defaultValue={{this.cardHeaderTextTransform.defaults}}
            @value={{this.cardHeaderTextTransform.value}}
            @onInput={{this.cardHeaderTextTransform.update}}
          />
          <Css.Basic
            @name='boxel-card-header-title-icon-size'
            @type='length'
            @description='width and height of the title icon'
            @defaultValue={{this.cardHeaderTitleIconSize.defaults}}
            @value={{this.cardHeaderTitleIconSize.value}}
            @onInput={{this.cardHeaderTitleIconSize.update}}
          />
          <Css.Basic
            @name='boxel-card-header-icon-container-min-width'
            @type='length'
            @description='minimum width of the icon container; useful to set matching boxel-card-header-actions-min-width to keep the title centered opverall'
            @defaultValue={{this.cardHeaderIconContainerMinWidth.defaults}}
            @value={{this.cardHeaderIconContainerMinWidth.value}}
            @onInput={{this.cardHeaderIconContainerMinWidth.update}}
          />
          <Css.Basic
            @name='boxel-card-header-actions-min-width'
            @type='length'
            @description='minimum width of the actions container; useful to set matching boxel-card-header-icon-container-min-width to keep the title centered opverall'
            @defaultValue={{this.cardHeaderActionsMinWidth.defaults}}
            @value={{this.cardHeaderActionsMinWidth.value}}
            @onInput={{this.cardHeaderActionsMinWidth.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
    <style scoped>
      :global(.header-freestyle-container) {
        --boxel-card-header-text-transform: none;
      }
    </style>
  </template>
}
