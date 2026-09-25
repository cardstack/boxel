// Pattern example: multi-page site config with ThemeCard brand guide.
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import UrlField from '@cardstack/base/url';
import ThemeCard from '@cardstack/base/theme';
import { Button } from '@cardstack/boxel-ui/components';
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
        .filter((page) => page?.showInNav)
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
              <Button
                class='cta'
                @as='anchor'
                @kind='secondary'
                @size='small'
                @href={{@model.site.ctaSecondaryUrl}}
              >
                {{@model.site.ctaSecondaryText}}
              </Button>
            {{/if}}
            {{#if @model.site.ctaPrimaryText}}
              <Button
                class='cta'
                @as='anchor'
                @kind='primary'
                @size='small'
                @href={{@model.site.ctaPrimaryUrl}}
              >
                {{@model.site.ctaPrimaryText}}
              </Button>
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
        }

        .navbar {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--border);
        }

        .brand,
        .brand:hover {
          color: var(--foreground);
          font-weight: 800;
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
          color: var(--muted-foreground);
          text-decoration: none;
        }

        .nav-link:hover,
        .nav-link.active {
          color: var(--foreground);
        }

        .actions {
          flex-shrink: 0;
        }

        .cta {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          --boxel-button-min-width: 0;
          white-space: nowrap;
        }

        .page {
          padding: 1.5rem;
        }
      </style>
    </template>
  };
}
