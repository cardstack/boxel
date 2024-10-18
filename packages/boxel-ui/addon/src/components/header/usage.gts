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
import { ThreeDotsHorizontal } from '../../icons.gts';
import BoxelButton from '../button/index.gts';
import CardContainer from '../card-container/index.gts';
import BoxelDropdown from '../dropdown/index.gts';
import IconButton from '../icon-button/index.gts';
import BoxelHeader from './index.gts';

export default class HeaderUsage extends Component {
  @tracked title = 'Title';
  @tracked titleIcon: ComponentLike<{ Element: Element }> = CaptionsIcon;
  @tracked detail = undefined;
  @tracked size: 'large' | undefined = 'large';
  @tracked hasBackground = true;
  @tracked isHighlighted = false;
  @tracked hasBottomBorder = false;

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelHeaderTextFont: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelHeaderTextTransform: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelHeaderTitleIconSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelHeaderIconContainerMinWidth: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelHeaderActionsMinWidth: CSSVariableInfo;

  get sizes() {
    return ['large', '<anyting other than large>'];
  }

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        boxel-header-text-font=this.boxelHeaderTextFont.value
        boxel-header-text-transform=this.boxelHeaderTextTransform.value
        boxel-header-title-icon-size=this.boxelHeaderTitleIconSize.value
        boxel-header-icon-container-min-width=this.boxelHeaderIconContainerMinWidth.value
        boxel-header-actions-min-width=this.boxelHeaderActionsMinWidth.value
      }}
    >
      <FreestyleUsage @name='Header'>
        <:description>
          Usually shown at the top of card containers
        </:description>
        <:example>
          <BoxelHeader
            @title={{this.title}}
            @titleIcon={{this.titleIcon}}
            @detail={{this.detail}}
            @size={{this.size}}
            @hasBackground={{this.hasBackground}}
            @isHighlighted={{this.isHighlighted}}
            @hasBottomBorder={{this.hasBottomBorder}}
          >
            <:icon>
              🌏
            </:icon>
            <:actions>
              <BoxelButton>Edit</BoxelButton>
            </:actions>
          </BoxelHeader>
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
          <Args.String
            @name='detail'
            @description='detail'
            @value={{this.detail}}
            @onInput={{fn (mut this.detail)}}
          />
          <Args.String
            @name='size'
            @description='large | <anyting other than large>'
            @options={{this.sizes}}
            @value={{this.size}}
            @onInput={{fn (mut this.size)}}
          />
          <Args.Bool
            @name='hasBackground'
            @description='(styling) Adds background color'
            @defaultValue={{false}}
            @value={{this.hasBackground}}
            @onInput={{fn (mut this.hasBackground)}}
          />
          <Args.Bool
            @name='isHighlighted'
            @description='(styling) Highlights header'
            @defaultValue={{false}}
            @value={{this.isHighlighted}}
            @onInput={{fn (mut this.isHighlighted)}}
          />
          <Args.Bool
            @name='hasBottomBorder'
            @description='bottom border'
            @defaultValue={{false}}
            @value={{this.hasBottomBorder}}
            @onInput={{fn (mut this.hasBottomBorder)}}
          />
          <Args.Yield
            @name='icon'
            @description='Content for the icon of the header'
          />
          <Args.Yield @description='Content' />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-header-text-font'
            @type='font'
            @description='some font'
            @defaultValue={{this.boxelHeaderTextFont.defaults}}
            @value={{this.boxelHeaderTextFont.value}}
            @onInput={{this.boxelHeaderTextFont.update}}
          />
          <Css.Basic
            @name='boxel-header-text-transform'
            @type='text-transform'
            @description='e.g. uppercase, lowercase'
            @defaultValue={{this.boxelHeaderTextTransform.defaults}}
            @value={{this.boxelHeaderTextTransform.value}}
            @onInput={{this.boxelHeaderTextTransform.update}}
          />
          <Css.Basic
            @name='boxel-header-title-icon-size'
            @type='length'
            @description='width and height of the title icon'
            @defaultValue={{this.boxelHeaderTitleIconSize.defaults}}
            @value={{this.boxelHeaderTitleIconSize.value}}
            @onInput={{this.boxelHeaderTitleIconSize.update}}
          />
          <Css.Basic
            @name='boxel-header-icon-container-min-width'
            @type='length'
            @description='minimum width of the icon container; useful to set matching boxel-header-actions-min-width to keep the title centered opverall'
            @defaultValue={{this.boxelHeaderIconContainerMinWidth.defaults}}
            @value={{this.boxelHeaderIconContainerMinWidth.value}}
            @onInput={{this.boxelHeaderIconContainerMinWidth.update}}
          />
          <Css.Basic
            @name='boxel-header-actions-min-width'
            @type='length'
            @description='minimum width of the actions container; useful to set matching boxel-header-icon-container-min-width to keep the title centered opverall'
            @defaultValue={{this.boxelHeaderActionsMinWidth.defaults}}
            @value={{this.boxelHeaderActionsMinWidth.value}}
            @onInput={{this.boxelHeaderActionsMinWidth.update}}
          />
        </:cssVars>
      </FreestyleUsage>

      <FreestyleUsage @name='Card Container Usage'>
        <:example>
          <CardContainer>
            <BoxelHeader
              @size='large'
              @title='Card'
              @isHighlighted={{this.isHighlighted}}
            />
            <div>Card Here</div>
          </CardContainer>
        </:example>
      </FreestyleUsage>
      <FreestyleUsage @name='Definition Usage'>
        <:example>
          <BoxelHeader
            @title='Definition'
            @hasBackground={{true}}
            class='definition-container'
          >
            <:actions>
              <div>
                .gts
              </div>
            </:actions>
          </BoxelHeader>
        </:example>
      </FreestyleUsage>
      <FreestyleUsage @name='AI Command Results'>
        <:example>
          <BoxelHeader
            @title=' Results'
            @detail='25 results'
            @hasBackground={{this.hasBackground}}
            @isHighlighted={{this.isHighlighted}}
            class='command-results'
          >
            <:icon>
              🌏
            </:icon>
            <:actions>
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <IconButton
                    @icon={{ThreeDotsHorizontal}}
                    @width='20px'
                    @height='20px'
                    class='icon-button'
                    aria-label='Options'
                    data-test-more-options-button
                    {{bindings}}
                  />
                </:trigger>
              </BoxelDropdown>
            </:actions>
          </BoxelHeader>
        </:example>
      </FreestyleUsage>
    </div>
    <style scoped>
      .definition-container {
        --boxel-header-text-transform: uppercase;
        --boxel-header-text-color: var(--boxel-450);
      }
      .command-results {
        --boxel-label-color: var(--boxel-400);
        --boxel-label-font-weight: 500;
        --boxel-label-font: 500 var(--boxel-font-xs);
      }
    </style>
    <style scoped>
      :global(.header-freestyle-container) {
        --boxel-header-text-transform: none;
      }
    </style>
  </template>
}
