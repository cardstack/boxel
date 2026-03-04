import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';

import ChefHat from '@cardstack/boxel-icons/chef-hat';
import ClockIcon from '@cardstack/boxel-icons/clock';
import ListIcon from '@cardstack/boxel-icons/list';
import FlameIcon from '@cardstack/boxel-icons/flame';
import UsersIcon from '@cardstack/boxel-icons/users';
import StarIcon from '@cardstack/boxel-icons/star';
import TagIcon from '@cardstack/boxel-icons/tag';
import LayersIcon from '@cardstack/boxel-icons/layers';

import { FieldContainer, Pill } from '@cardstack/boxel-ui/components';
import { or } from '@cardstack/boxel-ui/helpers';

function generateArray(count: number): number[] {
  if (!Number.isInteger(count) || count < 0) {
    console.error('count must be a non-negative integer');
    return [];
  }

  return Array.from({ length: count }, (_, i) => i);
}

// Bon Appétit × NYT Cooking inspired recipe card - warm editorial, appetizing, personal
export class Recipe extends CardDef {
  static displayName = 'Recipe';
  static icon = ChefHat;

  @field title = contains(StringField);
  @field subtitle = contains(StringField);
  @field prepTime = contains(NumberField);
  @field cookTime = contains(NumberField);
  @field servings = contains(NumberField);
  @field difficulty = contains(StringField);
  @field cuisine = contains(StringField);
  @field calories = contains(NumberField);
  @field rating = contains(NumberField);
  @field reviews = contains(NumberField);
  @field author = contains(StringField);
  @field keyIngredient = contains(StringField);
  @field imageUrl = contains(StringField);
  @field description = contains(TextAreaField);
  @field ingredients = contains(MarkdownField);
  @field instructions = contains(MarkdownField);

