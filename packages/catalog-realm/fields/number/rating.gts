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
          font-size: 2rem;
          color: var(--muted, var(--boxel-300));
          cursor: pointer;
          padding: 0;
          transition: transform 0.1s;
        }
        .star-btn:hover {
          transform: scale(1.15);
        }
        .star-filled {
          color: var(--accent, var(--boxel-highlight));
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

    get stars() {
      return Array.from({ length: this.config.maxStars }, (_, idx) => ({
        filled: idx + 1 <= this.numericValue,
      }));
    }

    <template>
      {{#if this.hasValue}}
        <span class='rating-field-atom'>
          {{#each this.stars as |star|}}
            <span class='atom-star {{if star.filled "filled"}}'>★</span>
          {{/each}}
        </span>
      {{else}}
        <span class='rating-field-empty'>–</span>
      {{/if}}

      <style scoped>
        .rating-field-atom {
          display: inline-flex;
          gap: 2px;
          font-size: 0.875rem;
          line-height: 1;
        }
        .atom-star {
          color: var(--muted, var(--boxel-300));
        }
        .atom-star.filled {
          color: var(--accent, var(--boxel-highlight));
        }
        .rating-field-empty {
          display: inline-flex;
          font-size: 0.875rem;
          color: var(--muted-foreground, var(--boxel-400));
          font-family: var(--font-family, var(--boxel-font-family));
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
