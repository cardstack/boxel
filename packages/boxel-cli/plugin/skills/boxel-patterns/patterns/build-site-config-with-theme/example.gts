// Pattern example: multi-page site config with ThemeCard brand guide.
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import ThemeCard from 'https://cardstack.com/base/theme';
import { eq } from '@cardstack/boxel-ui/helpers';

export class PageConfig extends CardDef {
  static displayName = 'Page Config';

  @field pageId = contains(StringField);
  @field pageLabel = contains(StringField);
  @field pageUrl = contains(UrlField);
  @field showInNav = contains(BooleanField);
  @field navOrder = contains(NumberField);
}

export class SiteConfig extends CardDef {
  static displayName = 'Site Config';

  @field siteTitle = contains(StringField);
  @field brandGuide = linksTo(() => ThemeCard);
  @field pages = linksToMany(() => PageConfig);
  @field ctaPrimaryText = contains(StringField);
  @field ctaPrimaryUrl = contains(UrlField);
  @field ctaSecondaryText = contains(StringField);
  @field ctaSecondaryUrl = contains(UrlField);
}

export class SiteShell extends CardDef {
  static displayName = 'Site Shell';
  static prefersWideFormat = true;

  @field site = linksTo(() => SiteConfig);
  @field currentPageId = contains(StringField);

  @field cardTheme = linksTo(() => ThemeCard, {
    computeVia: function (this: SiteShell) {
      return this.cardInfo?.theme ?? this.site?.brandGuide ?? null;
    },
  });

  static isolated = class Isolated extends Component<typeof SiteShell> {
    get sortedNavPages() {
      return (this.args.model.site?.pages ?? [])
        .filter((page) => page.showInNav)
        .slice()
        .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0));
    }

    <template>
      <div class='site-shell'>
        <nav class='navbar' aria-label='Site navigation'>
          <a class='brand' href='/'>{{@model.site.siteTitle}}</a>

          <div class='links'>
            {{#each this.sortedNavPages as |page|}}
              <a
                class={{if
                  (eq page.pageId @model.currentPageId)
                  'active nav-link'
                  'nav-link'
                }}
                href={{page.pageUrl}}
              >
                {{page.pageLabel}}
              </a>
            {{/each}}
          </div>

          <div class='actions'>
            {{#if @model.site.ctaSecondaryText}}
              <a href={{@model.site.ctaSecondaryUrl}}>
                {{@model.site.ctaSecondaryText}}
              </a>
            {{/if}}
            {{#if @model.site.ctaPrimaryText}}
              <a class='primary' href={{@model.site.ctaPrimaryUrl}}>
                {{@model.site.ctaPrimaryText}}
              </a>
            {{/if}}
          </div>
        </nav>

        <main class='page'>
          {{yield}}
        </main>
      </div>

      <style scoped>
        .site-shell {
          min-height: 100%;
          background: var(--background, #fff);
          color: var(--foreground, #17202a);
          font-family: var(--font-sans);
        }

        .navbar {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--border, #d8dee7);
        }

        .brand {
          font-weight: 800;
          color: var(--foreground, #17202a);
          text-decoration: none;
        }

        .links,
        .actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .links {
          flex: 1;
        }

        .nav-link {
          color: var(--muted-foreground, #687385);
          text-decoration: none;
        }

        .nav-link.active {
          color: var(--foreground, #17202a);
          font-weight: 700;
        }

        .primary {
          padding: 0.45rem 0.75rem;
          border-radius: 6px;
          background: var(--primary, #285de8);
          color: var(--primary-foreground, #fff);
          text-decoration: none;
        }

        .page {
          padding: 1.5rem;
        }
      </style>
    </template>
  };
}
