import { CardDef, field, linksTo, contains, StringField, Component } from '@cardstack/base/card-api';

// Each section is a self-contained card. Defined elsewhere — sketch:
class HeroSection extends CardDef {
  static displayName = 'Hero Section';
  @field heading = contains(StringField);
}
class MetricsPanel extends CardDef {
  static displayName = 'Metrics Panel';
  @field label = contains(StringField);
}
class TestimonialQuote extends CardDef {
  static displayName = 'Testimonial';
  @field quote = contains(StringField);
}

// 🧩 PATTERN: Design Board via linksTo + per-field format override
//
// The parent is purely a layout shell. Each child renders at a chosen format.
// Each child is independently editable, reusable, and owns its own state.

export class LandingBoard extends CardDef {
  static displayName = 'Landing Board';

  @field hero        = linksTo(HeroSection);
  @field metrics     = linksTo(MetricsPanel);
  @field testimonial = linksTo(TestimonialQuote);

  static isolated = class extends Component<typeof LandingBoard> {
    <template>
      <article class='board'>
        <section class='board-sections'>
          {{#if @model.hero}}
            {{!-- Hero: full bleed → isolated --}}
            <@fields.hero
              @format='isolated'
              @displayContainer={{false}}
              class='board-section'
            />
          {{/if}}

          {{#if @model.metrics}}
            {{!-- Metrics: compact panel → embedded --}}
            <@fields.metrics
              @format='embedded'
              @displayContainer={{false}}
              class='board-section'
            />
          {{/if}}

          {{#if @model.testimonial}}
            {{!-- Testimonial: tile-sized → fitted --}}
            <@fields.testimonial
              @format='fitted'
              @displayContainer={{false}}
              class='board-section'
            />
          {{/if}}
        </section>
      </article>

      <style scoped>
        .board {
          display: grid;
          gap: 2rem;
          padding: 2rem;
        }

        .board-sections {
          display: grid;
          gap: 1.5rem;
        }

        /* `class` lands on each section's CardContainer. displayContainer=false
           drops the halo; this drops the wrapper's own surface so the section
           sits flush on the board. */
        .board-section {
          background-color: transparent;
        }
      </style>
    </template>
  };
}
