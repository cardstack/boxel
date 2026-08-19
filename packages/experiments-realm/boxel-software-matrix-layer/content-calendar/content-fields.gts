import { Component, StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import BrandFacebookIcon from '@cardstack/boxel-icons/brand-facebook';
import BrandInstagramIcon from '@cardstack/boxel-icons/brand-instagram';
import BrandTiktokIcon from '@cardstack/boxel-icons/brand-tiktok';
import BrandYoutubeIcon from '@cardstack/boxel-icons/brand-youtube';
import CircleCheckIcon from '@cardstack/boxel-icons/circle-check';
import RepeatIcon from '@cardstack/boxel-icons/repeat';

import StatePill from '../components/state-pill';
import { stateColor, type Hue, type StateColor } from '../utils/index';

export type PlatformIcon = typeof BrandInstagramIcon;

export interface PlatformStyle {
  value: string;
  label: string;
  /** Two-letter mark for calendar chips, where a full label never fits. */
  short: string;
  hue: Hue;
  icon: PlatformIcon;
}

export const PLATFORMS: PlatformStyle[] = [
  {
    value: 'instagram_reel',
    label: 'Instagram Reel',
    short: 'IG',
    hue: 'pink',
    icon: BrandInstagramIcon,
  },
  {
    value: 'instagram_story',
    label: 'Instagram Story',
    short: 'IG',
    hue: 'purple',
    icon: BrandInstagramIcon,
  },
  {
    value: 'instagram_post',
    label: 'Instagram Post',
    short: 'IG',
    hue: 'orange',
    icon: BrandInstagramIcon,
  },
  {
    value: 'tiktok',
    label: 'TikTok',
    short: 'TT',
    hue: 'teal',
    icon: BrandTiktokIcon,
  },
  {
    value: 'youtube',
    label: 'YouTube',
    short: 'YT',
    hue: 'red',
    icon: BrandYoutubeIcon,
  },
  {
    value: 'facebook',
    label: 'Facebook',
    short: 'FB',
    hue: 'blue',
    icon: BrandFacebookIcon,
  },
];

const UNKNOWN_PLATFORM: PlatformStyle = {
  value: '',
  label: 'No platform',
  short: '—',
  hue: 'slate',
  icon: BrandInstagramIcon,
};

export function platformStyle(value?: string | null): PlatformStyle {
  return PLATFORMS.find((p) => p.value === value) ?? UNKNOWN_PLATFORM;
}

// Hues resolve through stateColor so a linked Theme reskins every chip; the
// brand palette is deliberately not reproduced as literals.
export const PLATFORM_COLORS: Record<string, StateColor> = Object.fromEntries(
  PLATFORMS.map((p) => [p.value, stateColor(p.hue)]),
);

export const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.value, p.label]),
);

export const PLATFORM_SHORT: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.value, p.short]),
);

export const PLATFORM_ICONS: Record<string, PlatformIcon> = Object.fromEntries(
  PLATFORMS.map((p) => [p.value, p.icon]),
);

const PlatformEnum = enumField(StringField, {
  options: PLATFORMS.map((p) => ({ value: p.value, label: p.label })),
  displayName: 'Platform',
  icon: BrandInstagramIcon,
});

export class PlatformField extends PlatformEnum {
  static displayName = 'Platform';
  static icon = BrandInstagramIcon;

  static atom = class Atom extends Component<typeof PlatformField> {
    get style() {
      return platformStyle(this.args.model as unknown as string);
    }
    <template>
      <StatePill @label={{this.style.short}} @hue={{this.style.hue}} />
    </template>
  };

  static embedded = class Embedded extends Component<typeof PlatformField> {
    get style() {
      return platformStyle(this.args.model as unknown as string);
    }
    <template>
      <StatePill @label={{this.style.label}} @hue={{this.style.hue}} @dot={{true}} />
    </template>
  };
}

export interface ContentStatusStyle {
  value: string;
  label: string;
  hue: Hue;
}

export const CONTENT_STATUSES: ContentStatusStyle[] = [
  { value: 'planned', label: 'Planned', hue: 'slate' },
  { value: 'in_progress', label: 'In Progress', hue: 'amber' },
  { value: 'done', label: 'Done', hue: 'green' },
];

const UNKNOWN_STATUS: ContentStatusStyle = {
  value: '',
  label: 'No status',
  hue: 'slate',
};

export function contentStatusStyle(value?: string | null): ContentStatusStyle {
  return CONTENT_STATUSES.find((s) => s.value === value) ?? UNKNOWN_STATUS;
}

export const CONTENT_STATUS_COLORS: Record<string, StateColor> =
  Object.fromEntries(CONTENT_STATUSES.map((s) => [s.value, stateColor(s.hue)]));

export const CONTENT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  CONTENT_STATUSES.map((s) => [s.value, s.label]),
);

// Drives the one-click status change; an unset status enters at the first stage.
export function nextContentStatus(value?: string | null): string {
  let i = CONTENT_STATUSES.findIndex((s) => s.value === value);
  return CONTENT_STATUSES[(i + 1) % CONTENT_STATUSES.length].value;
}

export function isDoneStatus(value?: string | null): boolean {
  return value === 'done';
}

const ContentStatusEnum = enumField(StringField, {
  options: CONTENT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  displayName: 'Content Status',
  icon: CircleCheckIcon,
});

export class ContentStatusField extends ContentStatusEnum {
  static displayName = 'Content Status';
  static icon = CircleCheckIcon;

  static atom = class Atom extends Component<typeof ContentStatusField> {
    get style() {
      return contentStatusStyle(this.args.model as unknown as string);
    }
    <template>
      <StatePill @label={{this.style.label}} @hue={{this.style.hue}} @dot={{true}} />
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof ContentStatusField
  > {
    get style() {
      return contentStatusStyle(this.args.model as unknown as string);
    }
    <template>
      <StatePill @label={{this.style.label}} @hue={{this.style.hue}} @dot={{true}} />
    </template>
  };
}

export interface CadenceStyle {
  value: string;
  label: string;
  /** Day step; 0 means step by calendar month instead of a fixed day count. */
  everyDays: number;
}

export const CADENCES: CadenceStyle[] = [
  { value: 'weekly', label: 'Weekly', everyDays: 7 },
  { value: 'fortnightly', label: 'Fortnightly', everyDays: 14 },
  { value: 'monthly', label: 'Monthly', everyDays: 0 },
];

export function cadenceStyle(value?: string | null): CadenceStyle | undefined {
  return CADENCES.find((c) => c.value === value);
}

export const CADENCE_LABELS: Record<string, string> = Object.fromEntries(
  CADENCES.map((c) => [c.value, c.label]),
);

const CadenceEnum = enumField(StringField, {
  options: CADENCES.map((c) => ({ value: c.value, label: c.label })),
  displayName: 'Cadence',
  icon: RepeatIcon,
});

export class CadenceField extends CadenceEnum {
  static displayName = 'Cadence';
  static icon = RepeatIcon;

  static atom = class Atom extends Component<typeof CadenceField> {
    get label() {
      return cadenceStyle(this.args.model as unknown as string)?.label;
    }
    <template>
      <StatePill @label={{this.label}} @hue='teal' @chrome={{true}} />
    </template>
  };

  static embedded = class Embedded extends Component<typeof CadenceField> {
    get label() {
      return cadenceStyle(this.args.model as unknown as string)?.label;
    }
    <template>
      <StatePill @label={{this.label}} @hue='teal' @chrome={{true}} />
    </template>
  };
}
