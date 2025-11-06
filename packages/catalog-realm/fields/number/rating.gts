import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn, array } from '@ember/helper';
import { lte } from '@cardstack/boxel-ui/helpers';
import { getNumericValue, hasValue, type RatingConfig } from './util/index';

export default class RatingField extends NumberField {
  static displayName = 'Rating Number Field';

  static configuration = {
    presentation: {
      type: 'rating',
      maxStars: 5,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): RatingConfig {
      return this.args.configuration?.presentation ?? {
        maxStars: 5,
      };
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    setRating = (rating: number) => {
      this.args.set(rating);
    };

    <template>
      <div class='rating-field-edit'>
        {{#each (array 1 2 3 4 5) as |star|}}
          <button
            type='button'
            class='star-btn {{if (lte star this.numericValue) "star-filled"}}'
            {{on 'click' (fn this.setRating star)}}
          >★</button>
        {{/each}}
        <span
          class='rating-value'
        >{{this.numericValue}}/{{this.config.maxStars}}</span>
      </div>

      <style scoped>
        .rating-field-edit {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .star-btn {
          background: none;
          border: none;
          font-size: 1.25rem;
          color: var(--muted, var(--boxel-300, #d1d1d1));
          cursor: pointer;
          padding: 0;
          transition: transform 0.1s, color 0.2s;
        }
        .star-btn:hover {
          transform: scale(1.15);
        }
        .star-filled {
          color: var(--accent, var(--boxel-yellow, #ffd800));
        }
        .rating-value {
          margin-left: 0.5rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );
  };

  static atom = class Atom extends Component<typeof this> {
    get config(): RatingConfig {
      return this.args.configuration?.presentation ?? {
        maxStars: 5,
      };
    }

    get hasValue() {
      return hasValue(this.args.model);
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get isHighlighted() {
      return this.numericValue > 0;
    }

    <template>
      <span class='rating-field-atom'>
        <span class='atom-star {{if this.isHighlighted "highlighted"}}'>★</span>
        <span class='atom-value'>{{this.numericValue}}</span>
      </span>

      <style scoped>
        .rating-field-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
          line-height: 1;
        }
        .atom-star {
          font-size: var(--boxel-font-size-sm, 0.8125rem);
          color: var(--muted, var(--boxel-300, #d1d1d1));
        }
        .atom-star.highlighted {
          color: var(--accent, var(--boxel-yellow, #ffd800));
        }
        .atom-value {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-family: var(--font-mono, var(--boxel-monospace-font-family, monospace));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): RatingConfig {
      return this.args.configuration?.presentation ?? {
        maxStars: 5,
      };
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get stars() {
      return Array.from({ length: this.config.maxStars }, (_, idx) => ({
        value: idx + 1,
        filled: idx + 1 <= this.numericValue,
      }));
    }

    <template>
      <div class='rating-field-embedded'>
        <div class='stars'>
          {{#each this.stars as |star|}}
            <span class='star {{if star.filled "star-filled"}}'>★</span>
          {{/each}}
        </div>
        <span
          class='rating-label'
        >{{this.numericValue}}/{{this.config.maxStars}}</span>
      </div>

      <style scoped>
        .rating-field-embedded {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .stars {
          display: flex;
          gap: 0.25rem;
        }
        .star {
          font-size: 1.5rem;
          color: var(--muted, var(--boxel-300));
          line-height: 1;
        }
        .star-filled {
          color: var(--accent, var(--boxel-highlight));
        }
        .rating-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
