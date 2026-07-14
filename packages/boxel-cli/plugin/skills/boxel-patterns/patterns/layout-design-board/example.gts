import { CardDef, field, linksTo, contains, StringField, Component } from 'https://cardstack.com/base/card-api';

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
            <@fields.hero @format='isolated' />
          {{/if}}

          {{#if @model.metrics}}
            {{!-- Metrics: compact panel → embedded --}}
            <@fields.metrics @format='embedded' />
          {{/if}}

          {{#if @model.testimonial}}
            {{!-- Testimonial: tile-sized → fitted --}}
            <@fields.testimonial @format='fitted' />
          {{/if}}
        </section>
      </article>

      <style scoped>
        .board {
          display: grid;
          gap: 2rem;
          padding: 2rem;
          background: var(--background);
        }

        .board-sections {
          display: grid;
          gap: 1.5rem;
        }

        /* 🎯 The chrome-strip trick — sections styled as full cards
              shed their chrome when delegated into a board. */
        .board-sections > * {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
        }
      </style>
    </template>
  };
}
