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
import enumField from 'https://cardstack.com/base/enum';

import DiscordIcon from '@cardstack/boxel-icons/brand-discord';
import GithubIcon from '@cardstack/boxel-icons/brand-github';
import Check from '@cardstack/boxel-icons/check';

import { Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { SectionCard } from './section-card';
import { AnimatedGrid } from '../animated-grid';
import { Cta } from '../components/cta';

class BadgeField extends FieldDef {
  static displayName = 'Badge';

  @field icon = contains(
    enumField(StringField, { options: ['checkmark', 'github', 'discord'] }),
  );
  @field label = contains(StringField);
  @field url = contains(UrlField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <Pill class='badge-field' @kind={{if @model.url.length 'button'}}>
        <:iconLeft>
          {{#if @model.icon}}
            {{#if (eq @model.icon 'checkmark')}}
              <Check width='14' height='14' />
            {{else if (eq @model.icon 'github')}}
              <GithubIcon width='14' height='14' />
            {{else}}
              <DiscordIcon width='14' height='14' />
            {{/if}}
          {{/if}}
        </:iconLeft>
        <:default>
          <@fields.label />
        </:default>
      </Pill>
      <style scoped>
        button {
          transition: none;
        }
        button:hover {
          color: var(--secondary, var(--boxel-highlight));
        }
        .badge-field {
          background: none;
          border: none;
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-weight: 400;
        }
      </style>
    </template>
  };
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

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='hero-section'>
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
            <p class='hero-description'><@fields.description /></p>
          {{/if}}

          {{#if @model.badges.length}}
            <@fields.badges class='hero-badges' />
          {{/if}}

          <div class='hero-actions'>
            {{#if @model.primaryCtaText}}
              <Cta
                @variant='primary'
                @href={{@model.primaryCtaUrl}}
              >{{@model.primaryCtaText}}</Cta>
            {{/if}}
            {{#if @model.secondaryCtaText}}
              <Cta
                @href={{@model.secondaryCtaUrl}}
              >{{@model.secondaryCtaText}}</Cta>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .hero-section {
          --hero-heading-font-size: clamp(4.5rem, 14vw, 9rem);
          --hero-subheading-font-size: clamp(1.35rem, 2.5vw, 1.5rem);
          --hero-description-font-size: 1.125rem;

          position: relative;
          padding-block: clamp(5rem, 12vw, 10rem);
          padding-inline: clamp(1.5rem, 5vw, 3rem);
          overflow: hidden;
          background: linear-gradient(
            135deg,
            var(--background) 0%,
            var(--muted) 100%
          );
          text-wrap: pretty;
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
          margin-inline: auto;
          display: flex;
          flex-direction: column;
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
          line-height: 0.85;
          letter-spacing: -0.05em;
        }

        .hero-headline .word-1 {
          background: linear-gradient(
            135deg,
            var(--boxel-teal) 0%,
            var(--boxel-cyan) 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .word-2 {
          word-break: normal;
        }

        .hero-tagline {
          margin-top: 1.5rem;
          font-size: var(--hero-subheading-font-size);
          font-weight: 500;
        }

        .hero-description {
          font-size: var(--hero-description-font-size);
          line-height: 1.7;
          color: var(--muted-foreground);
          max-width: 32.5rem;
        }

        .hero-badges {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-3xs);
          margin-top: var(--boxel-sp);
          padding: var(--boxel-sp) 0;
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .hero-badges :deep(.containsMany-item),
        .hero-badges :deep(.compound-field.embedded-format) {
          display: contents;
        }

        .hero-actions {
          display: flex;
          gap: var(--boxel-sp);
          margin-top: var(--boxel-sp);
          flex-wrap: wrap;
          justify-content: center;
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
