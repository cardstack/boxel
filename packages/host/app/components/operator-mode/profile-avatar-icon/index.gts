import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { bool } from '@cardstack/boxel-ui/helpers';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';

import { stringToColor } from '@cardstack/host/lib/utils';
import MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    userId: string | null;
    size?: string; // CSS length value
    border?: string; // CSS border value
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

  <template>
    <ProfileAvatarIconVisual
      @isReady={{bool this.matrixService.profile.loaded}}
      @profileInitials={{this.profileInitials}}
      {{setCssVar profile-avatar-icon-background=(stringToColor @userId)}}
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

const ProfileAvatarIconVisual: TemplateOnlyComponent<ProfileAvatarIconVisualSignature> =
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
  </template>;

export { ProfileAvatarIconVisual };
