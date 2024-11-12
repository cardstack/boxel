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

function calculateContrast(lum1: number, lum2: number): number {
  return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}

function getLuminance(r: number, g: number, b: number): number {
  const [red, green, blue]: any = [r, g, b].map((c) => {
    const val = c / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function deterministicColorFromString(str: string): string {
  if (!str) {
    return 'transparent';
  }

  // Generate hash value between 0-1
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  const hue = hash % 360;
  const saturation = 65 + (hash % 15); // 65-80% for better contrast

  // Adjust lightness for WCAG contrast
  let lightness = 50; // Starting lightness value

  // Convert HSL to RGB
  function hslToRgb(h: number, s: number, l: number) {
    const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;

    let [r, g, b] = [0, 0, 0];
    if (h < 60) {
      [r, g, b] = [c, x, 0];
    } else if (h < 120) {
      [r, g, b] = [x, c, 0];
    } else if (h < 180) {
      [r, g, b] = [0, c, x];
    } else if (h < 240) {
      [r, g, b] = [0, x, c];
    } else if (h < 300) {
      [r, g, b] = [x, 0, c];
    } else {
      [r, g, b] = [c, 0, x];
    }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  // Adjust lightness to ensure contrast ratio of 4.5:1 or above
  const targetContrast = 4.5;
  let rgb: any;
  while (lightness <= 100) {
    rgb = hslToRgb(hue, saturation, lightness);
    const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
    const contrastWithBlack = calculateContrast(luminance, 0); // Black luminance = 0
    const contrastWithWhite = calculateContrast(luminance, 1); // White luminance = 1

    // Check if the color meets contrast requirements against black or white
    if (
      contrastWithBlack >= targetContrast ||
      contrastWithWhite >= targetContrast
    ) {
      break;
    }
    lightness += 1; // Increase lightness to improve contrast if needed
  }

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
