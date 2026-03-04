import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import FileText from '@cardstack/boxel-icons/file-text';
import CheckCircle from '@cardstack/boxel-icons/arrow-badge-right';
import { Button } from '@cardstack/boxel-ui/components';

// Luxury Print Catalog Cover — editorial typography, crop marks, tactile paper texture
export class Brochure extends CardDef {
  static displayName = 'Brochure';
  static icon = FileText;

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field feature1 = contains(StringField);
  @field feature2 = contains(StringField);
  @field feature3 = contains(StringField);
  @field ctaText = contains(StringField);
  @field socialProof = contains(StringField);
  @field metric = contains(StringField);
  @field metricValue = contains(StringField);
  @field brandName = contains(StringField);
  @field heroImageUrl = contains(StringField);

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='brochure-fitted'>
        {{#if @model.heroImageUrl}}
          <div
            class='fitted-hero'
            style='background-image: url({{@model.heroImageUrl}});'
          >
            <div class='fitted-overlay'>
              <div class='fitted-brand'>
                <@fields.brandName />
              </div>
            </div>
          </div>
        {{else}}
          <div class='fitted-hero fitted-placeholder'>
            <div class='fitted-overlay'>
              <div class='fitted-brand'>
                <@fields.brandName />
              </div>
            </div>
          </div>
        {{/if}}

        <div class='fitted-content'>
          <h3 class='fitted-headline'>
            <@fields.headline />
          </h3>
          <p class='fitted-subheadline'>
            <@fields.subheadline />
          </p>

          {{#if @model.metricValue}}
            <div class='fitted-metric'>
              <span class='fitted-metric-value'><@fields.metricValue /></span>
              <span class='fitted-metric-label'><@fields.metric /></span>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .brochure-fitted {
          width: 100%;
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: var(--card);
          font-family: var(--font-serif);
        }

        .fitted-hero {
          width: 100%;
          height: 40%;
          min-height: 80px;
          background-size: cover;
          background-position: center;
          position: relative;
          flex-shrink: 0;
        }

        .fitted-placeholder {
          background: linear-gradient(
            180deg,
            var(--muted) 0%,
            var(--accent) 100%
          );
        }

        .fitted-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            transparent 0%,
            color-mix(in oklch, transparent, black 40%) 100%
          );
          display: flex;
          align-items: flex-end;
          padding: var(--boxel-sp-sm);
        }

        .fitted-brand {
          font-size: var(--boxel-font-size-xs);
          font-weight: 300;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: white;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          width: 100%;
        }

        .fitted-content {
          flex: 1;
          min-height: 0;
          padding: var(--boxel-sp-sm);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .fitted-headline {
          font-size: var(--boxel-font-size);
          font-weight: 400;
          line-height: 1.2;
          margin: 0;
          color: var(--foreground);
          word-wrap: break-word;
          overflow-wrap: break-word;
          hyphens: auto;
        }

        .fitted-subheadline {
          font-size: var(--boxel-font-size-xs);
          font-weight: 400;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
          margin: 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .fitted-metric {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          margin-top: auto;
        }

        .fitted-metric-value {
          font-size: var(--boxel-font-size-lg);
          font-weight: 300;
          color: var(--primary);
          line-height: 1;
        }

        .fitted-metric-label {
          font-size: var(--boxel-font-size-2xs);
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        @container fitted-card (max-width: 200px) {
          .fitted-hero {
            height: 30%;
            min-height: 50px;
          }

          .fitted-content {
            padding: var(--boxel-sp-xs);
            gap: var(--boxel-sp-6xs);
          }

          .fitted-headline {
            font-size: var(--boxel-font-size-sm);
          }

          .fitted-subheadline {
            font-size: var(--boxel-font-size-2xs);
          }

          .fitted-metric {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--boxel-sp-6xs);
          }

          .fitted-metric-value {
            font-size: var(--boxel-font-size);
          }
        }

        @container fitted-card (min-width: 400px) {
          .fitted-hero {
            height: 50%;
          }

          .fitted-brand {
            font-size: var(--boxel-font-size-sm);
          }

          .fitted-content {
            padding: var(--boxel-sp);
            gap: var(--boxel-sp-sm);
          }

          .fitted-headline {
            font-size: var(--boxel-font-size-lg);
          }

          .fitted-subheadline {
            font-size: var(--boxel-font-size-sm);
          }

          .fitted-metric-value {
            font-size: var(--boxel-font-size-xl);
          }

          .fitted-metric-label {
            font-size: var(--boxel-font-size-xs);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='brochure-embedded'>
        <div class='embedded-header'>
          {{#if @model.heroImageUrl}}
            <div
              class='embedded-thumbnail'
              style='background-image: url({{@model.heroImageUrl}});'
            ></div>
          {{else}}
            <div class='embedded-thumbnail embedded-placeholder'>
              <FileText class='placeholder-icon' />
            </div>
          {{/if}}
          <div class='embedded-text'>
            <h3 class='embedded-headline'>
              <@fields.headline />
            </h3>
            <p class='embedded-subheadline'>
              <@fields.subheadline />
            </p>
          </div>
        </div>

        {{#if @model.feature1}}
          <div class='embedded-features'>
            <div class='embedded-feature'>
              <CheckCircle class='feature-icon' />
              <@fields.feature1 />
            </div>
            {{#if @model.feature2}}
              <div class='embedded-feature'>
                <CheckCircle class='feature-icon' />
                <@fields.feature2 />
              </div>
            {{/if}}
            {{#if @model.feature3}}
              <div class='embedded-feature'>
                <CheckCircle class='feature-icon' />
                <@fields.feature3 />
              </div>
            {{/if}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .brochure-embedded {
          container-type: inline-size;
          width: 100%;
          overflow: hidden;
          font-family: var(--font-serif);
        }

        .embedded-header {
          display: flex;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }

        .embedded-thumbnail {
          width: 120px;
          height: 90px;
          flex-shrink: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-size: cover;
          background-position: center;
          overflow: hidden;
        }

        .embedded-placeholder {
          background: linear-gradient(
            135deg,
            var(--muted) 0%,
            var(--accent) 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .placeholder-icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          color: var(--muted-foreground);
          opacity: 0.5;
        }

        .embedded-text {
          flex: 1;
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .embedded-headline {
          font-size: var(--boxel-font-size-lg);
          font-weight: 400;
          line-height: 1.3;
          margin: 0;
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .embedded-subheadline {
          font-size: var(--boxel-font-size-sm);
          font-weight: 400;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--muted-foreground);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .embedded-features {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          border-top: 1px solid var(--border);
          background: var(--muted);
        }

        .embedded-feature {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground);
          min-width: 0;
        }

        .feature-icon {
          width: var(--boxel-icon-xs);
          height: var(--boxel-icon-xs);
          color: var(--primary);
          flex-shrink: 0;
        }

        @container (max-width: 400px) {
          .embedded-header {
            flex-direction: column;
          }

          .embedded-thumbnail {
            width: 100%;
            height: 150px;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='brochure-container'>
        <div class='hero-section'>
          {{#if @model.heroImageUrl}}
            <div
              class='hero-image'
              style='background-image: url({{@model.heroImageUrl}});'
            ></div>
          {{else}}
            <div class='hero-placeholder'>
              <FileText class='hero-placeholder-icon' />
            </div>
          {{/if}}
          <div class='hero-overlay'>
            <div class='brand-mark'>
              <@fields.brandName />
            </div>
          </div>
        </div>

        <div class='content-section'>
          <header class='editorial-header'>
            <h1 class='headline'>
              <@fields.headline />
            </h1>
            <p class='subheadline'>
              <@fields.subheadline />
            </p>
          </header>

          <div class='metrics-bar'>
            <div class='metric-item'>
              <div class='metric-value'>
                <@fields.metricValue />
              </div>
              <div class='metric-label'>
                <@fields.metric />
              </div>
            </div>
            {{#if @model.socialProof}}
              <div class='social-proof'>
                <svg
                  class='quote-icon'
                  width='20'
                  height='20'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z'
                  />
                  <path
                    d='M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z'
                  />
                </svg>
                <@fields.socialProof />
              </div>
            {{/if}}
          </div>

          <div class='features-grid'>
            {{#if @model.feature1}}
              <div class='feature-card'>
                <div class='feature-number'>01</div>
                <div class='feature-text'>
                  <@fields.feature1 />
                </div>
              </div>
            {{/if}}
            {{#if @model.feature2}}
              <div class='feature-card'>
                <div class='feature-number'>02</div>
                <div class='feature-text'>
                  <@fields.feature2 />
                </div>
              </div>
            {{/if}}
            {{#if @model.feature3}}
              <div class='feature-card'>
                <div class='feature-number'>03</div>
                <div class='feature-text'>
                  <@fields.feature3 />
                </div>
              </div>
            {{/if}}
          </div>

          {{#if @model.ctaText}}
            <div class='cta-section'>
              <Button @kind='primary' @size='tall' class='cta-button'>
                <@fields.ctaText />
                <svg
                  class='arrow-icon'
                  width='20'
                  height='20'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M5 12h14M12 5l7 7-7 7' />
                </svg>
              </Button>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .brochure-container {
          height: 100%;
          overflow-y: auto;
          background: var(--background);
          font-family: var(--font-serif);
        }

        .hero-section {
          position: relative;
          width: 100%;
          height: 60vh;
          min-height: 400px;
          overflow: hidden;
        }

        .hero-image {
          width: 100%;
          height: 100%;
          background-size: cover;
          background-position: center;
        }

        .hero-placeholder {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            180deg,
            var(--muted) 0%,
            var(--accent) 100%
          );
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

        .hero-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            180deg,
            transparent 0%,
            color-mix(in oklch, transparent, black 40%) 100%
          );
          display: flex;
          align-items: flex-end;
          padding: var(--boxel-sp-xl);
        }

        .brand-mark {
          font-size: var(--boxel-font-size-xl);
          font-weight: 300;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: white;
          text-shadow: 0 2px 8px color-mix(in oklch, transparent, black 30%);
        }

        .content-section {
          max-width: 900px;
          margin: 0 auto;
          padding: var(--boxel-sp-xl) var(--boxel-sp);
        }

        .editorial-header {
          text-align: center;
          margin-bottom: var(--boxel-sp-xl);
          padding-top: var(--boxel-sp-lg);
        }

        .headline {
          font-size: clamp(2rem, 5vw, 3.5rem);
          font-weight: 300;
          letter-spacing: -0.02em;
          line-height: 1.1;
          margin: 0 0 var(--boxel-sp) 0;
          color: var(--foreground);
        }

        .subheadline {
          font-size: var(--boxel-font-size-lg);
          font-weight: 400;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--muted-foreground);
          margin: 0;
        }

        .metrics-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-lg) 0;
          margin-bottom: var(--boxel-sp-xl);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }

        .metric-item {
          text-align: center;
        }

        .metric-value {
          font-size: var(--boxel-font-size-2xl);
          font-weight: 300;
          color: var(--primary);
          line-height: 1;
          margin-bottom: var(--boxel-sp-xs);
        }

        .metric-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }

        .social-proof {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-style: italic;
          color: var(--muted-foreground);
        }

        .quote-icon {
          width: var(--boxel-icon-xs);
          height: var(--boxel-icon-xs);
          opacity: 0.6;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-xl);
        }

        .feature-card {
          padding: var(--boxel-sp-lg);
          border: 1px solid var(--border);
          border-radius: var(--boxel-border-radius-sm);
          background: var(--card);
          transition: all 0.3s ease;
        }

        .feature-card:hover {
          box-shadow: var(--boxel-box-shadow-hover);
          transform: translateY(-2px);
        }

        .feature-number {
          font-size: var(--boxel-font-size-xl);
          font-weight: 300;
          color: var(--accent-foreground);
          margin-bottom: var(--boxel-sp-sm);
          font-family: var(--font-sans);
        }

        .feature-text {
          font-size: var(--boxel-font-size);
          line-height: 1.6;
          color: var(--foreground);
        }

        .cta-section {
          text-align: center;
          padding: var(--boxel-sp-xl) 0;
        }

        .cta-button {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          font-family: var(--font-sans);
          letter-spacing: 0.05em;
        }

        .arrow-icon {
          width: var(--boxel-icon-xs);
          height: var(--boxel-icon-xs);
          transition: transform 0.2s ease;
        }

        .cta-button:hover .arrow-icon {
          transform: translateX(4px);
        }

        @container fitted-card (max-width: 600px) {
          .content-section {
            padding: var(--boxel-sp) var(--boxel-sp-sm);
          }

          .headline {
            font-size: 2rem;
          }

          .features-grid {
            grid-template-columns: 1fr;
          }

          .metrics-bar {
            flex-direction: column;
            gap: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };
}
