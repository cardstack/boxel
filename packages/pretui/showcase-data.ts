// Pretui — the showcase's shared vocabulary: the categories the kit is filed
// under, where the component Specs live, and where each overview instance is.
import type { RealmResourceIdentifier } from '@cardstack/runtime-common';
import { siblingHref } from './demo-locations';

/** The Spec instances live in the catalog realm, not in this one. */
export const SPEC_REALM = '@cardstack/catalog/';

export const SPEC_REF = {
  module: '@cardstack/pretui/pretui-component' as RealmResourceIdentifier,
  name: 'PretUISpec',
};

export const THEME_REF = {
  module: '@cardstack/base/card-api' as RealmResourceIdentifier,
  name: 'Theme',
};

export interface ShowcaseCategory {
  /** the value Specs carry in their `category` field */
  name: string;
  slug: string;
  /** what the category is for, in one line */
  blurb: string;
}

export const CATEGORIES: readonly ShowcaseCategory[] = [
  {
    name: 'Inputs',
    slug: 'inputs',
    blurb: 'Every way to take a value, from a switch to a gradient editor.',
  },
  {
    name: 'Data Display',
    slug: 'data-display',
    blurb: 'Tables, charts, trees and the figures that sit in them.',
  },
  {
    name: 'Agentic',
    slug: 'agentic',
    blurb: 'Streaming answers, task receipts and approvals for AI work.',
  },
  {
    name: 'Foundations',
    slug: 'foundations',
    blurb: 'Chips, badges, type and the small marks everything builds on.',
  },
  {
    name: 'Feedback',
    slug: 'feedback',
    blurb: 'Progress, alerts, toasts and empty states.',
  },
  {
    name: 'Layout',
    slug: 'layout',
    blurb: 'Shells, grids, split panes and scroll areas.',
  },
  {
    name: 'Forms',
    slug: 'forms',
    blurb: 'Fields, sections, rule builders and wizards.',
  },
  {
    name: 'Authoring Tools',
    slug: 'authoring-tools',
    blurb: 'Dials, curves and property sheets for building tools.',
  },
  {
    name: 'Overlays',
    slug: 'overlays',
    blurb: 'Dialogs, popovers, menus and the command palette.',
  },
  {
    name: 'Media',
    slug: 'media',
    blurb: 'Players, galleries, croppers and waveforms.',
  },
  {
    name: 'Motion & Effects',
    slug: 'motion-effects',
    blurb: 'Reveals, text effects and pointer-driven motion.',
  },
  {
    name: 'Navigation',
    slug: 'navigation',
    blurb: 'Tabs, sidebars, breadcrumbs and pagination.',
  },
  {
    name: 'Actions',
    slug: 'actions',
    blurb: 'Buttons, groups, action bars and floating actions.',
  },
  {
    name: 'Containers',
    slug: 'containers',
    blurb: 'Cards, panels and the things that fold open.',
  },
];

export function categoryNamed(
  name: string | null | undefined,
): ShowcaseCategory | undefined {
  return CATEGORIES.find((c) => c.name === name);
}

/** The overview instance for a category, or for the whole kit. */
export function overviewHref(slug?: string): string {
  return siblingHref(`./showcase/overview-${slug ?? 'all'}`);
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** The catalog id of a component's Spec, from the component's name. */
export function specIdFor(name: string): string {
  return `${SPEC_REALM}Spec/pretui-${kebab(name)}`;
}

/** Whether two Spec ids name the same card, whatever form each is in. */
export function sameSpec(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  let tail = (id: string) =>
    id
      .replace(/\.json$/, '')
      .split('/')
      .pop();
  return tail(a) === tail(b);
}
