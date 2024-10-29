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

import cssVar from '../../helpers/css-var.ts';
import { MenuItem } from '../../helpers/menu-item.ts';
import { IconLink } from '../../icons.gts';
import CardContainer from '../card-container/index.gts';
import CardHeader from './index.gts';

export default class CardHeaderUsage extends Component {
  @tracked cardTypeDisplayName = 'My Card Type';
  @tracked cardTypeIcon: ComponentLike<{ Element: Element }> = CaptionsIcon;
  @tracked detail = undefined;
  @tracked size: 'large' | undefined = 'large';
  @tracked hasBackground = true;
  @tracked hasBottomBorder = false;
  @tracked headerColor: string | undefined;
  @tracked isSaving: boolean = false;
  @tracked lastSavedMessage = 'Saved one minute ago';
  @tracked realmInfo = {
    iconURL: 'https://boxel-images.boxel.ai/icons/Letter-j.png',
    name: "John's Workspace",
  };
  @tracked moreOptionsMenuItems: MenuItem[] = [
    new MenuItem('Copy Card URL', 'action', {
      action: () => console.log('Copy Card URL'),
      icon: IconLink,
      disabled: false,
    }),
  ];
  @tracked isEditing = false;
  onEdit = () => {
    this.isEditing = true;
  };
  onFinishEditing = () => {
    this.isEditing = false;
  };

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderTextFont: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderTextTransform: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderCardTypeIconSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderIconContainerMinWidth: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare cardHeaderActionsMinWidth: CSSVariableInfo;

  get sizes() {
    return ['large', '<anyting other than large>'];
  }

  close = () => {
    console.log('close');
  };

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        boxel-card-header-text-font=this.cardHeaderTextFont.value
        boxel-card-header-text-transform=this.cardHeaderTextTransform.value
        boxel-card-header-card-type-icon-size=this.cardHeaderCardTypeIconSize.value
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
            <CardHeader
              @cardTypeDisplayName={{this.cardTypeDisplayName}}
              @cardTypeIcon={{this.cardTypeIcon}}
              @headerColor={{this.headerColor}}
              @isSaving={{this.isSaving}}
              @lastSavedMessage={{this.lastSavedMessage}}
              @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
              @realmInfo={{this.realmInfo}}
              @onEdit={{unless this.isEditing this.onEdit}}
              @onFinishEditing={{if this.isEditing this.onFinishEditing}}
              @onClose={{this.close}}
            />
          </CardContainer>
        </:example>
        <:api as |Args|>
          <Args.String
            @name='cardTypeDisplayName'
            @description='card type display name, shown in the center of the header'
            @value={{this.cardTypeDisplayName}}
            @onInput={{fn (mut this.cardTypeDisplayName)}}
          />
          <Args.Component
            @name='cardTypeIcon'
            @description='The card type icon. Shown next to the card type display name.'
            @value={{this.cardTypeIcon}}
            @options={{array CaptionsIcon LayoutGridIcon}}
            @onChange={{fn (mut this.cardTypeIcon)}}
          />
          <Args.String
            @name='headerColor'
            @description='background color of the header, defaults to boxel-light'
            @value={{this.headerColor}}
            @onInput={{fn (mut this.headerColor)}}
          />
          <Args.Bool
            @name='isSaving'
            @description='whether the card is currently saving'
            @value={{this.isSaving}}
            @onInput={{fn (mut this.isSaving)}}
          />
          <Args.String
            @name='lastSavedMessage'
            @description='message to show when the card was last saved'
            @value={{this.lastSavedMessage}}
            @onInput={{fn (mut this.lastSavedMessage)}}
          />
          <Args.Object
            @name='moreOptionsMenuItems'
            @description='items to show in the more options menu'
            @value={{this.moreOptionsMenuItems}}
          />
          <Args.Object
            @name='realmInfo'
            @description='realm information'
            @value={{this.realmInfo}}
          />
          <Args.Yield
            @name='actions'
            @description='This named block is rendered on the right side of the component.'
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
            @name='boxel-card-header-card-type-icon-size'
            @type='length'
            @description='width and height of the title icon'
            @defaultValue={{this.cardHeaderCardTypeIconSize.defaults}}
            @value={{this.cardHeaderCardTypeIconSize.value}}
            @onInput={{this.cardHeaderCardTypeIconSize.update}}
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