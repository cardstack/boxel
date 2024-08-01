import {
  contains,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import GlimmerComponent from '@glimmer/component';
import { cn } from '@cardstack/boxel-ui/helpers';

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatNumber(val: number | undefined) {
  if (val === undefined) {
    return '';
  }
  return numberFormatter.format(val);
}

interface StarRatingSignature {
  Element: HTMLDivElement;
  Args: {
    value: number | undefined;
  };
}

export class StarRating extends GlimmerComponent<StarRatingSignature> {
  get rating() {
    return this.args.value || 0;
  }
  maxRating = 5;
  fullClassNames = 'star-full';
  emptyClassNames = 'star-empty';

  get stars() {
    let rating = Math.round(this.rating);
    let starsArray = [];
    for (let i = 1; i <= this.maxRating; i++) {
      starsArray.push({ rating: i, full: rating >= i });
    }
    return starsArray;
  }
  <template>
    <div class='StarRating' ...attributes>
      {{#each this.stars as |star|}}
        <button
          class={{cn
            'star'
            (if star.full this.fullClassNames this.emptyClassNames)
          }}
          type='button'
        >{{if star.full '★' '☆'}}</button>
      {{/each}}
    </div>
    <style>
      .star {
        color: inherit;
        border: 0;
        background: none;
        padding: 0;
      }
    </style>
  </template>
}

class View extends Component<typeof RatingsSummary> {
  <template>
    <StarRating @value={{@model.average}} class='star-rating' />
    <span class='reviews-count'>
      ({{formatNumber @model.count}})
    </span>
    <style>
      .star-rating {
        display: inline-block;
      }
    </style>
  </template>
}

export class RatingsSummary extends FieldDef {
  static displayName = 'Ratings Summary';

  @field average = contains(NumberField);
  @field count = contains(NumberField);

  static atom = View;
  static embedded = View;
}
