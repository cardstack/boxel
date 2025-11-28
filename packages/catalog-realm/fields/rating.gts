import { Component } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { lte } from '@cardstack/boxel-ui/helpers';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { getNumericValue, hasValue } from './number/util/index';

// Options interface for rating field
export interface RatingOptions {
  maxStars?: number;
}

// TypeScript configuration interface
export type RatingFieldConfiguration = {
  presentation?: 'rating';
  options?: RatingOptions;
};

export default class RatingField extends NumberField {
  static displayName = 'Rating Number Field';

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return (this.args.configuration as RatingFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get maxStars() {
      return this.options.maxStars ?? 5;
    }

    get stars() {
      return Array.from({ length: this.maxStars }, (_, idx) => idx + 1);
    }

    setRating = (rating: number) => {
      this.args.set(rating);
    };

    <template>
      <div class='rating-field-edit' data-test-rating-edit>
        {{#each this.stars as |star|}}
          <button
            type='button'
            class='star-btn {{if (lte star this.numericValue) "star-filled"}}'
            {{on 'click' (fn this.setRating star)}}
          >★</button>
        {{/each}}
        <span
          class='rating-value'
        >{{this.numericValue}}/{{this.maxStars}}</span>
      </div>

      <style scoped>
        .rating-field-edit {
          display: flex;
          align-items: center;
          gap: calc(var(--spacing, 0.25rem) * 2);
        }
        .star-btn {
          background: none;
          border: none;
          font-size: 1.25rem;
          color: var(--muted, #f1f5f9);
          cursor: pointer;
          padding: 0;
          transition:
            transform 0.1s,
            color 0.2s;
        }
        .star-btn:hover {
          transform: scale(1.15);
        }
        .star-filled {
          color: var(--accent, #f59e0b);
        }
        .rating-value {
          margin-left: calc(var(--spacing, 0.25rem) * 2);
          font-weight: 600;
          color: var(--muted-foreground, #64748b);
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
    get config() {
      return (this.args.configuration as RatingFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
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
      <span class='rating-field-atom' data-test-rating-atom>
        <span class='atom-star {{if this.isHighlighted "highlighted"}}'>★</span>
        <span class='atom-value'>{{this.numericValue}}</span>
      </span>

      <style scoped>
        .rating-field-atom {
          display: inline-flex;
          align-items: center;
          gap: calc(var(--spacing, 0.25rem) * 1);
          line-height: 1;
        }
        .atom-star {
          font-size: 0.8125rem;
          color: var(--muted, #f1f5f9);
        }
        .atom-star.highlighted {
          color: var(--accent, #f59e0b);
        }
        .atom-value {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return (this.args.configuration as RatingFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get maxStars() {
      return this.options.maxStars ?? 5;
    }

    get stars() {
      return Array.from({ length: this.maxStars }, (_, idx) => ({
        value: idx + 1,
        filled: idx + 1 <= this.numericValue,
      }));
    }

    <template>
      <div class='rating-field-embedded'>
        <div class='rating-header'>
          <span class='rating-title'>Rating</span>
          <span
            class='rating-score'
          >{{this.numericValue}}/{{this.maxStars}}</span>
        </div>
        <div class='stars'>
          {{#each this.stars as |star|}}
            <span class='star {{if star.filled "star-filled"}}'>★</span>
          {{/each}}
        </div>
      </div>

      <style scoped>
        .rating-field-embedded {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 3);
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.75rem);
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card, #ffffff);
        }
        .rating-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .rating-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, #64748b);
        }
        .rating-score {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
        }
        .stars {
          display: flex;
          gap: calc(var(--spacing, 0.25rem) * 2);
          justify-content: center;
        }
        .star {
          font-size: 2rem;
          color: var(--muted, #f1f5f9);
          line-height: 1;
          transition: color 0.2s;
        }
        .star-filled {
          color: var(--accent, #f59e0b);
        }
      </style>
    </template>
  };
}
