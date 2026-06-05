import {
  contains,
  field,
  CardDef,
  FieldDef,
  Component,
  relativeTo,
  virtualNetworkFor,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import CurrencyIcon from '@cardstack/boxel-icons/currency';
import CircleDotIcon from '@cardstack/boxel-icons/circle-dot';

export class Asset extends CardDef {
  static displayName = 'Asset';
  @field name = contains(StringField);
  @field symbol = contains(StringField);
  @field logoURL = contains(StringField);
  @field logoHref = contains(StringField, {
    computeVia: function (this: Asset) {
      if (!this.logoURL) {
        return null;
      }
      let rel = this[relativeTo] || this.id;
      // The instance may have no store-attached VirtualNetwork (detached
      // / static-parse contexts), and `rel` may be a prefix-form RRI
      // (e.g. `@cardstack/…/Asset/foo`) that `new URL()` can't parse on
      // its own. If we can't resolve a base, return `logoURL` raw so the
      // <img src> binding still has a string to render rather than
      // letting the compute throw.
      try {
        let base =
          typeof rel === 'string'
            ? (virtualNetworkFor(this)?.toURL(rel) ?? new URL(rel))
            : rel;
        return new URL(this.logoURL, base).href;
      } catch {
        return this.logoURL;
      }
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Asset) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof Asset> {
    <template>
      <div class='asset-card'>
        {{#if @model.logoURL}}
          <img
            src={{@model.logoHref}}
            width='20'
            height='20'
            aria-hidden='true'
          />
        {{/if}}
        <div class='currency'><@fields.symbol /></div>
      </div>
      <style scoped>
        .asset-card {
          display: inline-grid;
          grid-template-columns: var(--boxel-sp) 1fr;
          gap: var(--boxel-sp-xxxs);
        }

        .currency {
          font: 700 var(--boxel-font);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Asset> {
    <template>
      <span>
        {{#if @model.logoURL}}
          <img
            src={{@model.logoHref}}
            width='20'
            height='20'
            aria-hidden='true'
          />
        {{/if}}
        {{@model.cardTitle}}
      </span>
      <style scoped>
        img {
          vertical-align: middle;
          margin-right: var(--boxel-sp-xxxs);
        }
      </style>
    </template>
  };
}

class AssetField extends FieldDef {
  static displayName = 'Asset';
  @field name = contains(StringField);
  @field symbol = contains(StringField);
  @field logoURL = contains(StringField);
  @field logoHref = contains(StringField, {
    computeVia: function (this: Asset) {
      if (!this.logoURL) {
        return null;
      }
      let rel = this[relativeTo] || this.id;
      // The instance may have no store-attached VirtualNetwork (detached
      // / static-parse contexts), and `rel` may be a prefix-form RRI
      // (e.g. `@cardstack/…/Asset/foo`) that `new URL()` can't parse on
      // its own. If we can't resolve a base, return `logoURL` raw so the
      // <img src> binding still has a string to render rather than
      // letting the compute throw.
      try {
        let base =
          typeof rel === 'string'
            ? (virtualNetworkFor(this)?.toURL(rel) ?? new URL(rel))
            : rel;
        return new URL(this.logoURL, base).href;
      } catch {
        return this.logoURL;
      }
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Asset) {
      return this.name;
    },
  });
  static embedded = class Embedded extends Component<typeof Asset> {
    <template>
      <div class='asset-card'>
        {{#if @model.logoURL}}
          <img
            src={{@model.logoHref}}
            width='20'
            height='20'
            aria-hidden='true'
          />
        {{/if}}
        <div class='currency'><@fields.symbol /></div>
      </div>
      <style scoped>
        .asset-card {
          display: inline-grid;
          grid-template-columns: var(--boxel-sp) 1fr;
          gap: var(--boxel-sp-xxxs);
        }

        .currency {
          font: 700 var(--boxel-font);
        }
      </style>
    </template>
  };
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

// For fiat money
export class Currency extends Asset {
  static displayName = 'Currency';
  @field sign = contains(StringField); // $, €, £, ¥, ₽, ₿ etc.
  @field locale = contains(StringField); // en-US, en-GB, ja-JP, ru-RU, etc.

  get formatter() {
    if (!currencyFormatters.has(this.locale)) {
      currencyFormatters.set(
        this.locale,
        new Intl.NumberFormat(this.locale, {
          style: 'currency',
          currency: this.symbol,
        }),
      );
    }
    return currencyFormatters.get(this.locale)!;
  }

  format(amount?: number) {
    if (amount === undefined) {
      return '';
    }
    return this.formatter.format(amount);
  }
}

export class CurrencyField extends AssetField {
  static displayName = 'Currency';
  static icon = CurrencyIcon;
  @field sign = contains(StringField); // $, €, £, ¥, ₽, ₿ etc.
}

// For crypto
export class Token extends Asset {
  static displayName = 'Token';
  static icon = CircleDotIcon;
  @field address = contains(StringField);
}

export class TokenField extends AssetField {
  static displayName = 'Token';
  @field address = contains(StringField);
}
