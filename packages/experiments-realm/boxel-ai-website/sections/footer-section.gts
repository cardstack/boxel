import {
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import BrandGuide from 'https://cardstack.com/base/brand-guide';

import { sanitizeHtml } from '@cardstack/boxel-ui/helpers';
import setBackgroundImage from 'https://cardstack.com/base/helpers/set-background-image';

import { SectionCard } from './section-card';
import { FooterColumnField } from '../fields/footer-column-field';
import { NavLinkField } from '../fields/nav-link-field';

export class FooterSection extends SectionCard {
  static displayName = 'Footer Section';

  @field leftHeadline = contains(StringField);
  @field primaryCtaText = contains(StringField);
  @field primaryCtaUrl = contains(UrlField);
  @field linkColumns = containsMany(FooterColumnField);
  @field legalLinks = containsMany(NavLinkField);
  @field brandGuide = linksTo(() => BrandGuide);
  @field copyrightText = contains(StringField);
  @field versionText = contains(StringField);

  /** Template Features:
   * Architect title block style
   * Two-column: headline+CTA / link columns
   * Brand Kit link opens brand guide card
   * Copyright bar at bottom
   */

  static isolated = class Isolated extends Component<typeof this> {
    private get brandMark() {
      return this.args.model?.brandGuide?.markUsage?.primaryMark1;
    }

    <template>
      <footer class='footer-section'>
        <div class='footer-grid'>
          <div class='footer-brand'>
            {{#if this.brandMark}}
              <div
                aria-label='Boxel logo'
                class='footer-logo'
                style={{setBackgroundImage this.brandMark}}
              />
            {{/if}}
            <div class='footer-label'>AI-Native Workspace</div>
            {{#if @model.leftHeadline}}
              <p class='footer-headline'>{{@model.leftHeadline}}</p>
            {{/if}}
            {{#if @model.primaryCtaText}}
              <a
                class='footer-primary-cta'
                href={{if
                  @model.primaryCtaUrl
                  (sanitizeHtml @model.primaryCtaUrl)
                  '#'
                }}
              >
                {{@model.primaryCtaText}}
              </a>
            {{/if}}
          </div>

          {{#if @model.linkColumns.length}}
            <@fields.linkColumns class='footer-columns' @format='embedded' />
          {{/if}}
        </div>

        <div class='footer-meta'>
          {{#if @model.copyrightText}}
            <span class='footer-meta-copy'>{{@model.copyrightText}}</span>
          {{/if}}

          <div class='footer-meta-links'>
            {{#if @model.versionText}}
              <span class='footer-version'>{{@model.versionText}}</span>
            {{/if}}
            {{#if @model.legalLinks.length}}
              <@fields.legalLinks
                class='footer-legal-links'
                @format='embedded'
              />
            {{/if}}
          </div>
        </div>
      </footer>

      <style scoped>
        .footer-section {
          margin-top: 6rem;
          max-width: var(--home-content-max-width, 1100px);
          margin-left: auto;
          margin-right: auto;
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          color: var(--foreground);
        }
        .footer-grid {
          display: grid;
          grid-template-columns: 1.5fr repeat(3, 1fr);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-border-color));
        }
        .footer-brand {
          padding: 1.25rem 1.5rem;
          border-right: 1px solid var(--border, var(--boxel-border-color));
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }
        .footer-logo {
          width: 120px;
          height: 28px;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: left center;
        }
        .footer-label {
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-500));
          text-transform: uppercase;
        }
        .footer-headline {
          margin: 0.25rem 0 0;
          font-size: 0.95rem;
          color: var(--foreground, var(--boxel-slate));
          line-height: 1.5;
        }
        .footer-primary-cta {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          margin-top: 0.25rem;
          font-size: 0.8rem;
          color: var(--cardstack-purple, var(--secondary));
          text-decoration: none;
        }
        .footer-primary-cta:hover {
          color: var(--boxel-highlight, var(--secondary));
        }
        .footer-columns {
          display: contents;
        }
        .footer-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .footer-meta-links {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }
        .footer-legal-links {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }
        .footer-version {
          letter-spacing: 0.05em;
        }
      </style>
    </template>
  };
}
