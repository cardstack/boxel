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
import { NavLinkColumnField } from '../fields/nav-link-column-field';
import { NavLinkField } from '../fields/nav-link-field';

export class FooterSection extends SectionCard {
  static displayName = 'Footer Section';

  @field siteName = contains(StringField);
  @field siteTagline = contains(StringField);
  @field siteUrl = contains(UrlField);
  @field linkColumns = containsMany(NavLinkColumnField);
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
        <div class='footer-box'>
          <div class='footer-box-brand'>
            <a href={{if @model.siteUrl (sanitizeHtml @model.siteUrl) '#'}}>
              {{#if this.brandMark}}
                <div
                  aria-label={{@model.siteName}}
                  class='footer-box-logo'
                  style={{setBackgroundImage this.brandMark}}
                />
              {{else}}
                <@fields.siteName />
              {{/if}}
            </a>
            <div class='footer-box-label'><@fields.siteTagline /></div>
          </div>

          {{#if @model.linkColumns.length}}
            <@fields.linkColumns class='footer-box-columns' />
          {{/if}}
        </div>

        <div class='footer-meta'>
          {{#if @model.copyrightText}}
            <span class='footer-meta-copyright'>{{@model.copyrightText}}</span>
          {{/if}}
          {{#if @model.legalLinks.length}}
            <@fields.legalLinks class='footer-meta-links' />
          {{/if}}
        </div>
      </footer>

      <style scoped>
        :deep(.containsMany-item .compound-field) {
          word-break: initial;
        }
        .footer-section {
          --_border: var(--border, var(--boxel-border-color));
          color: var(--muted-foreground, var(--boxel-500));
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
        }
        .footer-box {
          display: grid;
          grid-template-columns: 1.5fr repeat(3, 1fr);
          background-color: var(--background);
          border: 1px solid var(--_border);
        }
        .footer-box-brand {
          padding: 1.25rem 1.5rem;
          border-right: 1px solid var(--_border);
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }
        .footer-box-logo {
          width: 7.5rem;
          height: 1.75rem;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: left center;
        }
        .footer-box-label {
          letter-spacing: var(--boxel-lsp-xxl);
          text-transform: uppercase;
        }
        .footer-box-columns {
          display: contents;
        }
        .footer-box-columns > :deep(* + *) {
          border-left: 1px solid var(--_border);
        }
        .footer-box :deep(.nav-link-column-title) {
          padding: 0.6rem 1rem;
          border-bottom: 1px solid var(--_border);
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
        }
        .footer-box :deep(.nav-link-column-links) {
          gap: 0;
        }
        .footer-box :deep(.nav-link-column-links > * + *) {
          border-top: 1px solid var(--_border);
        }
        .footer-box :deep(.nav-link) {
          display: block;
          padding: 0.5rem 1rem;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--foreground);
          text-decoration: none;
        }
        .footer-box :deep(.nav-link:hover) {
          color: var(--brand-secondary);
        }

        .footer-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 1.5rem;
          padding: 1.25rem 0;
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
        }
        .footer-meta-links {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }
        .footer-meta :deep(.nav-link:hover) {
          color: var(--foreground);
        }
      </style>
    </template>
  };
}
