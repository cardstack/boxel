import { Component } from '@cardstack/base/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { lte, not, eq } from '@cardstack/boxel-ui/helpers';
import NumberField from '@cardstack/base/number';

// Star-rating score field (1–5), modeled on the catalog's rating field
// (boxel-catalog fields/rating/rating.gts) but self-contained in this realm.
const MAX_STARS = 5;

function numericValue(model: number | null | undefined): number {
  return typeof model === 'number' && Number.isFinite(model) ? model : 0;
}

const STARS = Array.from({ length: MAX_STARS }, (_, idx) => idx + 1);

export class ScoreField extends NumberField {
  static displayName = 'Score';

  static edit = class Edit extends Component<typeof this> {
    stars = STARS;

    @tracked poppedStar: number | undefined;

    get numericValue() {
      return numericValue(this.args.model);
    }

    setScore = (score: number) => {
      this.args.set(score);
      this.poppedStar = score;
      setTimeout(() => {
        if (this.poppedStar === score) {
          this.poppedStar = undefined;
        }
      }, 150);
    };

    <template>
      <div class='score-edit'>
        {{#each this.stars as |star|}}
          <button
            type='button'
            class='star
              {{if (lte star this.numericValue) "filled"}}
              {{if (eq star this.poppedStar) "pop"}}'
            disabled={{not @canEdit}}
            aria-label='Set score to {{star}}'
            {{on 'click' (fn this.setScore star)}}
          >{{if (lte star this.numericValue) '★' '☆'}}</button>
        {{/each}}
        <span class='score-value'>{{this.numericValue}}/5</span>
      </div>
      <style scoped>
        .score-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
        }
        .star {
          --score-star: #f59e0b;
          background: none;
          border: none;
          font-size: 1.25rem;
          color: var(--muted-foreground, var(--boxel-300));
          cursor: pointer;
          padding: 0;
          transition:
            color 0.2s ease-out,
            transform 0.15s ease-out;
        }
        .star.filled {
          color: var(--score-star);
        }
        .star.pop {
          transform: scale(1.25);
        }
        .star:disabled {
          cursor: not-allowed;
        }
        .score-value {
          margin-left: var(--boxel-sp-xs);
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          line-height: 1;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    stars = STARS;

    get numericValue() {
      return numericValue(this.args.model);
    }

    <template>
      <div class='score-embedded'>
        {{#each this.stars as |star|}}
          <span class='star {{if (lte star this.numericValue) "filled"}}'>{{if
              (lte star this.numericValue)
              '★'
              '☆'
            }}</span>
        {{/each}}
        <span class='score-value'>{{this.numericValue}}/5</span>
      </div>
      <style scoped>
        .score-embedded {
          --score-star: #f59e0b;
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
        }
        .star {
          font-size: 1rem;
          color: var(--muted-foreground, var(--boxel-300));
        }
        .star.filled {
          color: var(--score-star);
        }
        .score-value {
          margin-left: var(--boxel-sp-xs);
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          line-height: 1;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get numericValue() {
      return numericValue(this.args.model);
    }

    <template>
      <span class='score-atom'>
        <span class='star {{if this.numericValue "filled"}}'>★</span>
        {{this.numericValue}}
      </span>
      <style scoped>
        .score-atom {
          --score-star: #f59e0b;
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          line-height: 1;
          color: var(--foreground, var(--boxel-dark));
        }
        .star {
          color: var(--muted-foreground, var(--boxel-300));
          font-size: 0.8125rem;
        }
        .star.filled {
          color: var(--score-star);
        }
      </style>
    </template>
  };
}
