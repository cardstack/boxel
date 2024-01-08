import { fn } from '@ember/helper';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { setCssVar } from '@cardstack/boxel-ui/modifiers';

import { ProfileAvatarIconVisual } from './index';

export default class ProfileAvatarIconVisualUsage extends Component {
  @tracked isReady = true;
  @tracked profileInitials = 'JD';
  @tracked size = '40px';
  @tracked border = '2px solid white';
  @tracked background = 'blue';

  <template>
    <FreestyleUsage @name='ProfileAvatarIconVisual'>
      <:description>
        Displays a profile icon for a user. Note: the component you most likely
        want to consume in the app is
        <code>ProfileAvatarIcon</code>
        and accepts an @userId argument and supports the CSS variables
        <code>--profile-avatar-icon-border</code>
        and
        <code>--profile-avatar-icon-size</code>.
      </:description>
      <:example>
        <div class='example-container'>
          <ProfileAvatarIconVisual
            @isReady={{this.isReady}}
            @profileInitials={{this.profileInitials}}
            class='example-profile-avatar-icon-visual'
            {{setCssVar
              profile-avatar-icon-background=this.background
              profile-avatar-icon-border=this.border
              profile-avatar-icon-size=this.size
            }}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='isReady'
          @description='shows the profileInitials once this is true'
          @onInput={{fn (mut this.isReady)}}
          @value={{this.isReady}}
        />
        <Args.String
          @name='profileInitials'
          @description='The letter or letters to show in the icon.'
          @onInput={{fn (mut this.profileInitials)}}
          @value={{this.profileInitials}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='profile-avatar-icon-background'
          @type='color'
          @description='Background color of profile avatar icon'
          @value={{this.background}}
          @onInput={{fn (mut this.background)}}
        />
        <Css.Basic
          @name='profile-avatar-icon-size'
          @type='length'
          @description='Size of the profile avatar icon'
          @defaultValue='40px'
          @value={{this.size}}
          @onInput={{fn (mut this.size)}}
        />
        <Css.Basic
          @name='profile-avatar-icon-border'
          @type='<line-width> || <line-style> || <color>'
          @description='Border of profile avatar icon'
          @defaultValue='2px solid white'
          @value={{this.border}}
          @onInput={{fn (mut this.border)}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style>
      .example-container {
        background: var(--boxel-400);
        display: flex;
        justify-content: center;
        padding: 20px;
      }
    </style>
  </template>
}
