import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Component from '@glimmer/component';

import cssVar from '../../helpers/css-var.ts';

/**
 * The purpose of this function is to select a random color from a set of colors based on the input string.
 * This is used to assign a unique color to each user in the app.
 */
export function stringToColor(string: string | null) {
  if (!string) {
    return 'transparent';
  }
  // Generate hash from string
  let hash = 0;
  for (let i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Use HSL color space for better control over brightness
  // Hue: Use full range (0-360) for variety of colors
  const hue = Math.abs(hash) % 360;
  // Saturation: Keep it between 35-85% for vibrant but not overwhelming colors
  const saturation = 35 + (Math.abs(hash >> 8) % 70);
  // Lightness: Keep it between 25-45% to ensure contrast with white text
  const lightness = 25 + (Math.abs(hash >> 16) % 51);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

interface Signature {
  Args: {
    displayName?: string;
    isReady: boolean;
    userId: string;
  };
  Element: HTMLDivElement;
}

export default class ProfileAvatarIcon extends Component<Signature> {
  get profileInitials() {
    let displayName = this.args.displayName ?? 'Default';
    return displayName.slice(0, 1).toUpperCase();
  }

  <template>
    <ProfileAvatarIconVisual
      @isReady={{@isReady}}
      @profileInitials={{this.profileInitials}}
      style={{cssVar profile-avatar-icon-background=(stringToColor @userId)}}
      data-test-profile-user-id={{@userId}}
      data-test-profile-display-name={{@displayName}}
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
    <style scoped>
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

    <div class='profile-icon' data-test-profile-icon={{@isReady}} ...attributes>
      <span>
        {{#if @isReady}}
          {{@profileInitials}}
        {{/if}}
      </span>
    </div>
  </template>;
