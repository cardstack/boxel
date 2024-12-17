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
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';

import { cn, eq } from '@cardstack/boxel-ui/helpers';
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

interface StarItem {
  rating: number;
  type: StarType;
}

interface StarRatingSignature {
  Args: {
    value: number | undefined;
    isEditable?: boolean;
    set: (value: RatingsSummary) => void;
  };
  Element: HTMLElement;
}
export class StarRating extends GlimmerComponent<StarRatingSignature> {
  maxRating = 5;

  get rating() {
    return this.args.value ?? 0;
  }

  get stars(): StarItem[] {
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
      class={{cn 'star-rating' editable=@isEditable}}
      aria-label='Rating is {{this.rating}} out of {{this.maxRating}}'
      ...attributes
    >
      {{#each this.stars as |star|}}
        {{#if @isEditable}}
          <button
            class={{cn
              'star-button'
              star-button-full=(eq star.type 'full')
              star-button-empty=(eq star.type 'empty')
            }}
            {{on 'click' (fn this.changeRating star)}}
          >
            <StarIcon class='star-icon' @type={{star.type}} />
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
      .star-rating.editable {
        gap: 0;
      }
      .star-button:first-child {
        padding-left: 0;
      }
      .star-button:last-child {
        padding-right: 0;
      }
      .star-button {
        color: currentColor;
        border: 0;
        background: none;
        padding: 2px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .star-icon {
        min-width: 12px;
      }
      .star-button-empty {
        color: gray;
      }
      .star-button-empty:hover {
        color: black;
      }
      .star-rating:has(.star-button-empty:hover) {
        --icon-stroke-color: black;
      }
      .star-button-empty:hover ~ .star-button {
        --icon-fill-color: none;
        --icon-stroke-color: gray;
      }
      .star-button-full {
        color: black;
      }
      .star-button-full:hover ~ .star-button-full {
        --icon-fill-color: none;
        --icon-stroke-color: black;
      }
    </style>
  </template>

  @action changeRating(star: StarItem) {
    if (star.type === 'full' && star.rating === this.rating) {
      this.args.set(
        new RatingsSummary({ average: 0, count: null, isEditable: true }),
      );
      return;
    }

    /* can only set full values */
    this.args.set(
      new RatingsSummary({
        average: star.rating,
        count: null,
        isEditable: true,
      }),
    );
  }
}

export class RatingsSummary extends FieldDef {
  static displayName = 'Ratings Summary';
  @field average = contains(NumberField);
  @field count = contains(NumberField);
  @field isEditable = contains(BooleanField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='rating-summary'>
        <StarRating
          @value={{@model.average}}
          @isEditable={{@model.isEditable}}
          @set={{@set}}
        />
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

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.average}}
        <span class='rating-summary'>
          <StarIcon class='icon' @type='full' width='10' height='10' />
          <span class='rating'><@fields.average /></span>
        </span>
      {{/if}}
      <style scoped>
        .rating-summary {
          height: 100%;
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
          color: currentColor;
        }
        .icon {
          flex-shrink: 0;
        }
        .rating {
          font: 600 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
      </style>
    </template>
  };
}
