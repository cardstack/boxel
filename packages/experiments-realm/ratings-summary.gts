import { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import {
  contains,
  field,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';

import { and, cn, eq, not } from '@cardstack/boxel-ui/helpers';
import { Star, StarHalfFill, StarFilled } from '@cardstack/boxel-ui/icons';

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatNumber(val: number | undefined) {
  return val !== undefined ? numberFormatter.format(val) : '0';
}

type StarType = 'full' | 'half' | 'empty';
interface StarIconSignature {
  Args: { type: StarType };
  Element: HTMLElement;
}
const StarIcon: TemplateOnlyComponent<StarIconSignature> = <template>
  {{#if (eq @type 'full')}}
    <StarFilled width='12' height='12' ...attributes />
  {{else if (eq @type 'half')}}
    <StarHalfFill width='12' height='12' ...attributes />
  {{else}}
    <Star width='12' height='12' ...attributes />
  {{/if}}
</template>;

interface StarRatingSignature {
  Args: {
    value: number | undefined;
    isEditable?: boolean;
  };
  Element: HTMLElement;
}
export class StarRating extends GlimmerComponent<StarRatingSignature> {
  maxRating = 5;
  fullClassNames = 'star-button-full';
  emptyClassNames = 'star-button-empty';
  halfFullClassNames = 'star-button-half-full';

  get rating() {
    return this.args.value ?? 0;
  }
  get stars() {
    let starsArray = [];
    for (let i = 1; i <= this.maxRating; i++) {
      let type: StarType;
      if (this.rating >= i) {
        type = 'full';
      } else if (this.rating < i && this.rating > i - 1) {
        type = 'half';
      } else {
        type = 'empty';
      }
      starsArray.push({ rating: i, type });
    }
    return starsArray;
  }

  <template>
    <span
      class='star-rating'
      aria-label='Rating is {{this.rating}} out of {{this.maxRating}}'
      ...attributes
    >
      {{#each this.stars as |star|}}
        {{#if @isEditable}}
          <button
            class={{cn
              'star-button'
              (if star.full this.fullClassNames)
              (if star.halfFull this.halfFullClassNames)
              (if
                (and (not star.full) (not star.halfFull)) this.emptyClassNames
              )
            }}
            {{on 'click' (fn this.toggleStar star)}}
          >
            <StarIcon @type={{star.type}} />
          </button>
        {{else}}
          <StarIcon class='star-icon' @type={{star.type}} />
        {{/if}}
      {{/each}}
    </span>
    <style scoped>
      .star-rating {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .star-button {
        color: currentColor;
        border: 0;
        background: none;
        padding: 0;
      }
      .star-icon {
        min-width: 12px;
      }
    </style>
  </template>

  @action toggleStar(star: Star) {
    /* can only toggle full or empty */
    if (star.type === 'full' || star.type === 'half') {
      star.type = 'empty';
    } else {
      star.type = 'full';
    }
  }
}

export class RatingsSummary extends FieldDef {
  static displayName = 'Ratings Summary';
  @field average = contains(NumberField);
  @field count = contains(NumberField);

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='rating-summary'>
        <StarRating @value={{@model.average}} />
        {{#if @model.average}}
          <span class='rating'>
            <@fields.average />
          </span>
        {{/if}}
        {{#if @model.count}}
          <span class='review-count'>
            ({{formatNumber @model.count}})
          </span>
        {{/if}}
      </span>
      <style scoped>
        .rating-summary {
          height: 100%;
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          color: currentColor;
        }
      </style>
    </template>
  };

  static embedded = this.atom;
}
