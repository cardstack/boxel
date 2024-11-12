import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Component from '@glimmer/component';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';

/**
 * The purpose of this function is to select a random color from a set of colors based on the input string.
 * This is used to assign a unique color to each user in the app.
 */
function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
  );
}

export function deterministicColorFromString(str: string): string {
  if (!str) return 'transparent';

  // Generate hash value between 0-1
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  // Convert to HSL (using same logic as getContrastColor)
  const hue = hash % 360;
  const saturation = 85 + (hash % 15); // 85-100% - very high saturation for vivid colors

  // Adjust lightness based on hue ranges
  let lightness;
  if (hue >= 50 && hue <= 70) {
    lightness = 60 + (hash % 15); // 60-75% - brighter for yellows
  } else if (hue >= 270 && hue <= 310) {
    lightness = 25 + (hash % 15); // 25-40% - darker for purples
  } else {
    lightness = 45 + (hash % 20); // 45-65% - medium range for other colors
  }

  // Convert HSL to RGB
  const c = ((1 - Math.abs((2 * lightness) / 100 - 1)) * saturation) / 100;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness / 100 - c / 2;

  let r, g, b;
  if (hue < 60) {
    [r, g, b] = [c, x, 0];
  } else if (hue < 120) {
    [r, g, b] = [x, c, 0];
  } else if (hue < 180) {
    [r, g, b] = [0, c, x];
  } else if (hue < 240) {
    [r, g, b] = [0, x, c];
  } else if (hue < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }

  // Convert to final RGB values
  const rgb = {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };

  return rgbToHex(rgb.r, rgb.g, rgb.b);
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

  get backgroundColor() {
    return deterministicColorFromString(this.args.userId);
  }

  get textColor() {
    console.log('textColor', getContrastColor(this.backgroundColor));
    return getContrastColor(this.backgroundColor);
  }

  <template>
    <ProfileAvatarIconVisual
      @isReady={{@isReady}}
      @profileInitials={{this.profileInitials}}
      style={{cssVar
        profile-avatar-icon-background=this.backgroundColor
        profile-avatar-text-color=this.textColor
      }}
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
    <div class='profile-icon' data-test-profile-icon={{@isReady}} ...attributes>
      <span>
        {{#if @isReady}}
          {{@profileInitials}}
        {{/if}}
      </span>
    </div>

    <style scoped>
      .profile-icon {
        background: var(--profile-avatar-icon-background, var(--boxel-dark));
        border-radius: var(--profile-avatar-icon-size, 40px);
        border: var(--profile-avatar-icon-border, 2px solid white);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--profile-avatar-icon-size, 40px);
        width: var(--profile-avatar-icon-size, 40px);
      }

      .profile-icon > span {
        color: var(--profile-avatar-text-color, var(--boxel-light));
        margin: auto;
        font-size: calc(var(--profile-avatar-icon-size, 40px) * 0.55);
      }
    </style>
  </template>;