  static fitted = class Fitted extends Component<typeof this> {
    get totalTime() {
      return (this.args.model.prepTime || 0) + (this.args.model.cookTime || 0);
    }

    <template>
      <article class='recipe-fitted'>
        <div class='image-col'>
          {{#if @model.imageUrl}}
            <img
              class='recipe-image'
              src={{@model.imageUrl}}
              alt={{if @model.title @model.title 'Recipe'}}
            />
          {{else}}
            <div class='image-placeholder'>
              <ChefHat class='placeholder-icon' />
            </div>
          {{/if}}
        </div>

        <div class='content-col'>
          {{#if @model.cuisine}}
            <Pill
              @size='extra-small'
              @variant='primary'
              class='cuisine-badge'
            ><@fields.cuisine /></Pill>
          {{/if}}
          <div class='header-row'>
            <h3 class='recipe-title'><@fields.title /></h3>
          </div>

          {{#if @model.subtitle}}
            <p class='recipe-subtitle'><@fields.subtitle /></p>
          {{/if}}

          <div class='stats-row'>
            {{#if this.totalTime}}
              <div class='stat'>
                <ClockIcon class='stat-icon' />
                <span>{{this.totalTime}} min</span>
              </div>
            {{/if}}
            {{#if @model.servings}}
              <div class='stat'>
                <UsersIcon class='stat-icon' />
                <span><@fields.servings /> servings</span>
              </div>
            {{/if}}
            {{#if @model.difficulty}}
              <div class='stat'>
                <FlameIcon class='stat-icon' />
                <span><@fields.difficulty /></span>
              </div>
            {{/if}}
          </div>
        </div>
      </article>

      <style scoped>
        .recipe-fitted {
          width: 100%;
          height: 100%;
          overflow: hidden;
          display: grid;
          grid-template-columns: max-content 1fr;
          grid-template-areas: 'img content';
        }

        .image-col {
          grid-area: img;
          width: 40cqh;
          min-width: 60px;
          max-width: 200px;
          overflow: hidden;
          background: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .recipe-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .image-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--muted), var(--accent));
        }

        .placeholder-icon {
          width: 28px;
          height: 28px;
          color: var(--muted-foreground);
          opacity: 0.6;
        }

        .content-col {
          grid-area: content;
          padding: var(--boxel-sp-2xs);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          overflow: hidden;
          min-width: 0;
        }

        .header-row {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }

        .recipe-title {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size);
          font-weight: 600;
          color: var(--foreground);
          margin: 0;
          line-height: 1.25;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          flex: 1;
          min-width: 0;
        }

        .cuisine-badge {
          position: absolute;
          top: var(--boxel-sp-xs);
          right: var(--boxel-sp-xs);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          white-space: nowrap;
        }

        .recipe-subtitle {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          margin: 0;
          line-height: 1.4;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .stats-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          margin-top: auto;
        }

        .stat {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          white-space: nowrap;
        }

        .stat-icon {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
        }

        /* Tiny: strip layout — hide image, show title only */
        @container fitted-card (height < 65px) {
          .recipe-fitted {
            grid-template-columns: 1fr;
            grid-template-areas: 'content';
            align-items: center;
          }

          .image-col {
            display: none;
          }

          .content-col {
            justify-content: center;
            padding: 0 var(--boxel-sp-2xs);
          }

          .recipe-title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size-sm);
          }

          .recipe-subtitle,
          .stats-row {
            display: none;
          }
        }

        /* Small height — show title + time stat only */
        @container fitted-card ((65px <= height) and (height < 115px)) {
          .recipe-subtitle {
            display: none;
          }

          .stat:not(:first-child) {
            display: none;
          }
        }

        /* Vertical / square — stack image on top */
        @container fitted-card (aspect-ratio <= 1.0) {
          .recipe-fitted {
            grid-template-columns: 1fr;
            grid-template-rows: 1fr max-content;
            grid-template-areas:
              'img'
              'content';
          }

          .image-col {
            width: 100%;
            max-width: 100%;
            height: 100%;
          }

          .content-col {
            padding: var(--boxel-sp-2xs);
          }
        }

        @container fitted-card ((aspect-ratio <= 1.0) and (height < 150px)) {
          .image-col {
            display: none;
          }

          .recipe-fitted {
            grid-template-rows: 1fr;
            grid-template-areas: 'content';
          }
        }

        @container fitted-card ((aspect-ratio > 1.0) and (width >= 400px) and (height >= 65px)) {
          .image-col {
            width: 50cqw;
          }
          .cuisine-badge {
            left: var(--boxel-sp-xs);
            right: auto;
          }
        }

        @container fitted-card ((aspect-ratio > 1.0) and (width <= 150px) and (height <= 105px)) {
          .cuisine-badge {
            display: none;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get totalTime() {
      return (this.args.model.prepTime || 0) + (this.args.model.cookTime || 0);
    }

    <template>
      <article class='recipe-embedded'>
        <div class='image-col'>
          {{#if @model.imageUrl}}
            <img
              class='recipe-image'
              src={{@model.imageUrl}}
              alt={{if @model.title @model.title 'Recipe'}}
            />
          {{else}}
            <div class='image-placeholder'>
              <ChefHat class='placeholder-icon' />
            </div>
          {{/if}}
        </div>

        <div class='content-col'>
          <div class='title-row'>
            <h3 class='recipe-title'><@fields.title /></h3>
            {{#if @model.cuisine}}
              <span class='cuisine-badge'><@fields.cuisine /></span>
            {{/if}}
          </div>

          {{#if @model.subtitle}}
            <p class='recipe-subtitle'><@fields.subtitle /></p>
          {{/if}}

          <div class='meta-row'>
            {{#if this.totalTime}}
              <div class='meta-item'>
                <ClockIcon class='meta-icon' />
                <span>{{this.totalTime}} min</span>
              </div>
            {{/if}}
            {{#if @model.servings}}
              <div class='meta-item'>
                <UsersIcon class='meta-icon' />
                <span><@fields.servings /> servings</span>
              </div>
            {{/if}}
            {{#if @model.difficulty}}
              <div class='meta-item'>
                <FlameIcon class='meta-icon' />
                <span><@fields.difficulty /></span>
              </div>
            {{/if}}
            {{#if @model.author}}
              <div class='meta-item meta-author'>
                <span>By <@fields.author /></span>
              </div>
            {{/if}}
          </div>

          {{#if @model.description}}
            <p class='recipe-description'><@fields.description /></p>
          {{/if}}
        </div>
      </article>

      <style scoped>
        .recipe-embedded {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: var(--boxel-sp);
          width: 100%;
          overflow: hidden;
          background: var(--card);
          border-radius: var(--radius);
          border: 1px solid var(--border);
        }

        .image-col {
          overflow: hidden;
          border-radius: var(--radius) 0 0 var(--radius);
          background: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1 / 1;
        }

        .recipe-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .image-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--muted), var(--accent));
        }

        .placeholder-icon {
          width: var(--boxel-icon-lg);
          height: var(--boxel-icon-lg);
          color: var(--muted-foreground);
          opacity: 0.4;
        }

        .content-col {
          padding: var(--boxel-sp-sm) var(--boxel-sp-sm) var(--boxel-sp-sm) 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          min-width: 0;
          overflow: hidden;
        }

        .title-row {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }

        .recipe-title {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size);
          font-weight: 600;
          color: var(--foreground);
          margin: 0;
          line-height: 1.3;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          flex: 1;
          min-width: 0;
        }

        .cuisine-badge {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--primary-foreground);
          background: var(--primary);
          padding: 2px var(--boxel-sp-4xs);
          border-radius: var(--boxel-border-radius-xs);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          white-space: nowrap;
          align-self: flex-start;
        }

        .recipe-subtitle {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          margin: 0;
          line-height: 1.4;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          align-items: center;
        }

        .meta-item {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          white-space: nowrap;
        }

        .meta-icon {
          width: var(--boxel-icon-2xs);
          height: var(--boxel-icon-2xs);
          flex-shrink: 0;
        }

        .meta-author {
          margin-left: auto;
          font-style: italic;
        }

        .recipe-description {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          margin: 0;
          line-height: 1.5;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .recipe-description :deep(*) {
          all: unset;
          display: inline;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          line-height: 1.5;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    get totalTime() {
      return (this.args.model.prepTime || 0) + (this.args.model.cookTime || 0);
    }

    get difficultyLabel() {
      const d = this.args.model.difficulty?.toLowerCase() || 'easy';
      return d.charAt(0).toUpperCase() + d.slice(1);
    }

    get ratingStars() {
      return Math.round(this.args.model.rating || 0);
    }

    get authorInitial() {
      return (this.args.model.author || 'A')[0].toUpperCase();
    }

    isStarFilled = (index: number) => {
      return index < this.ratingStars;
    };

    <template>
      <div class='recipe-isolated'>
        <div class='hero-section'>
          {{#if @model.imageUrl}}
            <img
              class='hero-image'
              src={{@model.imageUrl}}
              alt={{if @model.title @model.title 'Recipe image'}}
            />
          {{else}}
            <div class='hero-placeholder'>
              <ChefHat class='hero-placeholder-icon' />
            </div>
          {{/if}}

          {{#if @model.cuisine}}
            <div class='cuisine-badge'><@fields.cuisine /></div>
          {{/if}}
        </div>

        <div class='content-wrapper'>
          <header class='recipe-header'>
            <h1 class='recipe-title'><@fields.title /></h1>
            {{#if @model.subtitle}}
              <p class='recipe-subtitle'><@fields.subtitle /></p>
            {{/if}}

            <div class='meta-bar'>
              {{#if @model.author}}
                <div class='author-chip'>
                  <div class='author-avatar'>{{this.authorInitial}}</div>
                  <span class='author-name'>By <@fields.author /></span>
                </div>
              {{/if}}

              {{#if @model.rating}}
                <div class='rating-display'>
                  <div class='stars-large'>
                    {{#each (generateArray 5) as |index|}}
                      <span
                        class='star {{if (this.isStarFilled index) "filled"}}'
                      >★</span>
                    {{/each}}
                  </div>
                  {{#if @model.reviews}}
                    <span class='review-text'><@fields.reviews /> reviews</span>
                  {{/if}}
                </div>
              {{/if}}
            </div>
          </header>

          <div class='stats-grid'>
            {{#if this.totalTime}}
              <FieldContainer
                @label='Total Time'
                @tag='div'
                @vertical={{true}}
                class='stat-card'
              >
                <div class='stat-content'>
                  <ClockIcon class='stat-icon' />
                  <div class='stat-value'>{{this.totalTime}} min</div>
                </div>
              </FieldContainer>
            {{/if}}

            {{#if @model.prepTime}}
              <FieldContainer
                @label='Prep Time'
                @tag='div'
                @vertical={{true}}
                class='stat-card'
              >
                <div class='stat-content'>
                  <ListIcon class='stat-icon' />
                  <div class='stat-value'><@fields.prepTime /> min</div>
                </div>
              </FieldContainer>
            {{/if}}

            {{#if @model.cookTime}}
              <FieldContainer
                @label='Cook Time'
                @tag='div'
                @vertical={{true}}
                class='stat-card'
              >
                <div class='stat-content'>
                  <FlameIcon class='stat-icon' />
                  <div class='stat-value'><@fields.cookTime /> min</div>
                </div>
              </FieldContainer>
            {{/if}}

            {{#if @model.servings}}
              <FieldContainer
                @label='Servings'
                @tag='div'
                @vertical={{true}}
                class='stat-card'
              >
                <div class='stat-content'>
                  <UsersIcon class='stat-icon' />
                  <div class='stat-value'><@fields.servings /></div>
                </div>
              </FieldContainer>
            {{/if}}

            {{#if @model.difficulty}}
              <FieldContainer
                @label='Difficulty'
                @tag='div'
                @vertical={{true}}
                class='stat-card'
              >
                <div class='stat-content'>
                  <StarIcon class='stat-icon' />
                  <div class='stat-value'>{{this.difficultyLabel}}</div>
                </div>
              </FieldContainer>
            {{/if}}

            {{#if @model.calories}}
              <FieldContainer
                @label='Calories/Serving'
                @tag='div'
                @vertical={{true}}
                class='stat-card'
              >
                <div class='stat-content'>
                  <TagIcon class='stat-icon' />
                  <div class='stat-value'><@fields.calories /></div>
                </div>
              </FieldContainer>
            {{/if}}
          </div>

          {{#if @model.keyIngredient}}
            <div class='highlight-section'>
              <LayersIcon class='highlight-icon' />
              <div class='highlight-content'>
                <div class='highlight-label'>Key Ingredient</div>
                <div class='highlight-value'><@fields.keyIngredient /></div>
              </div>
            </div>
          {{/if}}

          <div class='recipe-body'>
            {{#if @model.description}}
              <div class='section'>
                <h2>About This Recipe</h2>
                <div class='description-content'>
                  <@fields.description />
                </div>
              </div>
            {{/if}}

            {{#if @model.ingredients}}
              <div class='section'>
                <h2>Ingredients</h2>
                <div class='ingredients-content'>
                  <@fields.ingredients />
                </div>
              </div>
            {{/if}}

            {{#if @model.instructions}}
              <div class='section'>
                <h2>Instructions</h2>
                <div class='instructions-content'>
                  <@fields.instructions />
                </div>
              </div>
            {{/if}}

            {{#unless
              (or @model.description @model.ingredients @model.instructions)
            }}
              <div class='placeholder-content'>
                <h2>About This Recipe</h2>
                <p class='placeholder-hint'>Add a description in edit mode</p>

                <h3>Ingredients</h3>
                <p class='placeholder-hint'>Add ingredients in edit mode</p>

                <h3>Instructions</h3>
                <p class='placeholder-hint'>Add step-by-step instructions in
                  edit mode</p>
              </div>
            {{/unless}}
          </div>
        </div>
      </div>

      <style scoped>
        .recipe-isolated {
          width: 100%;
          max-width: 52rem;
          margin: 0 auto;
          background: var(--muted);
          height: 100%;
          overflow-y: auto;
          font-family: var(--font-sans);
        }

        .hero-section {
          width: 100%;
          height: clamp(280px, 40vh, 420px);
          position: relative;
          background: linear-gradient(
            180deg,
            var(--muted) 0%,
            var(--accent) 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .hero-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .hero-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .hero-placeholder-icon {
          width: 64px;
          height: 64px;
          color: var(--muted-foreground);
          opacity: 0.4;
        }

        .cuisine-badge {
          position: absolute;
          top: var(--boxel-sp-lg);
          left: var(--boxel-sp-lg);
          background: var(--primary);
          color: var(--primary-foreground);
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-xs);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-lg);
          backdrop-filter: blur(8px);
        }

        .content-wrapper {
          padding: clamp(var(--boxel-sp-lg), 5vw, var(--boxel-sp-xxxl));
        }

        .recipe-header {
          margin-bottom: var(--boxel-sp-xl);
          padding-bottom: var(--boxel-sp-xl);
          border-bottom: 1px solid var(--border);
        }

        .recipe-title {
          font-family: var(--font-serif);
          font-size: var(--boxel-heading-font-size);
          font-weight: 400;
          color: var(--foreground);
          margin: 0 0 var(--boxel-sp-sm) 0;
          line-height: 1.2;
          letter-spacing: var(--boxel-lsp-xs);
        }

        .recipe-subtitle {
          font-size: var(--boxel-font-size-lg);
          color: var(--muted-foreground);
          margin: 0 0 var(--boxel-sp-lg) 0;
          line-height: 1.5;
        }

        .meta-bar {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          align-items: center;
        }

        .author-chip {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-4xs) var(--boxel-sp-sm) var(--boxel-sp-4xs)
            var(--boxel-sp-4xs);
          background: var(--card);
          border-radius: var(--radius);
          border: 1px solid var(--border);
        }

        .author-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--primary);
          color: var(--primary-foreground);
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .author-name {
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground);
          font-weight: 500;
        }

        .rating-display {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }

        .stars-large {
          display: flex;
          gap: var(--boxel-sp-6xs);
        }

        .stars-large .star {
          font-size: var(--boxel-font-size-lg);
          color: var(--muted);
        }

        .stars-large .star.filled {
          color: var(--accent);
        }

        .review-text {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-xl);
        }

        .stat-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: var(--boxel-sp);
          min-width: 0;
        }

        .stat-content {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          min-width: 0;
        }

        .stat-icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          color: var(--muted-foreground);
          flex-shrink: 0;
        }

        .stat-value {
          font-size: var(--boxel-font-size);
          font-weight: 600;
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          word-break: break-word;
          flex: 1;
          min-width: 0;
        }

        .highlight-section {
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius);
          padding: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-xl);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
        }

        .highlight-icon {
          width: var(--boxel-icon-med);
          height: var(--boxel-icon-med);
          color: var(--accent-foreground);
          flex-shrink: 0;
        }

        .highlight-content {
          flex: 1;
          min-width: 0;
        }

        .highlight-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--accent-foreground);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-lg);
          margin-bottom: var(--boxel-sp-5xs);
          opacity: 0.8;
        }

        .highlight-value {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-lg);
          font-weight: 500;
          color: var(--accent-foreground);
          overflow-wrap: break-word;
        }

        .recipe-body {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: clamp(var(--boxel-sp), 4vw, var(--boxel-sp-2xl));
        }

        .placeholder-content h2 {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-xl);
          font-weight: 400;
          color: var(--foreground);
          margin: 0 0 var(--boxel-sp) 0;
        }

        .placeholder-content h3 {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-lg);
          font-weight: 500;
          color: var(--foreground);
          margin: var(--boxel-sp-lg) 0 var(--boxel-sp-sm) 0;
        }

        .placeholder-content p {
          font-size: var(--boxel-font-size);
          color: var(--muted-foreground);
          line-height: 1.6;
          margin: 0 0 var(--boxel-sp) 0;
        }

        .placeholder-content ul,
        .placeholder-content ol {
          margin: 0 0 var(--boxel-sp) 0;
          padding-left: var(--boxel-sp-lg);
        }

        .placeholder-content li {
          font-size: var(--boxel-font-size);
          color: var(--muted-foreground);
          line-height: 1.6;
          margin-bottom: var(--boxel-sp-xs);
        }

        .placeholder-hint {
          font-style: italic;
          opacity: 0.7;
        }

        .section {
          margin-bottom: var(--boxel-sp-xl);
        }

        .section:last-child {
          margin-bottom: 0;
        }

        .section h2 {
          font-family: var(--font-serif);
          font-size: var(--boxel-font-size-xl);
          font-weight: 400;
          color: var(--foreground);
          margin: 0 0 var(--boxel-sp) 0;
        }

        .description-content,
        .ingredients-content,
        .instructions-content {
          font-size: var(--boxel-font-size);
          color: var(--foreground);
          line-height: 1.6;
        }

        .description-content :deep(*) {
          all: unset;
          display: block;
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size);
          color: var(--foreground);
          line-height: 1.6;
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        .ingredients-content :deep(ul),
        .instructions-content :deep(ol) {
          margin: 0;
          padding-left: var(--boxel-sp-lg);
        }

        .ingredients-content :deep(li),
        .instructions-content :deep(li) {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size);
          color: var(--foreground);
          line-height: 1.6;
          margin-bottom: var(--boxel-sp-xs);
        }

        .instructions-content :deep(p) {
          font-family: var(--font-sans);
          font-size: var(--boxel-font-size);
          color: var(--foreground);
          line-height: 1.6;
          margin-bottom: var(--boxel-sp);
        }

        @media (max-width: 640px) {
          .content-wrapper {
            padding: var(--boxel-sp-lg);
          }

          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .meta-bar {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };
}
