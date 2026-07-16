// Pattern example: editable star-rating FieldDef.
import { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { Star, StarHalfFill, StarFilled } from '@cardstack/boxel-ui/icons';

type StarType = 'full' | 'half' | 'empty';

interface StarIconSignature {
  Args: { type: StarType };
  Element: HTMLElement;
}

const StarIcon: TemplateOnlyComponent<StarIconSignature> = <template>
  {{#if (eq @type 'full')}}
    <StarFilled width='14' height='14' ...attributes />
  {{else if (eq @type 'half')}}
    <StarHalfFill width='14' height='14' ...attributes />
  {{else}}
    <Star width='14' height='14' ...attributes />
  {{/if}}
</template>;

interface StarItem {
  rating: number;
  type: StarType;
}

interface StarRatingSignature {
  Args: {
    value?: number;
    isEditable?: boolean;
    // eslint-disable-next-line no-unused-vars
    set?: (value: RatingsSummary) => void;
  };
  Element: HTMLElement;
}

class StarRating extends GlimmerComponent<StarRatingSignature> {
  maxRating = 5;

  get rating() {
    return this.args.value ?? 0;
  }

  get stars(): StarItem[] {
    let stars: StarItem[] = [];
    for (let i = 1; i <= this.maxRating; i++) {
      let type: StarType = 'empty';
      if (this.rating >= i) {
        type = 'full';
      } else if (this.rating > i - 1) {
        type = 'half';
      }
      stars.push({ rating: i, type });
    }
    return stars;
  }

  @action changeRating(star: StarItem) {
    if (!this.args.set) {
      return;
    }

    let average =
      star.type === 'full' && star.rating === this.rating ? 0 : star.rating;

    this.args.set(
      new RatingsSummary({
        average,
        count: null,
        isEditable: true,
      }),
    );
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
            type='button'
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
        gap: 0.125rem;
        color: currentColor;
      }

      .star-rating.editable {
        gap: 0;
      }

      .star-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.125rem;
        border: 0;
        background: transparent;
        color: currentColor;
        cursor: pointer;
      }

      .star-button-empty {
        color: var(--muted-foreground, #8b95a3);
      }

      .star-button-empty:hover {
        color: var(--foreground, #111827);
      }

      .star-rating:has(.star-button-empty:hover) {
        --icon-stroke-color: currentColor;
      }

      .star-button-empty:hover ~ .star-button {
        --icon-fill-color: none;
        --icon-stroke-color: var(--muted-foreground, #8b95a3);
      }

      .star-button-full:hover ~ .star-button-full {
        --icon-fill-color: none;
        --icon-stroke-color: currentColor;
      }
    </style>
  </template>
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
          <strong>{{@model.average}}</strong>
        {{/if}}
        {{#if @model.count}}
          <span class='count'>({{@model.count}})</span>
        {{/if}}
      </span>

      <style scoped>
        .rating-summary {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
        }

        .count {
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.average}}
        <span class='rating-atom'>
          <StarIcon @type='full' width='10' height='10' />
          {{@model.average}}
        </span>
      {{/if}}
    </template>
  };
}

export class ReviewCard extends CardDef {
  static displayName = 'Review';

  @field title = contains(StringField);
  @field rating = contains(RatingsSummary);

  static isolated = class Isolated extends Component<typeof ReviewCard> {
    <template>
      <article class='review'>
        <h1>{{@model.title}}</h1>
        <@fields.rating @format='embedded' />
      </article>
    </template>
  };
}
