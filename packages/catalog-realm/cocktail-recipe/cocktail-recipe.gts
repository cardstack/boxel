import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { IngredientField } from './fields/ingredient-field';
import { GarnishField } from './fields/garnish-field';
import GlassIcon from '@cardstack/boxel-icons/wine';
import { gt } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';

export class CocktailRecipe extends CardDef {
  static displayName = 'Cocktail Recipe';
  static icon = GlassIcon;
  static prefersWideFormat = true;

  @field cocktailName = contains(StringField);
  @field description = contains(TextAreaField);
  @field difficulty = contains(StringField);
  @field preparationTime = contains(NumberField);
  @field glassType = contains(StringField);
  @field ingredients = containsMany(IngredientField);
  @field garnish = contains(GarnishField);
  @field instructions = contains(TextAreaField);
  @field bartenderNotes = contains(TextAreaField);
  @field origin = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: CocktailRecipe) {
      return this.cocktailName ?? 'Unnamed Cocktail';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='speakeasy-stage'>
        <div class='recipe-mat'>
          <header class='cocktail-header'>
            {{#if @model.thumbnailURL}}
              <div class='cocktail-hero'>
                <img
                  src={{@model.thumbnailURL}}
                  alt={{if
                    @model.cocktailName
                    (concat @model.cocktailName ' cocktail')
                    'Cocktail image'
                  }}
                  class='hero-image'
                />
                <div class='hero-overlay'>
                  <h1 class='cocktail-title'>{{if
                      @model.cocktailName
                      @model.cocktailName
                      'Unnamed Cocktail'
                    }}</h1>
                </div>
              </div>
            {{else}}
              <div class='title-section'>
                <h1 class='cocktail-title'>{{if
                    @model.cocktailName
                    @model.cocktailName
                    'Unnamed Cocktail'
                  }}</h1>
              </div>
            {{/if}}

            <div class='cocktail-meta'>
              {{#if @model.difficulty}}
                <span
                  class='difficulty-badge {{@model.difficulty}}'
                >{{@model.difficulty}}</span>
              {{/if}}
              {{#if @model.preparationTime}}
                <span class='time-badge'>⏱
                  {{@model.preparationTime}}
                  min</span>
              {{/if}}
              {{#if @model.glassType}}
                <span class='glass-badge'>🍸 {{@model.glassType}}</span>
              {{/if}}
            </div>

            {{#if @model.origin}}
              <div class='origin-section'>
                <span class='origin-label'>Origin:</span>
                <span class='origin-text'>{{@model.origin}}</span>
              </div>
            {{/if}}
          </header>

          {{#if @model.description}}
            <div class='description-section'>
              <@fields.description />
            </div>
          {{else}}
            <div class='description-placeholder'>
              <em>A mysterious cocktail awaiting its story...</em>
            </div>
          {{/if}}

          <div class='recipe-content'>
            <section class='ingredients-section'>
              <h2 class='section-title'>🍾 Ingredients</h2>
              {{#if (gt @model.ingredients.length 0)}}
                <div class='ingredients-list'>
                  <@fields.ingredients @format='embedded' />
                </div>
              {{else}}
                <div class='empty-ingredients'>
                  <p>No ingredients listed yet. What makes this cocktail
                    special?</p>
                </div>
              {{/if}}
            </section>

            <section class='instructions-section'>
              <h2 class='section-title'>🥃 Preparation</h2>
              {{#if @model.instructions}}
                <div class='instructions-content'>
                  <@fields.instructions />
                </div>
              {{else}}
                <div class='instructions-placeholder'>
                  <p>Preparation method awaits the master bartender's touch...</p>
                </div>
              {{/if}}
            </section>

            {{#if @model.garnish}}
              <section class='garnish-section'>
                <h2 class='section-title'>🍋 Finishing Touch</h2>
                <@fields.garnish @format='embedded' />
              </section>
            {{/if}}

            {{#if @model.bartenderNotes}}
              <section class='notes-section'>
                <h2 class='section-title'>💭 Bartender's Notes</h2>
                <div class='notes-content'>
                  <@fields.bartenderNotes />
                </div>
              </section>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .speakeasy-stage {
          width: 100%;
          height: 100%;
          background: radial-gradient(
            ellipse at top,
            #0d1b2a 0%,
            #1b3a4b 35%,
            #0f172a 100%
          );
          background-attachment: fixed;
          padding: 3rem;
          overflow-y: auto;
          font-family: 'Playfair Display', 'Times New Roman', serif;
          position: relative;
        }

        .speakeasy-stage::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image:
            radial-gradient(
              circle at 25% 25%,
              rgba(139, 69, 19, 0.1) 0%,
              transparent 25%
            ),
            radial-gradient(
              circle at 75% 75%,
              rgba(184, 134, 11, 0.08) 0%,
              transparent 25%
            );
          pointer-events: none;
        }

        .recipe-mat {
          max-width: 52rem;
          margin: 0 auto;
          background: linear-gradient(
            145deg,
            rgba(20, 30, 48, 0.95) 0%,
            rgba(30, 41, 59, 0.92) 50%,
            rgba(15, 23, 42, 0.95) 100%
          );
          border: 3px solid transparent;
          background-clip: padding-box;
          border-radius: 16px;
          box-shadow:
            0 25px 50px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(184, 134, 11, 0.3),
            inset 0 1px 2px rgba(255, 255, 255, 0.1),
            inset 0 -1px 2px rgba(0, 0, 0, 0.3);
          padding: 3.5rem;
          color: #f8fafc;
          position: relative;
          overflow: hidden;
        }

        .recipe-mat::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background:
            linear-gradient(
              45deg,
              transparent 48%,
              rgba(184, 134, 11, 0.05) 49%,
              rgba(184, 134, 11, 0.05) 51%,
              transparent 52%
            ),
            linear-gradient(
              -45deg,
              transparent 48%,
              rgba(139, 69, 19, 0.03) 49%,
              rgba(139, 69, 19, 0.03) 51%,
              transparent 52%
            );
          background-size: 20px 20px;
          pointer-events: none;
          opacity: 0.4;
        }

        .cocktail-header {
          border-bottom: 2px solid transparent;
          background: linear-gradient(
            90deg,
            rgba(184, 134, 11, 0.3) 0%,
            rgba(139, 69, 19, 0.5) 50%,
            rgba(184, 134, 11, 0.3) 100%
          );
          background-size: 100% 2px;
          background-position: bottom;
          background-repeat: no-repeat;
          padding-bottom: 2rem;
          margin-bottom: 2.5rem;
          position: relative;
        }

        .cocktail-title {
          font-size: 3.2rem;
          font-weight: 700;
          background: linear-gradient(
            135deg,
            #f7e68c 0%,
            #b8860b 40%,
            #8b4513 70%,
            #daa520 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 0 0 1.2rem 0;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          letter-spacing: 1px;
          text-align: center;
          font-family: 'Playfair Display', serif;
          position: relative;
        }

        .hero-image {
          width: 100%;
          height: auto;
          max-height: 400px;
          object-fit: cover;
          border-radius: 12px 12px 0 0;
        }

        .hero-overlay .cocktail-title {
          background: linear-gradient(
            135deg,
            #ffffff 0%,
            #f7e68c 40%,
            #daa520 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-align: left;
        }

        .cocktail-title::after {
          content: '✦';
          position: absolute;
          top: -0.5rem;
          right: -1rem;
          font-size: 1.5rem;
          color: #daa520;
          opacity: 0.7;
        }

        .cocktail-meta {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }

        .difficulty-badge,
        .time-badge,
        .glass-badge {
          padding: 0.5rem 1.2rem;
          border-radius: 25px;
          font-size: 0.85rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 1px;
          position: relative;
          box-shadow:
            0 4px 12px rgba(0, 0, 0, 0.3),
            inset 0 1px 2px rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          font-family: 'Playfair Display', serif;
        }

        .difficulty-badge.easy {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #ecfdf5;
        }

        .difficulty-badge.medium {
          background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: #fffbeb;
        }

        .difficulty-badge.hard {
          background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fef2f2;
        }

        .time-badge,
        .glass-badge {
          background: linear-gradient(
            135deg,
            rgba(184, 134, 11, 0.3) 0%,
            rgba(139, 69, 19, 0.2) 100%
          );
          color: #f7e68c;
          border: 1px solid rgba(184, 134, 11, 0.4);
          backdrop-filter: blur(15px);
        }

        .origin-section {
          margin-top: 1.5rem;
          padding: 1.5rem;
          background: linear-gradient(
            135deg,
            rgba(184, 134, 11, 0.15) 0%,
            rgba(139, 69, 19, 0.1) 100%
          );
          border: 1px solid rgba(184, 134, 11, 0.3);
          border-left: 4px solid #b8860b;
          border-radius: 8px;
          position: relative;
          box-shadow:
            0 4px 12px rgba(0, 0, 0, 0.2),
            inset 0 1px 2px rgba(255, 255, 255, 0.05);
        }

        .origin-section::before {
          content: '❈';
          position: absolute;
          top: -0.5rem;
          left: 1rem;
          background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
          color: #daa520;
          padding: 0.3rem 0.6rem;
          border-radius: 50%;
          font-size: 0.8rem;
        }

        .origin-label {
          font-weight: 600;
          color: #f7e68c;
          margin-right: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-size: 0.9rem;
        }

        .origin-text {
          color: #e2e8f0;
          font-style: italic;
          line-height: 1.6;
          font-family: 'Playfair Display', serif;
        }

        .description-section,
        .description-placeholder {
          margin-bottom: 2rem;
          padding: 1rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          line-height: 1.6;
        }

        .description-placeholder {
          color: #888;
          text-align: center;
          font-style: italic;
        }

        .recipe-content {
          display: grid;
          gap: 2rem;
        }

        .section-title {
          font-size: 1.6rem;
          background: linear-gradient(
            135deg,
            #f7e68c 0%,
            #daa520 50%,
            #b8860b 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 0 0 1.5rem 0;
          font-weight: 600;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          font-family: 'Playfair Display', serif;
          letter-spacing: 0.5px;
          position: relative;
          text-align: center;
        }

        .section-title::before {
          content: '';
          position: absolute;
          bottom: -0.5rem;
          left: 50%;
          transform: translateX(-50%);
          width: 3rem;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            #b8860b 50%,
            transparent 100%
          );
        }

        .ingredients-section,
        .instructions-section,
        .garnish-section,
        .notes-section {
          background: linear-gradient(
            135deg,
            rgba(30, 41, 59, 0.4) 0%,
            rgba(15, 23, 42, 0.3) 50%,
            rgba(30, 41, 59, 0.4) 100%
          );
          padding: 2rem;
          border-radius: 12px;
          border: 1px solid rgba(184, 134, 11, 0.2);
          backdrop-filter: blur(10px);
          box-shadow:
            0 8px 20px rgba(0, 0, 0, 0.3),
            inset 0 1px 2px rgba(255, 255, 255, 0.05);
          position: relative;
        }

        .ingredients-section::after,
        .instructions-section::after,
        .garnish-section::after,
        .notes-section::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(184, 134, 11, 0.5) 20%,
            rgba(139, 69, 19, 0.3) 50%,
            rgba(184, 134, 11, 0.5) 80%,
            transparent 100%
          );
        }

        .ingredients-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .ingredients-list > * + * {
          margin-top: 2rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(184, 134, 11, 0.1);
        }

        .empty-ingredients,
        .instructions-placeholder {
          color: #888;
          font-style: italic;
          text-align: center;
          padding: 1.5rem;
        }

        .instructions-content,
        .notes-content {
          line-height: 1.7;
          color: #e5e5e5;
        }

        @media (max-width: 768px) {
          .speakeasy-stage {
            padding: 1rem;
          }

          .recipe-mat {
            padding: 1.5rem;
          }

          .cocktail-title {
            font-size: 2rem;
          }

          .cocktail-meta {
            gap: 0.5rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='cocktail-card'>
        <div class='card-header'>
          <h3 class='card-title'>{{if
              @model.cocktailName
              @model.cocktailName
              'Unnamed Cocktail'
            }}</h3>
          <div class='card-badges'>
            {{#if @model.difficulty}}
              <span
                class='mini-badge {{@model.difficulty}}'
              >{{@model.difficulty}}</span>
            {{/if}}
            {{#if @model.preparationTime}}
              <span class='mini-badge time'>{{@model.preparationTime}}m</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.description}}
          <p class='card-description'>{{@model.description}}</p>
        {{else}}
          <p class='card-placeholder'>A mysterious cocktail recipe...</p>
        {{/if}}

        {{#if (gt @model.ingredients.length 0)}}
          <div class='ingredient-count'>
            🍾
            {{@model.ingredients.length}}
            ingredients
          </div>
        {{/if}}
      </div>

      <style scoped>
        .cocktail-card {
          background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
          border: 1px solid #d4af37;
          border-radius: 8px;
          padding: 1.2rem;
          color: var(--boxel-50);
          font-family: 'Georgia', serif;
          box-shadow: 0 4px 15px rgba(212, 175, 55, 0.2);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.8rem;
          gap: 1rem;
        }

        .card-title {
          margin: 0;
          font-size: 1.1rem;
          color: #d4af37;
          font-weight: bold;
          flex: 1;
        }

        .card-badges {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
        }

        .mini-badge {
          padding: 0.2rem 0.5rem;
          border-radius: 12px;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .mini-badge.easy {
          background: #10b981;
          color: white;
        }
        .mini-badge.medium {
          background: #f59e0b;
          color: white;
        }
        .mini-badge.hard {
          background: #ef4444;
          color: white;
        }
        .mini-badge.time {
          background: rgba(212, 175, 55, 0.2);
          color: #d4af37;
          border: 1px solid #d4af37;
        }

        .card-description {
          margin: 0 0 0.8rem 0;
          color: #e0e0e0;
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .card-placeholder {
          margin: 0 0 0.8rem 0;
          color: #888;
          font-style: italic;
          font-size: 0.9rem;
        }

        .ingredient-count {
          font-size: 0.8rem;
          color: #d4af37;
          font-weight: 500;
        }
      </style>
    </template>
  };
}
