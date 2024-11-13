import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers/css-var.ts';
import Avatar from './index.gts';

export default class AvatarUsage extends Component {
  @tracked userId = 'user123';
  @tracked displayName = 'John Doe';
  @tracked isReady = true;

  @cssVariable({ cssClassName: 'avatar-freestyle-container' })
  declare profileAvatarIconSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'avatar-freestyle-container' })
  declare profileAvatarIconBorder: CSSVariableInfo;
  @cssVariable({ cssClassName: 'avatar-freestyle-container' })
  declare profileAvatarTextColor: CSSVariableInfo;

  <template>
    <div
      class='avatar-freestyle-container'
      style={{cssVar
        profile-avatar-icon-size=this.profileAvatarIconSize.value
        profile-avatar-icon-border=this.profileAvatarIconBorder.value
      }}
    >
      <FreestyleUsage @name='Avatar'>
        <:description>
          An avatar component that displays a user's initials on a colored
          background.
        </:description>
        <:example>
          <Avatar
            @userId={{this.userId}}
            @displayName={{this.displayName}}
            @isReady={{this.isReady}}
          />
        </:example>
        <:api as |Args|>
          <Args.String
            @name='userId'
            @required={{true}}
            @description='Unique identifier for the user'
            @value={{this.userId}}
            @onInput={{fn (mut this.userId)}}
          />
          <Args.String
            @name='displayName'
            @description='User display name'
            @defaultValue='userId'
            @value={{this.displayName}}
            @onInput={{fn (mut this.displayName)}}
          />
          <Args.Bool
            @name='isReady'
            @required={{true}}
            @description='Shows initials on the avatar once this is true'
            @value={{this.isReady}}
            @onInput={{fn (mut this.isReady)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='profile-avatar-icon-size'
            @type='length'
            @description='Size of the avatar (CSS length value).'
            @value={{this.profileAvatarIconSize.value}}
            @onInput={{this.profileAvatarIconSize.update}}
          />
          <Css.Basic
            @name='profile-avatar-icon-border'
            @type='<line-width> || <line-style> || <color>'
            @description='Border of the avatar (CSS border value).'
            @value={{this.profileAvatarIconBorder.value}}
            @onInput={{this.profileAvatarIconBorder.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
