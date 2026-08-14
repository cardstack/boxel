import { htmlSafe } from '@ember/template';
import { Component, StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import AwardIcon from '@cardstack/boxel-icons/award';

import { stateColor, type Hue } from './utils/index';

/**
 * A member's standing on a ladder — the generic block, not one club's version
 * of it.
 *
 * A tier differs from a status in one structural way: tiers are ORDERED. The
 * whole point of holding Gold is that it outranks Silver — priority windows,
 * earning multipliers and upgrade prompts all compare positions on the ladder.
 * So the option list is rank order (lowest first), rank helpers are part of
 * the block, and a consumer never string-compares tier names to decide who
 * goes first.
 *
 * The ladder itself — names, colours, multipliers — is the consumer's
 * vocabulary. The default export is a neutral four-step ladder for consumers
 * without opinions yet; anything with a real program calls `loyaltyTierField`
 * with its own.
 */
export interface TierOption {
  value: string;
  label?: string;
  hue?: Hue;
  /**
   * Earning multiplier at this tier. The field never computes points with it —
   * that is a points engine's job — it stores the ladder's published rate so
   * every consumer quotes the same number.
   */
  multiplier?: number;
  /** One line on what the tier gets you — the benefit, not the name restated. */
  meaning?: string;
}

export interface LoyaltyTierConfig {
  /** Rank order, lowest tier first. */
  options: TierOption[];
  displayName?: string;
  icon?: unknown;
}

export interface LoyaltyTierFieldClass {
  tierOptions: TierOption[];
}

function optionOf(
  options: TierOption[],
  value?: string | null,
): TierOption | undefined {
  return options.find((o) => o.value === value);
}

function rankOf(options: TierOption[], value?: string | null): number {
  return options.findIndex((o) => o.value === value);
}

/**
 * Build a tier field bound to one ladder. Returns a real FieldDef subclass,
 * so edit is the constrained dropdown that comes with `enumField` — no way to
 * store a value that is not a rung.
 */
export function loyaltyTierField(config: LoyaltyTierConfig) {
  let { options } = config;

  let Base = enumField(StringField, {
    displayName: config.displayName ?? 'Tier',
    icon: config.icon ?? AwardIcon,
    options: options.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
    })),
  });

  class LoyaltyTier extends Base {
    static displayName = config.displayName ?? 'Tier';
    static tierOptions = options;

    static embedded = class Embedded extends Component<typeof this> {
      get option() {
        return optionOf(options, this.args.model as unknown as string);
      }
      get rank() {
        return rankOf(options, this.args.model as unknown as string);
      }
      get rungs() {
        return options.map((_, i) => i <= this.rank);
      }
      <template>
        {{#if this.option}}
          <TierBadge
            @label={{if this.option.label this.option.label this.option.value}}
            @hue={{this.option.hue}}
            @value={{this.option.value}}
          >
            {{! The rung dots place this tier on its ladder at a glance —
                progression is the thing a tier has that a plain label lacks. }}
            <span class='rungs' aria-hidden='true'>
              {{#each this.rungs as |filled|}}
                <span class='rung {{if filled "filled"}}' />
              {{/each}}
            </span>
          </TierBadge>
        {{else}}
          <span class='no-tier'>No tier</span>
        {{/if}}
        <style scoped>
          .rungs {
            display: inline-flex;
            gap: 2px;
            margin-left: var(--boxel-sp-4xs);
          }
          .rung {
            width: 0.25rem;
            height: 0.25rem;
            border-radius: 50%;
            background: currentColor;
            opacity: 0.25;
          }
          .rung.filled {
            opacity: 1;
          }
          .no-tier {
            font-size: var(--boxel-font-size-sm);
            color: var(--muted-foreground, var(--boxel-450));
          }
        </style>
      </template>
    };

    static atom = class Atom extends Component<typeof this> {
      get option() {
        return optionOf(options, this.args.model as unknown as string);
      }
      <template>
        {{#if this.option}}
          <TierBadge
            @label={{if this.option.label this.option.label this.option.value}}
            @hue={{this.option.hue}}
            @value={{this.option.value}}
          />
        {{/if}}
      </template>
    };
  }

  return LoyaltyTier;
}

/** The tier's position on its ladder, 0 = lowest; -1 for an unknown value. */
export function tierRank(
  fieldClass: LoyaltyTierFieldClass,
  value?: string | null,
): number {
  return rankOf(fieldClass.tierOptions, value);
}

/** Whether `value` sits at or above `minimum` — the priority-window question. */
export function tierAtLeast(
  fieldClass: LoyaltyTierFieldClass,
  value?: string | null,
  minimum?: string | null,
): boolean {
  let v = rankOf(fieldClass.tierOptions, value);
  let m = rankOf(fieldClass.tierOptions, minimum);
  return v >= 0 && m >= 0 && v >= m;
}

/** The rung above, or undefined at the top — what an upgrade prompt offers. */
export function nextTier(
  fieldClass: LoyaltyTierFieldClass,
  value?: string | null,
): TierOption | undefined {
  let rank = rankOf(fieldClass.tierOptions, value);
  return rank >= 0 ? fieldClass.tierOptions[rank + 1] : undefined;
}

export function tierOption(
  fieldClass: LoyaltyTierFieldClass,
  value?: string | null,
): TierOption | undefined {
  return optionOf(fieldClass.tierOptions, value);
}

export function tierMultiplier(
  fieldClass: LoyaltyTierFieldClass,
  value?: string | null,
): number {
  return optionOf(fieldClass.tierOptions, value)?.multiplier ?? 1;
}

interface TierBadgeSignature {
  Args: {
    label: string;
    hue?: Hue;
    /** The stored tier value; slugged into the per-tier theme-token hook. */
    value?: string;
  };
  Blocks: { default?: [] };
  Element: HTMLElement;
}

function slugOf(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * The badge is the tier made visible — the one place the ladder's styling
 * lives. Colours route through per-tier theme tokens (`--tier-<slug>-bg`,
 * `--tier-<slug>-fg`) so an app can hand its ladder a metallic treatment in
 * its theme; the fallback pair derives from the option's hue and stays
 * legible in both themes.
 */
export class TierBadge extends Component<TierBadgeSignature> {
  get style() {
    let { bg, fg, ring } = stateColor(this.args.hue ?? 'slate');
    let slug = slugOf(this.args.value);
    if (!slug) {
      return htmlSafe(`background: ${bg}; color: ${fg}; --tier-ring: ${ring};`);
    }
    return htmlSafe(
      `background: var(--tier-${slug}-bg, ${bg});` +
        ` color: var(--tier-${slug}-fg, ${fg});` +
        ` --tier-ring: var(--tier-${slug}-ring, ${ring});`,
    );
  }

  <template>
    <span class='tier-badge' style={{this.style}} ...attributes>
      <span class='tier-label'>{{@label}}</span>
      {{yield}}
    </span>
    <style scoped>
      .tier-badge {
        display: inline-flex;
        align-items: center;
        padding: 1px var(--boxel-sp-xs);
        border-radius: 999px;
        box-shadow: inset 0 0 0 1px
          color-mix(in oklch, var(--tier-ring) 45%, transparent);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .tier-label {
        line-height: 1.6;
      }
    </style>
  </template>
}

/**
 * A neutral four-step ladder for consumers that just want standing and do not
 * have a program yet. Anything with a real program calls `loyaltyTierField`
 * with its own rungs, colours and multipliers.
 */
export const LoyaltyTierField = loyaltyTierField({
  displayName: 'Loyalty Tier',
  options: [
    { value: 'Bronze', hue: 'orange' },
    { value: 'Silver', hue: 'slate' },
    { value: 'Gold', hue: 'amber' },
    { value: 'Platinum', hue: 'teal' },
  ],
});

export default LoyaltyTierField;
