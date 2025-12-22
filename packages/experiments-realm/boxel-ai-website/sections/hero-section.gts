import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

import { Button } from '@cardstack/boxel-ui/components';

import { SectionCard } from './section-card';
import { AnimatedGrid } from '../animated-grid';

class BadgeField extends FieldDef {
  static displayName = 'Badge';

  @field icon = contains(StringField);
  @field label = contains(StringField);
  @field url = contains(UrlField);
}

export class HeroSection extends SectionCard {
  static displayName = 'Hero Section';

  @field eyebrow = contains(StringField);
  @field headlineWord1 = contains(StringField);
  @field headlineWord2 = contains(StringField);
  @field tagline = contains(StringField);
  @field description = contains(StringField);
  @field primaryCtaText = contains(StringField);
  @field primaryCtaUrl = contains(UrlField);
  @field secondaryCtaText = contains(StringField);
  @field secondaryCtaUrl = contains(UrlField);
  @field badges = containsMany(BadgeField);
  @field backgroundGrid = linksTo(() => AnimatedGrid);

  /** Template Features:
   * Composited AnimatedGrid card as background layer
   * Gradient text on highlight word
   * Frosted glass effect on text container
   * Open source badge strip
   */
  // Isolated template - hero presentation
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section id={{@model.sectionId}} class='hero-section'>
        {{! Background layer - composited card }}
        {{#if @model.backgroundGrid}}
          <div class='background-layer'>
            <@fields.backgroundGrid @format='isolated' />
          </div>
        {{/if}}

        {{! Content layer }}
        <div class='hero-content'>
          {{#if @model.eyebrow}}
            <div class='hero-eyebrow'>{{@model.eyebrow}}</div>
          {{/if}}

          <h1 class='hero-headline'>
            {{#if @model.headlineWord1}}
              <span class='word-1'>{{@model.headlineWord1}}</span>
            {{/if}}
            {{#if @model.headlineWord2}}
              <span class='word-2'>{{@model.headlineWord2}}</span>
            {{/if}}
          </h1>

          {{#if @model.tagline}}
            <p class='hero-tagline'>{{@model.tagline}}</p>
          {{/if}}

          {{#if @model.description}}
            <p class='hero-description'>{{@model.description}}</p>
          {{/if}}

          <div class='hero-actions'>
            {{#if @model.primaryCtaText}}
              <Button
                class='hero-button-primary'
                @as='anchor'
                @href={{@model.primaryCtaUrl}}
                @kind='primary'
                @size='touch'
              >{{@model.primaryCtaText}}</Button>
            {{/if}}
            {{#if @model.secondaryCtaText}}
              <Button
                class='hero-button-secondary'
                @as='anchor'
                @href={{@model.secondaryCtaUrl}}
                @kind='muted'
                @size='touch'
              >{{@model.secondaryCtaText}}</Button>
            {{/if}}
          </div>
        </div>
      </section>

      <style scoped>
        .hero-section {
          --hero-heading-font-size: clamp(
            var(--boxel-heading-font-size),
            8vw,
            5rem
          );
          --hero-subheading-font-size: clamp(
            var(--boxel-subheading-font-size),
            2.5vw,
            1.5rem
          );

          position: relative;
          padding-block: var(
            --hero-padding-block,
            var(--section-padding-block, 6rem)
          );
          padding-inline: var(--section-padding-inline, 1.5rem);
          overflow: hidden;
          background: linear-gradient(
            135deg,
            var(--background) 0%,
            var(--muted) 100%
          );
        }

        .background-layer {
          position: absolute;
          inset: 0;
          z-index: 0;
          opacity: 0.6; /* Subtle background effect */
        }

        .hero-content {
          position: relative;
          z-index: 1;
          max-width: var(--section-max-width, 87.5rem);
          margin-inline: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 1.5rem;
        }

        .hero-eyebrow {
          font-family: var(--boxel-section-heading-font-family);
          font-size: var(
            --boxel-section-heading-font-size,
            var(--boxel-font-size-sm)
          );
          letter-spacing: var(--boxel-lsp-xxl);
          text-transform: uppercase;
          color: var(--muted-foreground);
          font-weight: var(--boxel-section-heading-font-weight, 700);
        }

        .hero-headline {
          font-size: var(--hero-heading-font-size);
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -0.02em;
        }

        .hero-headline .word-1 {
          background: linear-gradient(
            135deg,
            var(--brand-secondary) 0%,
            var(--brand-primary) 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-tagline {
          font-size: var(--hero-subheading-font-size);
          font-weight: 500;
          color: var(--muted-foreground);
        }

        .hero-description {
          font-size: 1.125rem;
          line-height: 1.6;
          color: var(--muted-foreground);
          max-width: 37.5rem;
        }

        .hero-actions {
          display: flex;
          gap: var(--boxel-sp);
          margin-top: var(--boxel-sp);
          flex-wrap: wrap;
          justify-content: center;
        }

        .hero-button-primary {
          transition:
            transform var(--boxel-transition),
            opacity var(--boxel-transition);
        }
        .hero-button-primary:hover {
          opacity: 0.9;
          transform: translateY(-2px);
        }

        @media (max-width: 768px) {
          .hero-actions {
            flex-direction: column;
            width: 100%;
          }
        }
      </style>
    </template>
  };
}
