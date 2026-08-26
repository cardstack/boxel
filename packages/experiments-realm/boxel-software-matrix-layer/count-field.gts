import { Component } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import HashIcon from '@cardstack/boxel-icons/hash';

/**
 * A whole-number tally — things sold, sessions logged, pieces in a bundle.
 * The block owns the display problem counts share: grouping at full size
 * ("47,200") and compact notation where space is scarce ("47.2K"), with an
 * explicit zero rendered as a number and only null/undefined as "not counted".
 * It does not round or coerce a fractional value; a count that arrives as 2.5
 * is a writer bug the display should expose, not launder.
 */
function isSet(model: number | null | undefined): boolean {
  return typeof model === 'number' && Number.isFinite(model);
}

export class CountField extends NumberField {
  static displayName = 'Count';
  static icon = HashIcon;

  static embedded = class Embedded extends Component<typeof this> {
    get isSet() {
      return isSet(this.args.model);
    }
    get formatted() {
      return this.isSet
        ? new Intl.NumberFormat().format(this.args.model as number)
        : undefined;
    }
    <template>
      {{#if this.isSet}}
        <span class='count'>{{this.formatted}}</span>
      {{else}}
        <span class='unset' aria-label='Not counted'>—</span>
      {{/if}}
      <style scoped>
        .count {
          font-variant-numeric: tabular-nums;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .unset {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get isSet() {
      return isSet(this.args.model);
    }
    get formatted() {
      return this.isSet
        ? new Intl.NumberFormat(undefined, {
            notation: 'compact',
            maximumFractionDigits: 1,
          }).format(this.args.model as number)
        : undefined;
    }
    get full() {
      return this.isSet
        ? new Intl.NumberFormat().format(this.args.model as number)
        : undefined;
    }
    <template>
      {{#if this.isSet}}
        <span class='count-atom' title={{this.full}}>{{this.formatted}}</span>
      {{else}}
        <span class='unset' aria-label='Not counted'>—</span>
      {{/if}}
      <style scoped>
        .count-atom {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          color: var(--foreground, var(--boxel-dark));
          white-space: nowrap;
        }
        .unset {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export default CountField;
