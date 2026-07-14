import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

// 🧩 PATTERN: cardTitle override — cardInfo.name first, then primary field, then default.
//
// This is the canonical form. Catalog cards vary; this combines the best of them.

// === Example 1: Card with a single primary identifier ================

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';

  @field headline = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: BlogPost) {
      // 1) Respect user-entered cardInfo.name first.
      if (this.cardInfo?.name?.trim()?.length) {
        return this.cardInfo.name;
      }
      // 2) Fall back to the primary field.
      if (this.headline) {
        return this.headline;
      }
      // 3) Final fallback — the default behavior.
      return `Untitled ${this.constructor.displayName}`;
    },
  });
}

// === Example 2: Card with composite identity (multiple fields) ========

export class Person extends CardDef {
  static displayName = 'Person';

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Person) {
      if (this.cardInfo?.name?.trim()?.length) {
        return this.cardInfo.name;
      }
      let parts = [this.firstName, this.lastName].filter(Boolean);
      return parts.length
        ? parts.join(' ')
        : `Untitled ${this.constructor.displayName}`;
    },
  });
}

// === Example 3: Computed description in addition to cardTitle =========

export class Recipe extends CardDef {
  static displayName = 'Recipe';

  @field title = contains(StringField);
  @field totalMinutes = contains(NumberField);
  @field servings = contains(NumberField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Recipe) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.title ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: Recipe) {
      if (this.cardInfo?.summary?.trim()?.length) {
        return this.cardInfo.summary;
      }
      let pieces: string[] = [];
      if (this.totalMinutes) pieces.push(`${this.totalMinutes} min`);
      if (this.servings) pieces.push(`${this.servings} servings`);
      return pieces.join(' · ');
    },
  });
}

// === Example 4: Static title (singleton-style card) ===================

export class Blackjack extends CardDef {
  static displayName = 'Blackjack';

  @field score = contains(NumberField);

  // No user-facing title to compute from. Static is appropriate here.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Blackjack) {
      return 'Blackjack';
    },
  });
}
