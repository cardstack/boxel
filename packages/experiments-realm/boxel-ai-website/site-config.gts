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
import ThemeCard from 'https://cardstack.com/base/theme';

// PageCard definition
export class PageCard extends CardDef {
  static displayName = 'Page';
  @field pageId = contains(StringField);
  @field pageLabel = contains(StringField);
  @field pageUrl = contains(UrlField);
  @field showInNav = contains(BooleanField, {
    description: 'Whether page should appear in navbar',
  });
  @field navOrder = contains(NumberField, {
    description: 'Order in navbar (1, 2, 3, 4, 5)',
  });
  @field hasDropdown = contains(BooleanField, {
    description: 'Whether the page has dropdown menu for section jump',
  });
}

// Site configuration - central registry for all pages
export class Site extends CardDef {
  static displayName = 'Site';

  @field siteTitle = contains(StringField);
  @field brandGuide = linksTo(() => ThemeCard);
  @field pages = linksToMany(() => PageCard);
  @field ctaPrimaryText = contains(StringField);
  @field ctaPrimaryUrl = contains(UrlField);
  @field ctaSecondaryText = contains(StringField);
  @field ctaSecondaryUrl = contains(UrlField);
}
