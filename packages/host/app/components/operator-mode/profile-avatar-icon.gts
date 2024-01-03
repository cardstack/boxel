import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { bool } from '@cardstack/boxel-ui/helpers';

import { stringToColor } from '@cardstack/host/lib/utils';
import MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    userId: string | null;
    cssVariables?: Record<string, string>;
  };
  Element: HTMLDivElement;
}

export default class ProfileAvatarIcon extends Component<Signature> {
  @service declare matrixService: MatrixService;

  get profileInitials() {
    let displayName = this.matrixService.profile?.displayName;

    if (displayName) {
      return displayName.slice(0, 1).toUpperCase();
    } else {
      return this.args.userId?.split(':')[0].slice(1, 2).toUpperCase(); // Transform @user:localhost into U, for example
    }
  }

  get style() {
    let cssVariables = this.args.cssVariables || {};
    cssVariables['profile-avatar-icon-background'] =
      cssVariables['profile-avatar-icon-background'] ||
      stringToColor(this.args.userId);
    let style = '';

    for (let [key, value] of Object.entries(cssVariables)) {
      style += `--${key}: ${value};`;
    }

    return htmlSafe(style);
  }

  <template>
    <ProfileAvatarIconVisual
      @isReady={{bool this.matrixService.profile.loaded}}
      @profileInitials={{this.profileInitials}}
      style={{this.style}}
      ...attributes
    />
  </template>
}

interface ProfileAvatarIconVisualSignature {
  Args: {
    isReady: boolean;
    profileInitials?: string;
  };
  Element: HTMLDivElement;
}

export class ProfileAvatarIconVisual extends Component<ProfileAvatarIconVisualSignature> {
  <template>
    <style>
      .profile-icon {
        background: var(--profile-avatar-icon-background);
        border-radius: var(--profile-avatar-icon-size, 40px);
        border: var(--profile-avatar-icon-border, 2px solid white);
        display: flex;
        height: var(--profile-avatar-icon-size, 40px);
        width: var(--profile-avatar-icon-size, 40px);
      }

      .profile-icon > span {
        color: white;
        margin: auto;
        font-size: calc(var(--profile-avatar-icon-size, 40px) * 0.55);
      }
    </style>

    <div class='profile-icon' data-test-profile-icon ...attributes>
      <span>
        {{#if @isReady}}
          {{@profileInitials}}
        {{/if}}
      </span>
    </div>
  </template>
}
