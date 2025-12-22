import { field, contains, containsMany, linksTo } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import BrandGuide from 'https://cardstack.com/base/brand-guide';

import { SectionCard } from './section-card';
import { FooterColumnField } from '../fields/footer-column-field';

export class FooterSection extends SectionCard {
  static displayName = 'Footer Section';

  @field leftHeadline = contains(StringField);
  @field primaryCtaText = contains(StringField);
  @field primaryCtaUrl = contains(UrlField);
  @field linkColumns = containsMany(FooterColumnField);
  @field brandGuide = linksTo(() => BrandGuide);
  @field copyrightText = contains(StringField);
  @field versionText = contains(StringField);

  /** Template Features:
   * Architect title block style
   * Two-column: headline+CTA / link columns
   * Brand Kit link opens brand guide card
   * Copyright bar at bottom
   */
}
