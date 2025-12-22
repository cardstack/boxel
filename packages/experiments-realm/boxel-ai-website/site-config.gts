// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import BrandGuide from 'https://cardstack.com/base/brand-guide';

// PageCard definition
export class PageCard extends CardDef {
  static displayName = 'Page';
  @field pageId = contains(StringField);
  @field pageLabel = contains(StringField);
  @field pageUrl = contains(UrlField);
  @field showInNav = contains(BooleanField);
  @field navOrder = contains(NumberField);
  @field hasDropdown = contains(BooleanField);
}

// Site configuration - central registry for all pages
export class Site extends CardDef {
  static displayName = 'Site';

  @field siteTitle = contains(StringField);
  @field brandGuide = linksTo(() => BrandGuide);
  @field pages = linksToMany(() => PageCard);
  @field ctaPrimaryText = contains(StringField);
  @field ctaPrimaryUrl = contains(UrlField);
  @field ctaSecondaryText = contains(StringField);
  @field ctaSecondaryUrl = contains(UrlField);
}
